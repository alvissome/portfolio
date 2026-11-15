import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedTableUrl,parseAkSheet} from '../assets/ak-sheet-sources.js';
import {tableGrid,reconcilePublished,readPublishedTable,readNativeSheet} from '../.github/scripts/research-ak-published.mjs';
const prefix='https://docs.google.com/spreadsheets/d/e/abcdefghijklmnopqrstuvwxyz';
const link=prefix+'/pub?output=csv&single=true&gid=42';
const day='2026-11-15T10:00:00.000Z';
const text=value=>({nodeName:'#text',value});
const el=(tagName,...childNodes)=>({tagName,childNodes,attrs:[]});
test('only published links resolve to Google table pages and preserve the tab',()=>{
  assert.equal(new URL(publishedTableUrl(link)).searchParams.get('gid'),'42');
  assert.match(publishedTableUrl(prefix+'/pubhtml?gid=42'),/pubhtml\/sheet/);
  assert.equal(publishedTableUrl('https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit?rm=minimal'),null);
});
test('public table cells preserve columns, line breaks and merged title spans',()=>{
  const merged={...el('td',text('Closed Positions')),attrs:[{name:'colspan',value:'2'}]};
  const grid=tableGrid(el('html',el('table',el('tbody',el('tr',el('th',text('1')),merged),
    el('tr',el('td',text('Average'),el('br'),text('Sell Price')),el('td',text('USD')))))));
  assert.deepEqual(grid,[['Closed Positions',''],['Average Sell Price','USD']]);
});
test('published reader does not follow an external redirect',async()=>{
  let count=0;await assert.rejects(readPublishedTable('dividend',link,{fetchImpl:async()=>{
    count++;return new Response(null,{status:302,headers:{location:'https://example.com/'}});}}));
  assert.equal(count,1);
});
test('worker resolves a queued published history for exact tracked tickers',()=>{
  const parsed=parseAkSheet([['Closed Positions'],['Ticker','Currency','Sold Date','Average Sell Price'],['ABC-US','USD','1 Nov 2026','25'],['OTHER-US','USD','1 Nov 2026','20']],'closed_positions',{today:'2026-11-15'});
  const job={id:'test',tracked:['ABC','KEEP'],freshMatches:['KEEP'],sources:{closed_positions:link},checkedAt:day};
  const data={researchSheetSources:job.sources,researchSheetSyncStatus:{sources:{closed_positions:{status:'queued'},priority_watchlist:{status:'unchanged'}}}};
  const result=reconcilePublished(data,job,{closed_positions:parsed},day);
  assert.deepEqual(Object.keys(result.changed),['ABC']);
  assert.equal(result.changed.ABC.entries[0].averageSellPrice,25);
  assert.equal(result.status.matched,2);assert.equal(result.status.readable,2);
  const stale=reconcilePublished({...data,researchSheetSources:{}},job,{closed_positions:parsed},day);
  assert.deepEqual(stale.changed,{});assert.equal(stale.status.sources.closed_positions.status,'unavailable');
});

test('Sync queues a published page with a blocked CSV and queues native edit links for the Sheets API',async()=>{
  const {createResearchController}=await import('../assets/research-client.js');
  const writes=[];
  const controller=createResearchController({load:async()=>({}),write:async patch=>writes.push(patch),
    uuid:()=> 'test',sheetFetch:async()=>({ok:false,status:403})});
  const status=await controller.syncAkSheets({closed_positions:link,capital_gains:'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit?rm=minimal'});
  assert.equal(status.sources.closed_positions.status,'queued');
  assert.equal(status.sources.capital_gains.status,'queued');
  assert.deepEqual(Object.keys(writes.at(-1).akPublishedTableRequest.sources),['capital_gains','closed_positions']);
  controller.close();
});

test('native values reader resolves the requested gid and parses a quoted tab and accounting dash',async()=>{
  const urls=[];
  const payloads=[{sheets:[{properties:{sheetId:7,title:"AK's",index:1}}]},
    {values:[['Capital Gains Portfolio','Updated','3 Nov 26'],['Ticker','Currency','SL1','SL2','SL3','SL4','SL5','Base IV','Average Cost'],['EXAMPLE-US','USD','18','','','','','20','$ - ']]}];
  const result=await readNativeSheet('capital_gains','https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit?gid=7',async()=>'fixture',{
    now:new Date(day),fetchImpl:async(url,options)=>{urls.push(url);assert.equal(options.headers.Authorization,'Bearer fixture');return Response.json(payloads.shift());}});
  assert.match(decodeURIComponent(urls[1]),/'AK''s'!A1:AZ2001/);
  assert.equal(result.rows[0].averageCost,null);assert.equal(result.rows[0].baseIV,20);
});
test('disabled API gives an actionable private status',async()=>{
  await assert.rejects(readNativeSheet('dividend','https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit',async()=>'fixture',
    {fetchImpl:async()=>Response.json({error:{details:[{reason:'SERVICE_DISABLED'}]}},{status:403})}),/Enable Google Sheets API/);
});