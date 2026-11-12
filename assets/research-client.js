import {prioritizeUniverse, normalizeSupports} from './research-core.js';

export const RESEARCH_MODEL_VERSION = 'ak-reconstruction-v1';
const PARTS = ['iv', 'supports'];
const validSymbol = value => typeof value === 'string' && value.trim() === value &&
  /^[A-Za-z0-9^][A-Za-z0-9.^=:_-]{0,39}$/.test(value);
const validRecord = (symbol, record) => record && typeof record === 'object' &&
  record.securityId === symbol && record.symbol === symbol;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const marketForSymbol = symbol => symbol.endsWith('.SI') ? 'SG' : symbol.endsWith('.HK') ? 'HK'
  : /^[A-Za-z][A-Za-z0-9^-]*(?:\.[AB])?$/.test(symbol) ? 'US' : null;

/** Name updates only replace placeholders or a name previously resolved by us.
 * A late response for another symbol cannot rename an edited row. User-entered
 * names survive future worker completions, including an edit of an auto name.
 */
export function mergeResolvedWatchlistNames(watchlist, records) {
  let changed = false;
  const next = watchlist.map(row => {
    const record = records?.[row.symbol];
    const resolved = record?.instrument?.name?.trim();
    if (!validRecord(row.symbol, record) || !resolved || resolved === row.symbol || resolved.length > 200) return row;
    const current = typeof row.name === 'string' ? row.name.trim() : '';
    const autoName = row.nameSource === 'research' && current === row.nameAutoValue;
    if (current && current !== row.symbol && !autoName) return row;
    if (current === resolved && row.nameSymbol === row.symbol) return row;
    changed = true;
    return {...row, name: resolved, nameSource: 'research', nameSymbol: row.symbol, nameAutoValue: resolved};
  });
  return changed ? next : watchlist;
}

export function buildResearchRequest(security, {previous, now = new Date().toISOString(),
  requestId = crypto.randomUUID(), modelVersion = RESEARCH_MODEL_VERSION} = {}) {
  const symbol = security.symbol ?? security.ticker ?? security.securityId;
  if (!validSymbol(symbol)) throw new TypeError('Enter a supported exchange-qualified stock symbol.');
  const override = security.methodFamilyOverride;
  if (override !== undefined && !['auto','stock','bank','reit','fund'].includes(override)) throw new TypeError('Unknown valuation method family.');
  const family = override !== undefined ? override === 'auto' ? null : override
    : previous?.methodFamilySource === 'user' ? previous.methodFamily
      : security.methodFamily ?? previous?.reference?.methodFamily ?? previous?.methodFamily ?? null;
  const record = {securityId: symbol, symbol, requestId, modelVersion,
    requestedAt: now, workerAcknowledged: false, acknowledgedAt: null, completedAt: null,
    phase: 'requested', startedAt: null, finishedAt: null, leaseUntil: null, asOf: null,
    requestError: null, priority: security.held ? 'holding' : 'watchlist',
    methodFamily: family,
    methodFamilySource: override !== undefined ? override === 'auto' ? 'auto' : 'user'
      : previous?.methodFamilySource === 'user' ? 'user' : previous?.reference?.methodFamily ? 'reference' : 'auto',
    comparison: {iv: {status: 'pending', reason: null}, supports: {status: 'pending', reason: null}}};
  for (const part of PARTS) record[part] = {
    processing: 'not_started', validation: 'experimental', result: null,
    previousResult: previous?.[part]?.result ?? previous?.[part]?.previousResult ?? null,
    reason: null,
  };
  // Reference is never written with a calculation request: importing a newer
  // benchmark must not race with a retry and be overwritten by an older copy.
  return record;
}

const METHOD_FIELDS = [
  ['conservativeIV', 'dcf_20y_conservative', 'Conservative IV'],
  ['baseIV', 'dcf_20y', 'Base IV'],
  ['averageIV', 'dcf_20y_average', 'Average IV'],
  ['yieldIV', 'yield_5pct', '5% yield'],
  ['historicalPbIV', 'historical_pb', 'Historical P/B'],
  ['adjustedPbIV', 'justified_pb', 'Adjusted P/B'],
];
const sourceName = key => ({capital_gains:'Capital gains', dividend:'Dividend',
  priority_watchlist:'Priority watchlist', secondary_watchlist:'Secondary watchlist'}[key] ?? key);

/** Import facts only. No reference value is copied into generated results or
 * active IV/support fields. Missing coverage is explicit, never inferred from
 * a partial list of matching rows.
 */
export function parseAdamSnapshot(input, securities = []) {
  const snapshot = typeof input === 'string' ? JSON.parse(input) : input;
  if (!snapshot || !Array.isArray(snapshot.rows) || snapshot.rows.length > 2000) {
    throw new TypeError('Choose an Adam reference JSON snapshot containing rows.');
  }
  const captured = snapshot.retrievedAt ?? snapshot.capturedAt;
  if (!date(captured?.slice(0, 10))) throw new TypeError('Snapshot needs a valid retrievedAt date.');
  const explicitUniverse = Array.isArray(snapshot.universe) ? snapshot.universe : [];
  const covered = new Set(explicitUniverse.filter(validSymbol));
  const coveredMarkets = Array.isArray(snapshot.coveredMarkets) ? snapshot.coveredMarkets : null;
  if (coveredMarkets?.some(market => !['US','SG','HK'].includes(market))) throw new TypeError('Unsupported reference coverage market.');
  if (snapshot.complete === true || snapshot.coverage === 'all_four_lists') {
    for (const row of securities) if (validSymbol(row.symbol) && (!coveredMarkets || coveredMarkets.includes(marketForSymbol(row.symbol)))) covered.add(row.symbol);
  }
  const id = String(snapshot.snapshotId ?? `adam-${captured.slice(0, 10)}`);
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw new TypeError('Invalid snapshot ID.');
  const groups = new Map();
  for (const raw of snapshot.rows) {
    if (!validSymbol(raw?.symbol)) throw new TypeError('Snapshot contains an invalid symbol.');
    if (!date(raw.asOf)) throw new TypeError('Every reference row needs its source update date.');
    if (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency)) throw new TypeError('Every reference row needs its currency.');
    const variants = METHOD_FIELDS.flatMap(([key, method, label]) => {
      const value = raw[key];
      if (value == null || value === '' || value === 'NA') return [];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Reference IV must be a number or null.');
      return [{key, method, label, value}];
    });
    const family = raw.methodFamily ?? (/bank/i.test(raw.classification ?? raw.sector ?? '') ? 'bank'
      : /reit/i.test(raw.classification ?? '') ? 'reit'
        : /ETF/i.test(raw.category ?? '') ? 'fund'
          : /Large|Turnaround/i.test(raw.category ?? '') ? 'stock' : null);
    if (family !== null && !['stock','bank','reit','fund'].includes(family)) throw new TypeError('Unknown valuation method family in reference.');
    const entry = {source: String(raw.source ?? ''), label: sourceName(String(raw.source ?? '')),
      asOf: raw.asOf, currency: raw.currency, supports: normalizeSupports(raw.supportLevels ?? raw.supports ?? []),
      variants, category: raw.category ?? null, classification: raw.classification ?? null, methodFamily: family};
    if (!entry.source) throw new TypeError('Every reference row needs its source list.');
    if (!groups.has(raw.symbol)) groups.set(raw.symbol, []);
    groups.get(raw.symbol).push(entry);
    covered.add(raw.symbol);
  }
  const references = {};
  for (const symbol of covered) {
    const entries = groups.get(symbol) ?? [];
    if (!entries.length) {
      references[symbol] = {present: false, snapshotId: id, capturedAt: captured,
        coverage: 'explicit_universe', reason: 'No exact security in the covered reference lists.'};
      continue;
    }
    // Latest published source wins by date, never by closeness to our result.
    // Conflicting same-date sources remain visible and prevent a single match.
    entries.sort((a, b) => b.asOf.localeCompare(a.asOf) || a.source.localeCompare(b.source));
    const chosen = entries[0];
    const sameDate = entries.filter(entry => entry.asOf === chosen.asOf);
    const signature = entry => JSON.stringify({currency: entry.currency, variants: entry.variants, supports: entry.supports});
    const conflict = sameDate.some(entry => signature(entry) !== signature(chosen));
    const selectedKey = chosen.methodFamily === 'bank' ? 'adjustedPbIV'
      : chosen.methodFamily === 'reit' ? 'historicalPbIV' : 'baseIV';
    const selected = chosen.variants.find(variant => variant.key === selectedKey);
    references[symbol] = {present: true, snapshotId: id, capturedAt: captured,
      asOf: chosen.asOf, source: chosen.source, label: chosen.label, currency: chosen.currency,
      category: chosen.category, classification: chosen.classification, methodFamily: chosen.methodFamily,
      iv: {value: selected?.value ?? null, method: selected?.method ?? null, selectedKey, variants: chosen.variants},
      supports: chosen.supports, conflict, entries};
  }
  return {references, metadata: {id, capturedAt: captured, dates: [...new Set(snapshot.rows.map(row => row.asOf))].sort(),
    sources: snapshot.sources ?? {}, coveredSymbols: [...covered], coveredMarkets,
    unresolvedListings: Array.isArray(snapshot.unresolvedListings) ? snapshot.unresolvedListings : [],
    complete: snapshot.complete === true || snapshot.coverage === 'all_four_lists'}};
}

/** Private-store coordinator. The adapter writes nested fields with merge:true,
 * preserving portfolio arrays and other symbols. No credential or user data is
 * logged. A request is Requested until the worker acknowledges it.
 */
export function createResearchController({load, write, now = () => new Date().toISOString(),
  uuid = () => crypto.randomUUID(), modelVersion = RESEARCH_MODEL_VERSION}) {
  let state = {records: {}, loading: true, hydrated: false, paused: false, error: '', referenceMeta: null};
  let closed = false;
  let paused = false;
  let refreshing = null;
  let universe = [];
  const pending = new Map();
  const inFlightWrites = new Map();
  const pendingMutations = new Set();
  const imports = new Map();
  const listeners = new Set();
  const publish = patch => {
    if (closed) return;
    state = {...state, ...patch};
    for (const listener of listeners) listener(state);
  };
  const persist = patch => {
    if (paused || closed) throw new Error('Research is paused during backup restore.');
    const operation = Promise.resolve(write(patch));
    pendingMutations.add(operation);
    return operation.finally(() => pendingMutations.delete(operation));
  };
  const refresh = () => {
    if (closed) return Promise.resolve(state);
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await load();
        const next = {...state.records};
        for (const [symbol, incoming] of Object.entries(data?.researchBySecurity ?? {})) {
          if (!validSymbol(symbol) || !validRecord(symbol, incoming)) continue;
          const local = state.records[symbol];
          if (pending.has(symbol) && incoming.requestId !== pending.get(symbol)) continue;
          if (local?.requestedAt && incoming.requestedAt && incoming.requestedAt < local.requestedAt) continue;
          let record = incoming;
          const imported = imports.get(symbol);
          if (imported && incoming.reference?.snapshotId !== imported.snapshotId) record = {...record, reference: imported};
          else if (imported) imports.delete(symbol);
          next[symbol] = record;
          if (pending.get(symbol) === incoming.requestId) pending.delete(symbol);
        }
        publish({records: next, loading: false, hydrated: true, error: '', referenceMeta: data?.researchReferenceSnapshotMeta ?? state.referenceMeta});
      } catch {
        publish({loading: false, error: 'Research could not refresh. Check the connection and retry.'});
      } finally {refreshing = null;}
      return state;
    })();
    return refreshing;
  };
  const requestOnce = async (security, {force = false, methodFamily} = {}) => {
    if (paused || closed) throw new Error('Research is paused during backup restore.');
    if (!state.hydrated) await refresh();
    if (paused || closed) throw new Error('Research is paused during backup restore.');
    if (!state.hydrated) throw new Error('Research has not loaded. Refresh before requesting a calculation.');
    const symbol = security.symbol ?? security.ticker ?? security.securityId;
    const previous = state.records[symbol];
    if (!force && previous?.phase === 'restored') return previous;
    if (!force && pending.has(symbol)) return previous;
    if (!force && previous?.requestId && previous.modelVersion === modelVersion) return previous;
    const record = buildResearchRequest({...security, ...(methodFamily !== undefined ? {methodFamilyOverride:methodFamily} : {})},
      {previous, now: now(), requestId: uuid(), modelVersion});
    pending.set(symbol, record.requestId);
    publish({records: {...state.records, [symbol]: {...previous, ...record}}, error: ''});
    try {
      await persist({researchBySecurity: {[symbol]: record}});
      return record;
    } catch {
      if (pending.get(symbol) !== record.requestId || state.records[symbol]?.requestId !== record.requestId) return state.records[symbol];
      pending.delete(symbol);
      const failed = {...state.records[symbol], requestError: 'Request was not saved. Retry when connected.'};
      for (const part of PARTS) failed[part] = {...failed[part], processing: 'blocked', reason: failed.requestError};
      publish({records: {...state.records, [symbol]: failed}, error: failed.requestError});
      return failed;
    }
  };
  const request = (security, options) => {
    if (paused || closed) return Promise.reject(new Error('Research is paused during backup restore.'));
    const symbol = security.symbol ?? security.ticker ?? security.securityId;
    if (inFlightWrites.has(symbol)) return inFlightWrites.get(symbol);
    const operation = requestOnce(security, options);
    const guarded = operation.then(value => {
      if (inFlightWrites.get(symbol) === guarded) inFlightWrites.delete(symbol);
      return value;
    }, error => {
      if (inFlightWrites.get(symbol) === guarded) inFlightWrites.delete(symbol);
      throw error;
    });
    inFlightWrites.set(symbol, guarded);
    return guarded;
  };
  const ensure = async securities => {
    universe = securities;
    if (paused || closed) return state;
    if (!state.hydrated) await refresh();
    if (!state.hydrated) return state;
    for (const security of securities) {
      if (paused || closed) break;
      if (!validSymbol(security.symbol)) continue;
      try {await request(security);}
      catch (error) {if (paused || closed) break; throw error;}
    }
  };
  const importSnapshot = async input => {
    if (paused || closed) throw new Error('Research is paused during backup restore.');
    if (!state.hydrated) await refresh();
    if (paused || closed) throw new Error('Research is paused during backup restore.');
    if (!state.hydrated) throw new Error('Research has not loaded. Refresh before importing a reference.');
    const parsed = parseAdamSnapshot(input, universe);
    // A retry cannot commit an older request after this import's new request.
    await Promise.all([...inFlightWrites.values()]);
    if (paused || closed) throw new Error('Research is paused during backup restore.');
    const previousReferences = new Map();
    const patchRecords = {};
    const nextRecords = {...state.records};
    for (const [symbol, reference] of Object.entries(parsed.references)) {
      previousReferences.set(symbol, state.records[symbol]?.reference);
      imports.set(symbol, reference);
      const current = state.records[symbol] ?? {securityId: symbol, symbol};
      const comparison = {iv: {status:'pending',reason:null}, supports: {status:'pending',reason:null}};
      nextRecords[symbol] = {...current, reference, comparison};
      patchRecords[symbol] = {securityId:symbol, symbol, reference, comparison};
    }
    const metadata = {...parsed.metadata, importedAt: now()};
    publish({records: nextRecords});
    try {
      // One atomic nested merge imports the references and their provenance;
      // generated results, request identities and portfolio arrays are absent.
      await persist({researchBySecurity: patchRecords, researchReferenceSnapshotMeta: metadata});
    } catch (error) {
      const rollback = {...state.records};
      for (const [symbol, previousReference] of previousReferences) {
        imports.delete(symbol);
        const restored = {...rollback[symbol], comparison:{iv:{status:'pending',reason:null},supports:{status:'pending',reason:null}}};
        if (previousReference === undefined) delete restored.reference;
        else restored.reference = previousReference;
        rollback[symbol] = restored;
      }
      publish({records:rollback,error:'Reference import was not saved. Please retry.'});
      throw error;
    }
    publish({referenceMeta: metadata, error: ''});
    // Existing results need a fresh guarded comparison against this vintage.
    for (const security of universe) {
      if (paused || closed) break;
      try {await request(security, {force: true});}
      catch (error) {if (paused || closed) break; throw error;}
    }
    return metadata;
  };
  const pause = async () => {
    paused = true;
    publish({paused:true});
    // Stop loops before they advance to another symbol and drain every write
    // already started, including atomic reference imports. Restore can then
    // commit without an older client write landing after it.
    await Promise.allSettled([...pendingMutations, ...inFlightWrites.values()]);
  };
  const resume = async () => {
    if (closed) return state;
    paused = false;
    publish({paused:false});
    await refresh();
    return ensure(universe);
  };
  return {getState: () => state, subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    refresh, request, ensure, importSnapshot, pause, resume, close() {closed = true; listeners.clear();}};
}

export function createResearchHook(React, {load, write}) {
  return function useResearch({uid, holdings = [], watchlist = [], loaded = true, onResolvedNames}) {
    const controller = React.useMemo(() => createResearchController({load: () => load(uid), write: patch => write(uid, patch)}), [uid]);
    const [snapshot, setSnapshot] = React.useState(() => ({controller, state: controller.getState()}));
    const state = snapshot.controller === controller ? snapshot.state : controller.getState();
    const securities = prioritizeUniverse(holdings, watchlist);
    const signature = JSON.stringify(securities.map(row => [row.securityId, row.symbol, row.held]));
    React.useEffect(() => {
      const unsubscribe = controller.subscribe(next => setSnapshot({controller, state: next}));
      controller.refresh();
      const timer = setInterval(() => controller.refresh(), 30000);
      return () => {clearInterval(timer); unsubscribe(); controller.close();};
    }, [controller]);
    React.useEffect(() => {if (loaded) controller.ensure(securities);}, [controller, loaded, signature, state.hydrated]);
    React.useEffect(() => {onResolvedNames?.(state.records);}, [state.records, onResolvedNames]);
    return {...state, request: (security, options) => controller.request(security, options),
      refresh: controller.refresh, importSnapshot: controller.importSnapshot, pause: controller.pause, resume: controller.resume};
  };
}
