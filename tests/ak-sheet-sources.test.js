import test from 'node:test';
import assert from 'node:assert/strict';
import {AK_SOURCES,googleSheetFeed,parseSheetCSV,parseAkSheet,readAkSources,previousAkRows,planAkLevelCopy} from '../assets/ak-sheet-sources.js';
import {createResearchController,parseAdamSnapshot} from '../assets/research-client.js';
import {createDashboardBackup,readDashboardBackup,prepareResearchRestore} from '../assets/dashboard-backup.js';
import {assessBackdatedSupportFit} from '../assets/research-confidence.js';
const url='https://docs.google.com/spreadsheets/d/e/2PACX-ExamplePublishedIdentifier000000/pubhtml?gid=123';
const now=new Date('2026-11-12T08:00:00Z');
const csv=(date='3 Nov 26',ticker='EXAMPLE-US',title='Capital Gains Portfolio')=>`${title}\n,,,,Updated on:,${date}\n,Ticker,Company,Currency,Support Level 1,Support Level 2,Support Level 3,Support Level 4,Support Level 5,Base IV,Average IV,Investment Type\n,${ticker},"Example, Inc",USD,18,16,NA,,,20,20,Large Growth\n`;
const sourceRow={symbol:'EXAMPLE',source:'capital_gains',asOf:'2026-11-03',currency:'USD',supportLevels:[18,16],baseIV:20,averageIV:20,category:'Large Growth'};
const references=parseAdamSnapshot({retrievedAt:'2026-11-12',rows:[sourceRow]}).references;
const records={EXAMPLE:{symbol:'EXAMPLE',securityId:'EXAMPLE',reference:references.EXAMPLE}};
const response=text=>({ok:true,text:async()=>text});

test('sheet links permit only Google feeds and remove credentials and unrelated query parameters',()=>{
  assert.match(googleSheetFeed(url),/output=csv/);
  const native=googleSheetFeed('https://docs.google.com/spreadsheets/d/ExampleSpreadsheetIdentifier000000/edit?access_token=private#gid=456');
  assert.ok(native.endsWith('export?format=csv&gid=456'));assert.ok(!native.includes('private'));
  for(const input of ['http://docs.google.com/spreadsheets/d/ExampleSpreadsheetIdentifier000000/edit',
    'https://docs.google.com.attacker.example/spreadsheets/d/ExampleSpreadsheetIdentifier000000/edit',
    'https://user:password@docs.google.com/spreadsheets/d/ExampleSpreadsheetIdentifier000000/edit',
    'https://insight.piranhaprofits.com/uip/watchlist/'])assert.throws(()=>googleSheetFeed(input));
});
test('CSV parsing retains quoted commas/newlines and fails on incomplete downloads',()=>{
  assert.deepEqual(parseSheetCSV('a,"b,b","line\nnext"\r\n'),[['a','b,b','line\nnext']]);
  assert.throws(()=>parseSheetCSV('a,"incomplete'),/Incomplete/);
  const result=parseAkSheet(csv(),'capital_gains',{today:'2026-11-12'});
  assert.equal(result.asOf,'2026-11-03');assert.deepEqual(result.rows[0].supportLevels,[18,16]);assert.equal(result.rows[0].baseIV,20);
});
test('repeated dividend section headers independently map bank, REIT and income IV columns',()=>{
  const text=`Dividend Portfolio\nUpdated on:,4 Nov 26\nTicker,Currency,SL1,SL2,SL3,SL4,SL5,Intrinsic Value (5% Yield Price),Intrinsic Value (P to TBV),Intrinsic Value (by Adjusted P/BV),Classification\nBANK-SG,SGD,20,18,,,,21,22,23,Bank\nTicker,Currency,SL1,SL2,SL3,SL4,SL5,5% Yield Price,Intrinsic Value (P to TBV),Classification\nREIT-SG,SGD,2,1.8,,,,2.1,2.2,Core REIT\nTicker,Currency,SL1,SL2,SL3,SL4,SL5,Intrinsic Value (Conservative),Intrinsic Value (Base Case),Classification\nINCOME-US,USD,12,10,,,,13,14,Asset Management`;
  const {rows}=parseAkSheet(text,'dividend',{today:'2026-11-12'});
  assert.equal(rows[0].symbol,'BANK.SI');assert.equal(rows[0].adjustedPbIV,23);
  assert.equal(rows[1].historicalPbIV,2.2);assert.equal(rows[1].adjustedPbIV,null);
  assert.equal(rows[2].conservativeIV,13);assert.equal(rows[2].baseIV,14);assert.equal(rows[2].yieldIV,null);
});
test('bad dates, malformed numbers and changed support ordering cannot overwrite references',()=>{
  for(const text of [csv('31 Nov 26'),csv('3 Nov 27'),csv().replace(',18,16,',',16,18,'),csv().replace(',18,16,',',#REF!,16,')])assert.throws(()=>parseAkSheet(text,'capital_gains',{today:'2026-11-12'}));
});
test('partial sync preserves unavailable sources, does not claim complete coverage and sends no browser credentials',async()=>{
  const calls=[];const r=await readAkSources({capital_gains:url,priority_watchlist:url.replace('gid=123','gid=456')},records,{now,fetch:async(u,options)=>{
    calls.push(options);return calls.length===1?{ok:false,status:401}:response(csv('20 Oct 26','OTHER-US','Priority Watchlist'));
  }});
  assert.equal(r.readable,1);assert.equal(r.snapshot.complete,false);
  assert.equal(r.statuses.capital_gains.status,'unavailable');assert.equal(r.snapshot.rows.find(x=>x.symbol==='EXAMPLE').baseIV,20);
  assert.equal(r.snapshot.rows.find(x=>x.symbol==='OTHER').source,'priority_watchlist');
  assert.ok(calls.every(x=>x.credentials==='omit'&&x.referrerPolicy==='no-referrer'));
});
test('older replacement sheets are rejected while unchanged sheets avoid recalculating the portfolio',async()=>{
  const older=await readAkSources({capital_gains:url},records,{now,fetch:async()=>response(csv('1 Nov 26'))});
  assert.equal(older.changed,false);assert.equal(older.statuses.capital_gains.asOf,'2026-11-03');
  const same=await readAkSources({capital_gains:url},records,{now,fetch:async()=>response(csv())});
  assert.equal(same.changed,false);assert.equal(same.statuses.capital_gains.status,'unchanged');
  const writes=[];const controller=createResearchController({load:async()=>({researchBySecurity:records}),write:async p=>writes.push(p),now:()=>now.toISOString(),sheetFetch:async()=>response(csv())});
  await controller.syncAkSheets({capital_gains:url});
  assert.ok(writes.every(p=>!p.watchlist&&!p.holdings&&!p.researchBySecurity));
  assert.equal(controller.getState().sheetSyncStatus.readable,1);
});
test('restore quiescence prevents a late sheet response from importing over the restored reference',async()=>{
  let finish;const writes=[];
  const controller=createResearchController({load:async()=>({researchBySecurity:records}),write:async p=>writes.push(p),now:()=>now.toISOString(),
    sheetFetch:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=controller.syncAkSheets({capital_gains:url});
  while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
  await controller.pause();finish(response(csv('4 Nov 26')));
  await assert.rejects(pending,/cancelled/);assert.ok(writes.every(p=>!p.researchBySecurity));
});
test('copying AK SL is an explicit five-field edit and clears unpublished levels without changing alert configuration',()=>{
  const row={id:'row-one',symbol:'EXAMPLE',iv:'99',notes:'keep',s5:'7',notifEnabled:true};
  const plan=planAkLevelCopy([row],'EXAMPLE',references.EXAMPLE);
  assert.deepEqual(plan,{id:'row-one',patch:{s1:'18',s2:'16',s3:'',s4:'',s5:''}});
  assert.equal(row.s5,'7');assert.equal(row.notifEnabled,true);
  assert.throws(()=>planAkLevelCopy([row],'EXAMPLE',{...references.EXAMPLE,conflict:true}),/conflicting/);
});
test('all four readable lists are required to establish absence, with their separate sheet dates retained',async()=>{
  const titles=['Capital Gains Portfolio','Dividend Portfolio','Priority Watchlist','Secondary Watchlist'];
  const settings=Object.fromEntries(AK_SOURCES.map((s,i)=>[s.key,url.replace('gid=123','gid='+i)]));
  const r=await readAkSources(settings,{}, {now,fetch:async u=>response(csv('3 Nov 26','EXAMPLE-US',titles[Number(new URL(u).searchParams.get('gid'))]))});
  assert.equal(r.readable,4);assert.equal(r.snapshot.complete,true);
  const parsed=parseAdamSnapshot(r.snapshot,[{symbol:'UNCOVERED'}]);assert.equal(parsed.references.UNCOVERED.present,false);
  assert.equal(previousAkRows(records)[0].asOf,'2026-11-03');
});
test('the wrong list or duplicate links cannot manufacture complete four-list coverage',async()=>{
  assert.throws(()=>parseAkSheet(csv(),'dividend',{today:'2026-11-12'}),/list title/);
  await assert.rejects(readAkSources({capital_gains:url,dividend:url},{},{now}),/own sheet or tab/);
});
test('dashboard backup includes source links/check results and retains the original restore scopes',()=>{
  const state={holdings:[],watchlist:[],cash:{}};const research={records,referenceMeta:null,sourceSettings:{capital_gains:url},syncStatus:{readable:1}};
  const backup=readDashboardBackup(createDashboardBackup(state,{},research));
  const restored=prepareResearchRestore(backup.research);assert.equal(restored.sourceSettings.capital_gains,url);assert.equal(restored.syncStatus.readable,1);
  assert.equal(readDashboardBackup(createDashboardBackup(state,{})).research,undefined);
});
test('backdated confidence imports are bound to the exact source values and roll back on failed persistence',async()=>{
  const assessment=assessBackdatedSupportFit({symbol:'EXAMPLE',referenceSupports:[18,16],calculatedSupports:[18,16],referenceAsOf:'2026-11-03',asOf:'2026-11-03',studyMonth:'2026-11',modelVersion:'v1'});
  const input={retrievedAt:'2026-11-12',rows:[sourceRow],supportAssessmentsBySymbol:{EXAMPLE:assessment}};
  const writes=[];const controller=createResearchController({load:async()=>({researchBySecurity:records}),write:async p=>writes.push(p)});
  await controller.importSnapshot(input);assert.equal(controller.getState().records.EXAMPLE.backdatedSupportAssessment.confidence,'mid');
  assert.ok(writes.every(p=>!p.watchlist&&!p.holdings));
  await assert.rejects(controller.importSnapshot({...input,rows:[{...sourceRow,supportLevels:[17,15]}]}),/match the imported levels/);
  const failing=createResearchController({load:async()=>({researchBySecurity:records}),write:async()=>{throw Error('offline');}});
  await assert.rejects(failing.importSnapshot(input),/offline/);
  assert.equal(failing.getState().records.EXAMPLE.backdatedSupportAssessment,undefined);
});
