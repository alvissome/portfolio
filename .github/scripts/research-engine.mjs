import {calculateIV, calculateSupports, MODEL_VERSION} from './research-calculations.mjs';
import {compareSupportLevels, ivPercentError} from '../../assets/research-core.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const METHODS = ['dcf_20y', 'dni_20y', 'yield_5pct', 'historical_pb', 'justified_pb'];
function methodId(row) {
  if (METHODS.includes(row?.methodId)) return row.methodId;
  if (METHODS.includes(row?.key)) return row.key;
  if (METHODS.includes(row?.method)) return row.method;
  return null;
}
function ivVariants(value) {
  if (finite(value)) return [{value, methodId: null}];
  if (!value || typeof value !== 'object') return [];
  const variants = (value.variants || []).filter(row => finite(row?.value));
  return variants.length ? variants : finite(value.value) ? [value] : [];
}

/** Presence, arithmetic error and validation status are intentionally distinct.
 * Neither importing Adam's numbers nor an approximate match validates a model. */
export function compareResearch(record, reference = record.reference) {
  const shared = {asOf: record.asOf || record.iv?.result?.asOf || record.supports?.result?.asOf || null,
    referenceAsOf: reference?.asOf || null, referenceSource: reference?.source || null,
    snapshotId: reference?.snapshotId || null};
  const absence = part => {
    if (part === 'iv' && record.iv?.validation === 'not_applicable') return {status: 'not_applicable', reason: record.iv.reason};
    if (!reference || typeof reference.present !== 'boolean') return {status: 'reference_unknown', reason: 'No reference snapshot has been loaded for this security.'};
    if (!reference.present) return {status: 'no_benchmark', reason: 'This security is absent from the imported reference universe. Independent calculation still runs.'};
    return null;
  };
  const currencyMatches = result => result?.currency && reference?.currency && result.currency === reference.currency;
  const dayMatches = result => result?.asOf && reference?.asOf && result.asOf === reference.asOf;
  const compareIV = () => {
    const missing = absence('iv');
    if (missing) return {...shared, ...missing};
    const expected = ivVariants(reference.iv);
    if (!expected.length) return {...shared, status: 'no_reference_value', reason: 'Adam’s imported entry supplies no numeric IV.'};
    const result = record.iv?.result;
    if (record.iv?.processing !== 'completed' || !result) return {...shared, status: 'pending', reason: record.iv?.reason || 'Independent IV has not completed.'};
    const predicted = ivVariants(result);
    const comparisons = expected.map(row => {
      const id = methodId(row);
      const candidate = predicted.find(value => id && methodId(value) === id);
      if (!candidate) return {referenceKey: row.key || null, methodId: id, reference: row.value, calculated: null,
        errorPct: null, status: 'method_mismatch', reason: 'The corresponding independent valuation method is not available.'};
      const errorPct = ivPercentError(row.value, candidate.value);
      // The existing public data adapter supplies ordinary equity. A P/TBV
      // benchmark cannot be passed off as that same denominator without proof.
      const unverifiedBookBasis = id === 'historical_pb' && candidate.basis === 'unadjusted_equity' && row.basis !== candidate.basis;
      const unverifiedDividendBasis = id === 'yield_5pct' && candidate.basis === 'trailing_provider_dividends' && row.basis !== candidate.basis;
      return {referenceKey: row.key || null, methodId: id, reference: row.value, calculated: candidate.value,
        errorPct, status: unverifiedBookBasis || unverifiedDividendBasis ? 'method_mismatch' :
          (row.value === 0 ? candidate.value === 0 : errorPct <= 5) ? 'matched' : 'different',
        reason: unverifiedBookBasis ? 'Reference book/tangible-book denominator has not been reconciled with unadjusted equity.' :
          unverifiedDividendBasis ? 'Forward/trailing dividend policy and special-dividend exclusions have not been reconciled.' : null};
    });
    const priorities = ['baseIV', 'adjustedPbIV', 'historicalPbIV', 'yieldIV'];
    const selectedKey = reference.iv?.selectedKey || priorities.find(key => expected.some(row => row.key === key)) || expected[0]?.key;
    const selected = comparisons.find(row => row.referenceKey === selectedKey) || comparisons[0];
    const details = {variants: comparisons, tolerancePct: 5, selectedKey: selectedKey || null,
      errorPct: selected?.errorPct ?? null};
    if (reference.conflict) return {...shared, ...details, status: 'reference_conflict',
      reason: 'Imported reference sources conflict; retain their individual entries and resolve the benchmark before claiming a match.'};
    if (!currencyMatches(result)) return {...shared, ...details, status: 'currency_mismatch', reason: 'Listing and reference currency must match before comparison.'};
    if (!dayMatches(result) || result.pointInTimeVerified !== true) return {...shared, ...details,
      status: 'awaiting_comparable_vintage', reason: !dayMatches(result) ? 'Calculation and reference dates differ.' :
        result.vintageReason || 'Financial input publication dates are not verified for this comparison date.'};
    return {...shared, ...details, status: selected?.status || 'method_mismatch',
      reason: 'A dated arithmetic comparison does not by itself validate the model.'};
  };
  const compareSupports = () => {
    const missing = absence('supports');
    if (missing) return {...shared, ...missing};
    const expected = (reference.supports || []).filter(finite);
    if (!expected.length) return {...shared, status: 'no_reference_value', reason: 'Adam’s imported entry supplies no support levels.'};
    const result = record.supports?.result;
    if (record.supports?.processing !== 'completed' || !result) return {...shared, status: 'pending', reason: record.supports?.reason || 'Independent supports have not completed.'};
    let details;
    try { details = compareSupportLevels(expected, result.value || [], .02); }
    catch { return {...shared, status: 'pending', reason: 'Reference or generated support ordering needs review.'}; }
    if (reference.conflict) return {...shared, ...details, status: 'reference_conflict',
      reason: 'Imported reference sources conflict; no source is silently chosen for a matching badge.'};
    if (!currencyMatches(result)) return {...shared, ...details, status: 'currency_mismatch', reason: 'Listing and reference currency must match before comparison.'};
    if (!dayMatches(result) || result.pointInTimeVerified !== true) return {...shared, ...details, status: 'awaiting_comparable_vintage',
      reason: !dayMatches(result) ? 'Calculation and reference dates differ.' : result.vintageReason || 'Historical adjustment vintage has not been verified.'};
    return {...shared, ...details, status: details.missingCount === 0 && details.extraCount === 0 ? 'matched' : 'different',
      reason: 'All reference levels must match one-to-one within 2%, with no missing or extra levels.'};
  };
  return {iv: compareIV(), supports: compareSupports()};
}

export function validRequest(request) {
  return request && typeof request.symbol === 'string' && /^[A-Za-z0-9^][A-Za-z0-9.^=:_-]{0,39}$/.test(request.symbol) &&
    request.securityId === request.symbol && typeof request.requestId === 'string' && request.requestId.length > 0 &&
    request.requestId.length <= 200 && request.modelVersion === MODEL_VERSION;
}
export function sameRequest(a, b) {
  return validRequest(a) && ['symbol', 'securityId', 'requestId', 'modelVersion'].every(key => a[key] === b?.[key]);
}

export function resolveReference(record, snapshotMeta) {
  if (typeof record.reference?.present === 'boolean') return record.reference;
  const market = /\.SI$/i.test(record.symbol) ? 'SG' : /\.HK$/i.test(record.symbol) ? 'HK' :
    /^[A-Za-z0-9^-]+$/.test(record.symbol) ? 'US' : null;
  if (snapshotMeta?.complete === true && Array.isArray(snapshotMeta.coveredMarkets) &&
      snapshotMeta.coveredMarkets.includes(market)) {
    return {present: false, snapshotId: snapshotMeta.snapshotId || snapshotMeta.id || null, asOf: snapshotMeta.asOf || null,
      source: snapshotMeta.source || 'Imported complete four-list snapshot', currency: null};
  }
  return record.reference;
}

export function prioritizeRequests(entries) {
  return [...entries].sort(([,a],[,b]) => (a.priority === 'holding' || a.held ? 0 : 1) -
    (b.priority === 'holding' || b.held ? 0 : 1) || String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')));
}

export function needsProcessing(record, now = Date.now()) {
  if (!validRequest(record)) return false;
  const unfinished = ['not_started', 'queued', 'processing'];
  if (![record.iv?.processing, record.supports?.processing].some(state => unfinished.includes(state))) return false;
  return !record.workerAcknowledged || !record.leaseUntil || Date.parse(record.leaseUntil) <= now;
}

/** Shared by scheduled Firestore worker and credential-free private CLI. The
 * request's published numeric reference values never enter either calculator. */
export async function processResearchRequest(request, {fetchData, now = () => new Date(), progress} = {}) {
  if (!validRequest(request)) throw new TypeError('Invalid research request identity');
  if (typeof fetchData !== 'function') throw new TypeError('A data adapter is required');
  const stamp = now().toISOString();
  const asOf = request.asOf || stamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))) throw new TypeError('Invalid research cutoff');
  const base = {...request, asOf, workerAcknowledged: true, startedAt: request.startedAt || stamp,
    iv: {...request.iv, processing: 'processing', validation: 'experimental', reason: null},
    supports: {...request.supports, processing: 'processing', validation: 'experimental', reason: null}, phase: 'fetching'};
  await progress?.(base);
  const withPrevious = (part, output) => {
    const previousResult = request[part]?.result || request[part]?.previousResult;
    return previousResult ? {...output, previousResult} : output;
  };
  let data;
  try { data = await fetchData(request.symbol, {asOf, now: now()}); }
  catch {
    const failed = {processing: 'failed', validation: 'experimental', result: null,
      code: 'data_fetch_failed', reason: 'Public input data could not be retrieved. Retry is available.'};
    const result = {...base, phase: 'finished', finishedAt: now().toISOString(), leaseUntil: null,
      iv: withPrevious('iv', {...failed}), supports: withPrevious('supports', {...failed})};
    return {...result, comparison: compareResearch(result)};
  }
  const calculating = {...base, instrument: data.instrument || null, phase: 'calculating'};
  await progress?.(calculating);
  const {reference: ignoredReference, comparison: ignoredComparison, ...independentRequest} = request;
  // methodFamily is an explicit instrument classification, never the target IV.
  const iv = withPrevious('iv', calculateIV(data, independentRequest, asOf));
  const supports = withPrevious('supports', calculateSupports(data, independentRequest, asOf));
  const result = {...calculating, iv, supports, phase: 'finished', finishedAt: now().toISOString(), leaseUntil: null,
    dataWarnings: (data.warnings || []).map(value => String(value).slice(0, 300)).slice(0, 20),
    sourceRetrievedAt: data.retrievedAt || now().toISOString()};
  return {...result, comparison: compareResearch(result)};
}
