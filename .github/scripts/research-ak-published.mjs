import {AK_SOURCES, comparable, googleSheetFeed, parseAkSheet, previousAkRows, publishedTableUrl} from '../../assets/ak-sheet-sources.js';
import {parseAdamSnapshot} from '../../assets/research-client.js';

const MAX_BYTES = 6 * 1024 * 1024;
const google = 'https://docs.google.com';
const active = status => ['updated','unchanged'].includes(status);
const sgDay = instant => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);

function descendants(node, tag, found = []) {
  for (const child of node.childNodes ?? []) {
    if (child.tagName === tag) found.push(child);
    else descendants(child,tag,found);
  }
  return found;
}
function cellText(node) {
  if (node.nodeName === '#text') return node.value;
  if (node.tagName === 'br') return ' ';
  return (node.childNodes ?? []).map(cellText).join('');
}
export function tableGrid(document) {
  const tables = descendants(document,'table');
  const table = tables.find(t=>t.attrs?.some(a=>a.name==='class' && a.value.split(/\s+/).includes('waffle'))) ?? tables[0];
  if (!table) throw Error('The published page has no worksheet table.');
  const rows = descendants(table,'tr');
  if (rows.length > 2000) throw Error('The published table exceeds the supported size.');
  return rows.map(row=>{
    const cells=[];
    for (const cell of row.childNodes.filter(node=>node.tagName==='td')) {
      const span=Number(cell.attrs?.find(a=>a.name==='colspan')?.value ?? 1);
      if (!Number.isInteger(span)||span<1||span+cells.length>80) throw Error('Unsupported table width.');
      cells.push(cellText(cell).trim(),...Array(span-1).fill(''));
    }
    return cells;
  });
}
export async function readPublishedTable(key, link, {fetchImpl=fetch, now=new Date()}={}) {
  const start = publishedTableUrl(link);
  if (!start) throw Error('This source is a viewer. A published worksheet link is required.');
  let address = new URL(start);
  const signal=AbortSignal.timeout(20000);
  for (let hop=0;hop<4;hop++) {
    const response=await fetchImpl(address,{redirect:'manual',credentials:'omit',signal});
    if ([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      if (!location) break;
      address=new URL(location,address);
      if (address.origin!==google || !address.pathname.startsWith('/spreadsheets/') || address.username || address.password) break;
      continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) break;
    const chunks=[];let size=0;
    for await (const chunk of response.body) {
      size+=chunk.length;
      if(size>MAX_BYTES) throw Error('Published HTML exceeds the supported size.');
      chunks.push(chunk);
    }
    const {parse}=await import('parse5');
    return parseAkSheet(tableGrid(parse(Buffer.concat(chunks).toString('utf8'))),key,{today:sgDay(now)});
  }
  throw Error('The published worksheet table could not be read.');
}

function entryRow(symbol, entry) {
  return {symbol,...entry,supportLevels:entry.supports,
    ...Object.fromEntries((entry.variants??[]).map(v=>[v.key,v.value]))};
}
export function reconcilePublished(data, job, results, finishedAt) {
  const status=structuredClone(data.researchSheetSyncStatus);
  const tracked=new Set(job.tracked);
  const matched=new Set(job.freshMatches);
  const previous=previousAkRows(data.researchBySecurity);
  const bySource=new Map();
  for (const [key, result] of Object.entries(results)) {
    const item=status.sources[key];
    if (!item || item.status!=='queued') continue;
    item.checkedAt=finishedAt;
    if (data.researchSheetSources?.[key]!==job.sources[key]) {
      item.status='unavailable';item.message='Source link changed. Sync again.';continue;
    }
    if (result.error || (item.asOf && item.asOf>result.asOf)) {
      item.status='unavailable';item.message=result.error || 'Published table predates the saved reference.';continue;
    }
    const rows=result.rows.filter(row=>tracked.has(row.symbol));
    const old=previous.filter(row=>row.source===key && tracked.has(row.symbol));
    item.status=comparable(rows)===comparable(old)?'unchanged':'updated';
    Object.assign(item,{asOf:result.asOf,costHeaderFound:result.costHeaderFound,checkedAt:finishedAt,
      dateBasis:result.dateBasis??'sheet',skippedRows:result.skippedRows??0,message:null,readVia:'published_table'});
    for(const row of rows) matched.add(row.symbol);
    bySource.set(key,new Map(rows.map(row=>[row.symbol,row])));
  }
  const changed={};
  for (const symbol of tracked) {
    const record=data.researchBySecurity?.[symbol];
    const prior=record?.reference;
    // Keep any individual correction made after this batch was requested.
    if (prior?.snapshotId?.startsWith('manual-') && prior.capturedAt>=job.checkedAt) continue;
    const priorEntries=prior?.entries??[];
    if (![...bySource].some(([key,rows])=>rows.has(symbol)||priorEntries.some(e=>e.source===key))) continue;
    const rows=priorEntries.filter(e=>!bySource.has(e.source)).map(e=>entryRow(symbol,e));
    for(const sourceRows of bySource.values()) if(sourceRows.has(symbol)) rows.push(sourceRows.get(symbol));
    const snapshotId='pub-'+job.id;
    const reference=rows.length
      ? parseAdamSnapshot({snapshotId,retrievedAt:finishedAt,rows}).references[symbol]
      : {present:null,snapshotId,capturedAt:finishedAt,reason:'No matching row in the published lists read.'};
    if (JSON.stringify(reference.entries??[])!==JSON.stringify(priorEntries)||reference.present!==prior?.present) changed[symbol]=reference;
  }
  const sources=Object.values(status.sources);
  Object.assign(status,{queued:0,checkedAt:finishedAt,matched:matched.size,readable:sources.filter(s=>active(s.status)).length,
    complete:AK_SOURCES.filter(s=>s.key!=='closed_positions').every(s=>active(status.sources[s.key]?.status))});
  return {changed,status};
}

export async function processPublishedTables(db,ref,job,FieldPath) {
  if (!Array.isArray(job.tracked) || job.tracked.length>2000 || !Array.isArray(job.freshMatches)) return;
  const results={};
  await Promise.all(AK_SOURCES.filter(s=>job.sources?.[s.key]).map(async ({key})=>{
    try {results[key]=await readPublishedTable(key,googleSheetFeed(job.sources[key]));}
    catch {results[key]={error:'Could not read or validate the published table. Previous values retained.'};}
  }));
  await db.runTransaction(async tx=>{
    const data=(await tx.get(ref)).data();
    if (data?.akPublishedTableRequest?.id!==job.id) return;
    if (data.researchSheetSyncStatus?.checkedAt!==job.checkedAt) {
      tx.update(ref,'akPublishedTableRequest',null);return;
    }
    const {status,changed}=reconcilePublished(data,job,results,new Date().toISOString());
    const updates=['akPublishedTableRequest',null,'researchSheetSyncStatus',status];
    for (const [symbol,reference] of Object.entries(changed)) {
      const path=field=>new FieldPath('researchBySecurity',symbol,field);
      updates.push(path('securityId'),symbol,path('symbol'),symbol,path('reference'),reference,
        path('comparison'),{iv:{status:'pending',reason:null},supports:{status:'pending',reason:null}});
    }
    tx.update(ref,...updates);
  });
}
