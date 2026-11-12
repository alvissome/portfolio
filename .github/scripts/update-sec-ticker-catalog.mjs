/** Refresh the full public catalog from its one official source. No issuer
 * requests, credentials, portfolio data or alternate download routes. */
import {createHash} from 'node:crypto';
import {mkdir, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SEC_CATALOG_SOURCE, validateSecTickerCatalog} from './sec-ticker-catalog.mjs';
import {buildSecUserAgent, secContactConfigurationMessage, GENERIC_RESEARCH_USER_AGENT} from './research-http.mjs';

export async function refreshSecTickerCatalog({fetch = globalThis.fetch,
  directory = new URL('../data/', import.meta.url), now = () => new Date(),
  secUserAgent = GENERIC_RESEARCH_USER_AGENT} = {}) {
  const response = await fetch(SEC_CATALOG_SOURCE, {redirect:'error', signal:AbortSignal.timeout(25000),
    headers:{'User-Agent':secUserAgent}});
  if (!response.ok) throw new Error(`SEC_CATALOG_HTTP_${response.status}`);
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > 5 * 1024 * 1024) throw new Error('SEC_CATALOG_SIZE_INVALID');
  const data = JSON.parse(raw.toString());
  const metadata = {sourceURL:SEC_CATALOG_SOURCE,retrievedAt:now().toISOString(),
    sha256:createHash('sha256').update(raw).digest('hex'),recordCount:Object.keys(data).length,
    catalogFile:'sec-company-tickers.json'};
  validateSecTickerCatalog(raw, metadata, {now:now()});
  await mkdir(directory,{recursive:true});
  const target = name => directory instanceof URL ? new URL(name,directory) : resolve(directory,name);
  await writeFile(target('sec-company-tickers.json.tmp'),raw);
  await writeFile(target('sec-company-tickers.meta.json.tmp'),JSON.stringify(metadata,null,2)+'\n');
  await rename(target('sec-company-tickers.json.tmp'),target('sec-company-tickers.json'));
  await rename(target('sec-company-tickers.meta.json.tmp'),target('sec-company-tickers.meta.json'));
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(()=>refreshSecTickerCatalog({secUserAgent:buildSecUserAgent(process.env.SEC_CONTACT_EMAIL)}))
    .then(metadata=>console.log(JSON.stringify(metadata))).catch(error=>{
    console.error(secContactConfigurationMessage(error) ||
      (/^SEC_CATALOG_[A-Z0-9_]+$/.test(error?.message||'') ? error.message : 'SEC_CATALOG_REFRESH_FAILED'));
    process.exitCode=1;
  });
}
