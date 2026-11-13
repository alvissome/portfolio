const valid = value => Number.isFinite(value) && value > 0;
const hasEntry = value => value != null && String(value).trim() !== '';
const validLadder = levels => Array.isArray(levels) && levels.length > 0 && levels.length <= 5 &&
  levels.every((level, index) => valid(level) && (!index || level < levels[index - 1]));

// Stored IV and supports are the user's overrides. Resolve at read time so
// opening, syncing, backing up or reordering the table never pins auto values.
export function resolveWatchlistLevels(row, record) {
  const resolved = {...row};
  const sources = {};
  const currency = row.priceCurrency || record?.instrument?.currency;
  const compatible = unit => !currency || !unit || unit === currency;
  const sameListing = record?.symbol === row.symbol && record?.securityId === row.symbol && !/-UK$/.test(row.symbol);
  const reference = sameListing && record.reference;
  const useAk = row.levelSource !== 'independent' && reference?.present && !reference.conflict &&
    compatible(reference.currency);
  function result(part) {
    if (!sameListing) return null;
    const state = record[part];
    const value = state?.result ?? (['not_started','queued','processing'].includes(state?.processing) ? state.previousResult : null);
    return compatible(value?.currency) ? value?.value : null;
  }
  const akIV = useAk && valid(reference.iv?.value);
  const akSupports = useAk && validLadder(reference.supports);
  const iv = akIV ? reference.iv.value : result('iv');
  const supports = akSupports ? reference.supports : result('supports');
  function fill(key, value, source) {
    if (hasEntry(row[key])) sources[key] = 'Manual';
    else {
      resolved[key] = valid(value) ? String(value) : '';
      sources[key] = valid(value) ? source : '';
    }
  }
  fill('iv', iv, akIV ? 'AK' : 'Independent');
  for (let i = 0; i < 5; i++) {
    fill('s' + (i + 1), validLadder(supports) ? supports[i] : null, akSupports ? 'AK' : 'Independent');
  }
  return {row: resolved, sources};
}
