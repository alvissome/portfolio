/**
 * Pure research/validation helpers. No network, portfolio writes or adoption of
 * generated values as active watchlist/alert levels happens in this module.
 * Security identities are exact caller keys; listing/ADR aliases belong to an
 * explicit instrument resolver outside this module.
 */

export const PROCESSING_STATES = Object.freeze([
  'not_started', 'queued', 'processing', 'completed', 'unavailable',
  'unsupported', 'blocked', 'failed',
]);
export const VALIDATION_STATES = Object.freeze([
  'not_validated', 'experimental', 'comparing', 'provisional', 'validated',
  'no_benchmark', 'not_applicable', 'needs_review',
]);
const PARTS = ['iv', 'supports'];

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Missing ${label}`);
  return value; // An opaque key must not be case-folded, trimmed or aliased.
}
function identity(value) {
  return Object.fromEntries(['securityId', 'requestId', 'modelVersion'].map(key =>
    [key, text(value?.[key], key)]));
}
function partName(part) {
  if (!PARTS.includes(part)) throw new TypeError('Expected iv or supports');
  return part;
}
function numberOrNull(value, label) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError(`Invalid ${label}`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Invalid ${label}`);
  return number;
}

/** Held securities first, then watchlist-only securities, preserving input order.
 * Existing app adapters may supply exact ticker/symbol strings as identity keys;
 * supply securityId when the app has resolved a canonical listing identifier.
 */
export function prioritizeUniverse(holdings = [], watchlist = []) {
  const securities = new Map();
  const add = (row, held) => {
    const symbol = typeof row === 'string' ? row : row?.ticker ?? row?.symbol ?? row?.securityId;
    const securityId = typeof row === 'string' ? row : row?.securityId ?? symbol;
    if (typeof securityId !== 'string' || !securityId.trim()) return;
    const existing = securities.get(securityId);
    if (existing) {
      existing.held ||= held;
      existing.watchlisted ||= !held;
    } else {
      securities.set(securityId, {
        securityId, symbol, held, watchlisted: !held,
        priority: held ? 'holding' : 'watchlist',
      });
    }
  };
  for (const row of holdings) if (!row?.exited) add(row, true);
  for (const row of watchlist) add(row, false);
  return [...securities.values()];
}

/** Prepare a track action through the app's existing add callback. Existing
 * rows are never patched: their manual levels, notes and alert choices belong
 * to the user. New rows start with notifications off and no active levels.
 */
export function planTrackInWatchlist(watchlist, security) {
  const symbol = text(security?.symbol ?? security?.ticker, 'symbol');
  const securityId = security?.securityId;
  const existing = watchlist.find(row => securityId && row.securityId
    ? securityId === row.securityId : row.symbol === symbol);
  if (existing) return {kind: 'existing', item: existing};
  return {kind: 'add', item: {
    ...(securityId ? {securityId} : {}), symbol, name: security.name || symbol,
    action: '', iv: '', refCost: '', s1: '', s2: '', s3: '', s4: '', s5: '',
    notes: '', reviewed: false, notifEnabled: false, alertLevel: 'S1',
    alertCooldown: 24, alertConfig: {s1: false, s2: false, s3: false, s4: false, s5: false},
  }};
}

export function requestMatches(current, incoming) {
  return ['securityId', 'requestId', 'modelVersion'].every(key =>
    typeof current?.[key] === 'string' && current[key].trim() && current[key] === incoming?.[key]);
}

export function createResearchState(request) {
  const result = {...identity(request), workerAcknowledged: false};
  for (const part of PARTS) result[part] = {
    processing: 'not_started', validation: 'not_validated', result: null,
  };
  return result;
}

/** Only an actual worker acknowledgement may turn not_started into queued. */
export function acknowledgeResearchRequest(state, acknowledgement) {
  if (!requestMatches(state, acknowledgement) || acknowledgement?.acknowledged !== true) {
    return {accepted: false, reason: 'unacknowledged_or_stale_request', state};
  }
  const next = {...state, workerAcknowledged: true};
  for (const part of PARTS) {
    next[part] = {...state[part],
      processing: state[part].processing === 'not_started' ? 'queued' : state[part].processing};
  }
  return {accepted: true, state: next};
}

export function setProcessingState(state, part, processing, reason = null) {
  partName(part);
  if (!PROCESSING_STATES.includes(processing)) throw new TypeError('Unknown processing state');
  if (processing === 'completed' || processing === 'unavailable') {
    throw new TypeError('Use applyResearchResult to complete research');
  }
  if (['queued', 'processing'].includes(processing) && !state.workerAcknowledged) {
    throw new Error('A worker acknowledgement is required before pending processing');
  }
  return {...state, [part]: {...state[part], processing, reason}};
}

export function setValidationState(state, part, validation) {
  partName(part);
  if (!VALIDATION_STATES.includes(validation)) throw new TypeError('Unknown validation state');
  if (validation === 'validated' && state[part].processing !== 'completed') {
    throw new Error('A completed result is required before validation');
  }
  return {...state, [part]: {...state[part], validation}};
}

export function normalizeSupports(values) {
  if (!Array.isArray(values)) throw new TypeError('Supports must be an array');
  const supports = values.map(value => numberOrNull(value, 'support')).filter(value => value !== null);
  if (supports.length > 5) throw new RangeError('At most five support levels are allowed');
  supports.forEach((value, index) => {
    if (value <= 0) throw new RangeError('Support levels must be positive');
    if (index && value >= supports[index - 1]) {
      throw new RangeError('Support levels must be distinct and strictly descending');
    }
  });
  return supports;
}

function metadata(result, required) {
  const parsed = {};
  for (const key of ['source', 'method', 'asOf']) {
    const value = result?.[key];
    parsed[key] = value == null || value === '' ? null : text(value, key);
    if (required && parsed[key] === null) throw new TypeError(`Completed numeric result needs ${key}`);
  }
  if (parsed.asOf !== null) {
    const day = parsed.asOf.slice(0, 10);
    const parsedDate = new Date(day);
    if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(parsed.asOf) ||
        !Number.isFinite(Date.parse(parsed.asOf)) ||
        !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== day) {
      throw new TypeError('asOf must be a valid ISO date or timestamp');
    }
  }
  return parsed;
}

/** Null IV means missing/unavailable. Zero or negative IV is a number, never a
 * substitute for missing input. Empty support lists mean no supplied levels.
 */
export function normalizeResearchResult(part, result = {}) {
  partName(part);
  const value = part === 'iv' ? numberOrNull(result.value, 'IV') : normalizeSupports(result.value ?? []);
  const available = part === 'iv' ? value !== null : value.length > 0;
  return {value, available, ...metadata(result, available)};
}

export function applyResearchResult(state, response) {
  if (!requestMatches(state, response)) return {accepted: false, reason: 'stale_request', state};
  if (!state.workerAcknowledged) return {accepted: false, reason: 'worker_not_acknowledged', state};
  const part = partName(response.part);
  const result = normalizeResearchResult(part, response.result);
  return {accepted: true, state: {...state, [part]: {
    ...state[part], result, processing: result.available ? 'completed' : 'unavailable',
    // A fresh result has not inherited validation of an earlier result.
    validation: 'not_validated', reason: null,
  }}};
}

/** Absolute percentage error relative to the nonzero published/reference IV. */
export function ivPercentError(reference, calculated) {
  const base = numberOrNull(reference, 'reference IV');
  const value = numberOrNull(calculated, 'calculated IV');
  return base === null || value === null || base === 0 ? null : Math.abs((value - base) / base) * 100;
}

/** Ordered one-to-one matching, maximizing matches within tolerance, then
 * minimizing total percentage error. A prediction cannot match two references.
 * tolerance is a fraction: .02 is two percent of each reference support.
 */
export function compareSupportLevels(reference, calculated, tolerance = .02) {
  const expected = normalizeSupports(reference);
  const predicted = normalizeSupports(calculated);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('Invalid tolerance');
  const memo = new Map();
  const better = (a, b) => b.matches.length > a.matches.length ||
    (b.matches.length === a.matches.length && b.error < a.error) ? b : a;
  const solve = (i, j) => {
    if (i >= expected.length || j >= predicted.length) return {matches: [], error: 0};
    const key = `${i}:${j}`;
    if (memo.has(key)) return memo.get(key);
    let best = better(solve(i + 1, j), solve(i, j + 1));
    const error = Math.abs(predicted[j] / expected[i] - 1);
    if (error <= tolerance + Number.EPSILON * 8) {
      const tail = solve(i + 1, j + 1);
      best = better(best, {matches: [{referenceIndex: i, calculatedIndex: j,
        reference: expected[i], calculated: predicted[j], errorPct: error * 100}, ...tail.matches],
      error: error + tail.error});
    }
    memo.set(key, best);
    return best;
  };
  const result = solve(0, 0);
  const count = result.matches.length;
  return {
    tolerance, referenceCount: expected.length, calculatedCount: predicted.length,
    matchedCount: count, missingCount: expected.length - count,
    extraCount: predicted.length - count, matches: result.matches,
    meanErrorPct: count ? result.error / count * 100 : null,
    referenceCoverage: expected.length ? count / expected.length : null,
  };
}
