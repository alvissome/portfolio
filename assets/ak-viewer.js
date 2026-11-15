import {AK_SOURCES, googleSheetFeed, akSourceDefaults} from './ak-sheet-sources.js?v=ak-cost-headers-20261115';

export function viewerUrl(value) {
  if (!value) return '';
  const url = new URL(googleSheetFeed(value));
  const gid = url.searchParams.get('gid');
  const published = url.pathname.includes('/d/e/');
  url.pathname = url.pathname.replace(/\/(pub|export)$/, published ? '/pubhtml' : '/edit');
  url.search = '';
  if (gid !== null) url.searchParams.set('gid', gid);
  return url.href;
}

export function savedViewerLinks(research) {
  const saved = {...akSourceDefaults(research?.referenceMeta), ...research?.sheetSources};
  return Object.fromEntries(AK_SOURCES.map(({key}) => {
    try { return [key, viewerUrl(saved[key])]; }
    catch { return [key, '']; }
  }));
}

export function manualReferenceRows(symbol, reference, source, values) {
  const rows = (reference?.entries ?? []).map(entry => ({
    ...entry, symbol, supportLevels:entry.supports,
    ...Object.fromEntries(entry.variants.map(v => [v.key, v.value]))
  }));
  const existing = rows.find(row => row.source === source);
  const row = {...existing, symbol, source, asOf:values.asOf, currency:values.currency.trim().toUpperCase()};
  if (existing && row.asOf < existing.asOf) throw Error('The sheet date is older than the saved entry.');
  if (!/^[A-Z]{3}$/.test(row.currency)) throw Error('Enter the three-letter trading currency.');
  const positive = value => {
    if (value == null || String(value).trim() === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw Error('Enter positive numbers for prices.');
    return number;
  };
  const ivKey = row.methodFamily === 'bank' ? 'adjustedPbIV' : row.methodFamily === 'reit' ? 'historicalPbIV' : 'baseIV';
  row[ivKey] = positive(values.iv);
  row.averageCost = positive(values.cost);
  row.supportLevels = [];
  for (const key of ['s1','s2','s3','s4','s5']) {
    const level = positive(values[key]);
    if (level === null) continue;
    const index = Number(key.slice(1)) - 1;
    if (index !== row.supportLevels.length || (index && level >= row.supportLevels[index-1])) {
      throw Error('Enter consecutive, descending support levels starting with S1.');
    }
    row.supportLevels.push(level);
  }
  if (row[ivKey] === null && row.averageCost === null && !row.supportLevels.length) throw Error('Enter an IV, average cost or support level.');
  return [...rows.filter(entry => entry.source !== source), row];
}
