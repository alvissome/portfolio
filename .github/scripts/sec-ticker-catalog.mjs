/** Full public SEC ticker index fallback. This contains no portfolio selection
 * and supplies lookup keys only: current issuer submissions must still verify
 * the exact ticker and annual form before a share denominator is accepted.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const SEC_CATALOG_SOURCE = 'https://www.sec.gov/files/company_tickers.json';
export const SEC_CATALOG_MAX_AGE_DAYS = 45;
const DAY = 86400000;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateSecTickerCatalog(raw, metadata, {now = new Date(), minimumRows = 1000} = {}) {
  if (!isRecord(metadata) || metadata.sourceURL !== SEC_CATALOG_SOURCE ||
      metadata.catalogFile !== 'sec-company-tickers.json' ||
      !/^[a-f0-9]{64}$/.test(metadata.sha256 || '')) throw new Error('SEC_CATALOG_METADATA_INVALID');
  const retrieved = Date.parse(metadata.retrievedAt);
  const current = +new Date(now);
  if (typeof metadata.retrievedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(metadata.retrievedAt) ||
      !Number.isFinite(retrieved) || !Number.isFinite(current) || retrieved > current ||
      new Date(retrieved).toISOString().slice(0, 10) !== metadata.retrievedAt.slice(0, 10)) {
    throw new Error('SEC_CATALOG_DATE_INVALID');
  }
  if (current - retrieved > SEC_CATALOG_MAX_AGE_DAYS * DAY) throw new Error('SEC_CATALOG_EXPIRED');
  if (createHash('sha256').update(raw).digest('hex') !== metadata.sha256) throw new Error('SEC_CATALOG_CHECKSUM_INVALID');
  let data;
  try {data = JSON.parse(raw.toString());} catch {throw new Error('SEC_CATALOG_SCHEMA_INVALID');}
  if (!isRecord(data)) throw new Error('SEC_CATALOG_SCHEMA_INVALID');
  const entries = Object.entries(data);
  if (entries.length < minimumRows || metadata.recordCount !== entries.length) throw new Error('SEC_CATALOG_SCHEMA_INVALID');
  const tickers = new Set();
  for (let index = 0; index < entries.length; index++) {
    const [key, row] = entries[index];
    if (key !== String(index) || !isRecord(row) ||
        Object.keys(row).sort().join(',') !== 'cik_str,ticker,title' ||
        !Number.isInteger(row.cik_str) || row.cik_str <= 0 || row.cik_str > 9999999999 ||
        typeof row.ticker !== 'string' || !/^[A-Z0-9][A-Z0-9.^=\-]{0,29}$/.test(row.ticker) ||
        tickers.has(row.ticker) || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500) {
      throw new Error('SEC_CATALOG_SCHEMA_INVALID');
    }
    tickers.add(row.ticker);
  }
  return {data, provenance: {sourceURL: metadata.sourceURL, retrievedAt: metadata.retrievedAt,
    sha256: metadata.sha256, recordCount: metadata.recordCount, maxAgeDays: SEC_CATALOG_MAX_AGE_DAYS}};
}

let bundledFiles;
export async function loadBundledSecTickerCatalog({now = new Date()} = {}) {
  bundledFiles ??= Promise.all([
    readFile(new URL('../data/sec-company-tickers.json', import.meta.url)),
    readFile(new URL('../data/sec-company-tickers.meta.json', import.meta.url), 'utf8'),
  ]);
  const [raw, metadata] = await bundledFiles;
  // Age is checked on every use, including long-lived CLI/test processes.
  return validateSecTickerCatalog(raw, JSON.parse(metadata), {now});
}
