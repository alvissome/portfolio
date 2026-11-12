/** Credential-free private-file entry point for the SAME independent engine. */
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchResearchData} from './research-data.mjs';
import {processResearchRequest, resolveReference} from './research-engine.mjs';

export async function runPrivateResearch(input, {fetchData = fetchResearchData, now} = {}) {
  if (!input || !Array.isArray(input.requests) || input.requests.length > 200) throw new TypeError('Expected at most 200 private requests');
  const records = [];
  for (const request of input.requests) {
    const reference = resolveReference(request, input.referenceSnapshotMeta);
    records.push(await processResearchRequest({...request, ...(reference ? {reference} : {})}, {fetchData, now}));
  }
  return {modelVersion: 'ak-reconstruction-v1', createdAt: new Date().toISOString(), records};
}

async function main() {
  const value = option => {
    const index = process.argv.indexOf(option);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const input = value('--input'), output = value('--output');
  if (!input || !output || resolve(input) === resolve(output)) throw new Error('Distinct private input and output paths are required');
  const parsed = JSON.parse(await readFile(input, 'utf8'));
  const result = await runPrivateResearch(parsed, {fetchData: (symbol, options) => fetchResearchData(symbol, {...options,
    twelveDataKey: process.env.TWELVE_DATA_KEY,
    secUserAgent: 'PersonalPortfolioResearch https://github.com/alvissome/portfolio'})});
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({records: result.records.length,
    ivCompleted: result.records.filter(record => record.iv.processing === 'completed').length,
    supportsCompleted: result.records.filter(record => record.supports.processing === 'completed').length}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {console.error('Private research run failed; request contents and paths were not logged.'); process.exitCode = 1;});
}
