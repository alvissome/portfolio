import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResearchRequest, createResearchController, mergeResolvedWatchlistNames, parseAdamSnapshot} from '../assets/research-client.js';
import {processResearchRequest} from '../.github/scripts/research-engine.mjs';

const security = {symbol:'EXAMPLE',securityId:'EXAMPLE',held:true};
const clock = '2026-11-12T02:00:00.000Z';
const record = (id='request-one') => buildResearchRequest(security,{requestId:id,now:clock});
function storage(initial={}) {
  let doc = structuredClone(initial);
  const writes=[];
  const merge = (old, patch) => {
    const next={...old};
    for(const [key,value] of Object.entries(patch)) next[key]=value && typeof value==='object' && !Array.isArray(value)
      ? merge(old?.[key]??{},value) : structuredClone(value);
    return next;
  };
  let serial=0;
  return {writes,get:()=>doc,set:value=>{doc=value;},controller:createResearchController({load:async()=>structuredClone(doc),
    write:async patch=>{writes.push(structuredClone(patch));doc=merge(doc,patch);},now:()=>clock,uuid:()=>`request-${++serial}`})};
}

test('automatic research waits for a successful cloud read and does not replace unknown jobs after a read failure', async()=>{
  let writes=0,loadFails=true;
  const existing=record('keep-existing');
  const controller=createResearchController({load:async()=>{if(loadFails)throw Error('offline');return {researchBySecurity:{EXAMPLE:existing}};},
    write:async()=>{writes++;}});
  await controller.ensure([security]);
  assert.equal(writes,0);
  assert.equal(controller.getState().hydrated,false);
  assert.ok(controller.getState().error);
  await assert.rejects(controller.request(security,{force:true}),/not loaded/);
  assert.equal(writes,0);
  loadFails=false;
  await controller.ensure([security]);
  assert.equal(writes,0,'existing same-model request is retained after recovery');
  assert.equal(controller.getState().records.EXAMPLE.requestId,'keep-existing');
});

test('symbol entry requests independent research and never writes portfolio arrays or references', async()=>{
  const store=storage({holdings:{private:'kept'},watchlist:[{symbol:'EXAMPLE',iv:'999'}]});
  await store.controller.ensure([security]);
  await store.controller.ensure([security]);
  assert.equal(store.writes.length,1);
  const patch=store.writes[0];
  assert.deepEqual(Object.keys(patch),['researchBySecurity']);
  const request=patch.researchBySecurity.EXAMPLE;
  assert.equal(request.workerAcknowledged,false);
  assert.equal(request.iv.processing,'not_started');
  assert.equal(request.iv.result,null);
  assert.equal(Object.hasOwn(request,'reference'),false);
  assert.deepEqual(store.get().watchlist,[{symbol:'EXAMPLE',iv:'999'}]);
});

test('old cloud responses cannot replace a newer request; acknowledged worker results are received', async()=>{
  const store=storage({researchBySecurity:{EXAMPLE:record('old')}});
  await store.controller.refresh();
  await store.controller.request(security,{force:true});
  const newer=store.controller.getState().records.EXAMPLE;
  store.set({researchBySecurity:{EXAMPLE:record('old')}});
  await store.controller.refresh();
  assert.equal(store.controller.getState().records.EXAMPLE.requestId,newer.requestId);
  store.set({researchBySecurity:{EXAMPLE:{...newer,workerAcknowledged:true,iv:{...newer.iv,processing:'completed',result:{value:20,method:'Example',source:'Fixture',asOf:'2026-11-12'}}}}});
  await store.controller.refresh();
  assert.equal(store.controller.getState().records.EXAMPLE.iv.result.value,20);
});

test('a retry keeps its previous result visible but resets current comparison and never resubmits old references', async()=>{
  const previous={...record(),reference:{present:true,asOf:'2026-11-03',methodFamily:'bank'},
    iv:{result:{value:20,method:'Example',source:'Fixture',asOf:'2026-11-03'}},comparison:{iv:{status:'matched'}}};
  const next=buildResearchRequest(security,{previous,requestId:'retry',now:clock});
  assert.equal(next.iv.result,null);
  assert.equal(next.iv.previousResult.value,20);
  assert.equal(next.comparison.iv.status,'pending');
  assert.equal(next.methodFamily,'bank');
  assert.equal(Object.hasOwn(next,'reference'),false);
});

test('recalculation clears the previous cutoff through cloud merge so the worker uses the current date', async()=>{
  const store=storage({researchBySecurity:{EXAMPLE:{...record('older'),asOf:'2026-11-03'}}});
  await store.controller.refresh();
  await store.controller.request(security,{force:true});
  const saved=store.get().researchBySecurity.EXAMPLE;
  assert.equal(saved.asOf,null);
  let usedCutoff;
  await processResearchRequest(saved,{now:()=>new Date(clock),fetchData:async(_symbol,{asOf})=>{
    usedCutoff=asOf;
    return {instrument:{type:'ETF',currency:'USD'},bars:[]};
  }});
  assert.equal(usedCutoff,'2026-11-12');
});

test('auto names fill original watchlist placeholders, follow symbol edits and preserve a manual override',()=>{
  const rows=[{id:'one',symbol:'EXAMPLE',name:'EXAMPLE'},
    {id:'two',symbol:'CUSTOM',name:'My custom name'},
    {id:'three',symbol:'OTHER',name:'Old auto name',nameSource:'research',nameSymbol:'OLD',nameAutoValue:'Old auto name'},
    {id:'four',symbol:'EDITED',name:'User changed name',nameSource:'research',nameSymbol:'EDITED',nameAutoValue:'Previous auto name'}];
  const records=Object.fromEntries(['EXAMPLE','CUSTOM','OTHER','EDITED'].map(symbol=>[symbol,{securityId:symbol,symbol,instrument:{name:`Resolved ${symbol}`}}]));
  const result=mergeResolvedWatchlistNames(rows,records);
  assert.equal(result[0].name,'Resolved EXAMPLE');
  assert.equal(result[0].nameSymbol,'EXAMPLE');
  assert.equal(result[1],rows[1]);
  assert.equal(result[2].name,'Resolved OTHER');
  assert.equal(result[3],rows[3]);
  assert.equal(mergeResolvedWatchlistNames(result,records),result,'unchanged names cannot cause autosave loops');
  assert.equal(mergeResolvedWatchlistNames([{symbol:'NEW',name:''}],{NEW:{securityId:'OLD',symbol:'OLD',instrument:{name:'Wrong'}}})[0].name,'');
});

const sourceRow={symbol:'EXAMPLE',source:'capital_gains',asOf:'2026-11-03',currency:'USD',baseIV:20,averageIV:20,supportLevels:[18,16,null,null,null]};
test('reference import distinguishes no coverage from an unknown partial snapshot and keeps all valuation methods',()=>{
  const partial=parseAdamSnapshot({retrievedAt:'2026-11-12',rows:[sourceRow]},[security,{symbol:'UNKNOWN'}]);
  assert.equal(Object.hasOwn(partial.references,'UNKNOWN'),false);
  const full=parseAdamSnapshot({retrievedAt:'2026-11-12',universe:['EXAMPLE','UNCOVERED'],rows:[sourceRow,
    {symbol:'BANK-EXAMPLE',source:'dividend',asOf:'2026-11-04',currency:'SGD',classification:'Bank',yieldIV:15,historicalPbIV:14,adjustedPbIV:21,supportLevels:[18,16]}]});
  assert.equal(full.references.UNCOVERED.present,false);
  assert.equal(full.references['BANK-EXAMPLE'].iv.value,21,'bank headline is the explicitly selected adjusted P/B method, never an average or closest fit');
  assert.equal(full.references['BANK-EXAMPLE'].iv.selectedKey,'adjustedPbIV');
  assert.deepEqual(full.references['BANK-EXAMPLE'].iv.variants.map(v=>v.method),['yield_5pct','historical_pb','justified_pb']);
  assert.equal(full.references['BANK-EXAMPLE'].methodFamily,'bank');
});

test('reference import chooses source vintage independently of model values and preserves same-date conflicts',()=>{
  const parsed=parseAdamSnapshot({retrievedAt:'2026-11-12',rows:[sourceRow,
    {...sourceRow,source:'secondary_watchlist',asOf:'2026-10-20',baseIV:999},
    {...sourceRow,source:'priority_watchlist',baseIV:21}]});
  const ref=parsed.references.EXAMPLE;
  assert.equal(ref.asOf,'2026-11-03');
  assert.equal(ref.iv.value,20);
  assert.equal(ref.conflict,true);
  assert.equal(ref.entries.length,3);
});

test('private import patches only reference fields and metadata before guarded recalculation',async()=>{
  const store=storage({researchBySecurity:{EXAMPLE:{...record(),iv:{processing:'completed',result:{value:21}},supports:{processing:'completed',result:{value:[18,16]}}}}});
  await store.controller.ensure([security]);
  const metadata=await store.controller.importSnapshot({retrievedAt:'2026-11-12',universe:['EXAMPLE'],rows:[sourceRow]});
  assert.equal(metadata.dates[0],'2026-11-03');
  const referenceWrite=store.writes.find(patch=>patch.researchBySecurity?.EXAMPLE?.reference);
  assert.deepEqual(Object.keys(referenceWrite.researchBySecurity.EXAMPLE).sort(),['comparison','reference','securityId','symbol']);
  const last=store.writes.at(-1).researchBySecurity.EXAMPLE;
  assert.equal(last.iv.previousResult.value,21);
  assert.equal(store.get().researchBySecurity.EXAMPLE.reference.iv.value,20);
  assert.equal(Object.hasOwn(last,'reference'),false);
});

test('invalid snapshot data cannot write private storage or force placeholder support levels',()=>{
  assert.throws(()=>parseAdamSnapshot({retrievedAt:'2026-11-12',rows:[{...sourceRow,supportLevels:[18,0]}]}),/positive/);
  assert.throws(()=>parseAdamSnapshot({retrievedAt:'2026-11-12',rows:[{...sourceRow,currency:null}]}),/currency/);
  assert.throws(()=>parseAdamSnapshot({retrievedAt:'2026-02-30',rows:[sourceRow]}),/retrievedAt/);
});

test('overlapping forced retries coalesce until the first save settles, preventing out-of-order request writes',async()=>{
  let finish;
  let writes=0,serial=0;
  const controller=createResearchController({load:async()=>({}),now:()=>clock,uuid:()=>`request-${++serial}`,
    write:async()=>{writes++;await new Promise(resolve=>{finish=resolve;});}});
  await controller.refresh();
  const one=controller.request(security,{force:true});
  const two=controller.request(security,{force:true});
  assert.equal(one,two);
  assert.equal(writes,1);
  assert.equal(controller.getState().records.EXAMPLE.requestId,'request-1');
  finish();
  await Promise.all([one,two]);
  assert.equal(controller.getState().records.EXAMPLE.iv.processing,'not_started');
});

test('failed reference imports roll back the overlay and cannot retain an old match for a new snapshot',async()=>{
  const original={...record(),reference:{present:true,snapshotId:'old',asOf:'2026-10-20',currency:'USD',iv:{value:20},supports:[18]},
    iv:{processing:'completed',result:{value:20}},comparison:{iv:{status:'matched',snapshotId:'old',referenceAsOf:'2026-10-20'}}};
  let rejectImport,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const controller=createResearchController({load:async()=>({researchBySecurity:{EXAMPLE:structuredClone(original)}}),
    write:async patch=>{if(patch.researchReferenceSnapshotMeta){started();await new Promise((resolve,reject)=>{rejectImport=reject;});}},now:()=>clock});
  await controller.refresh();
  const importing=controller.importSnapshot({snapshotId:'new',retrievedAt:'2026-11-12',universe:['EXAMPLE'],rows:[sourceRow]});
  await waiting;
  assert.equal(controller.getState().records.EXAMPLE.reference.snapshotId,'new');
  assert.equal(controller.getState().records.EXAMPLE.comparison.iv.status,'pending');
  rejectImport(Error('offline'));
  await assert.rejects(importing,/offline/);
  assert.equal(controller.getState().records.EXAMPLE.reference.snapshotId,'old');
  assert.notEqual(controller.getState().records.EXAMPLE.comparison.iv.status,'matched');
  await controller.refresh();
  assert.equal(controller.getState().records.EXAMPLE.reference.snapshotId,'old','unsaved new snapshot cannot reappear through refresh overlay');
});

test('a deliberate method-family override is recorded, persists across retries and can return to Auto',()=>{
  const base={...record(),reference:{methodFamily:'bank'}};
  const chosen=buildResearchRequest({...security,methodFamilyOverride:'reit'},{previous:base,requestId:'selected',now:clock});
  assert.equal(chosen.methodFamily,'reit');
  assert.equal(chosen.methodFamilySource,'user');
  const retry=buildResearchRequest(security,{previous:chosen,requestId:'retry',now:clock});
  assert.equal(retry.methodFamily,'reit');
  const automatic=buildResearchRequest({...security,methodFamilyOverride:'auto'},{previous:chosen,requestId:'automatic',now:clock});
  assert.equal(automatic.methodFamily,null);
  assert.equal(automatic.methodFamilySource,'auto');
});

test('a complete market-scoped snapshot does not infer no coverage for an unresolved outside-market listing',()=>{
  const parsed=parseAdamSnapshot({retrievedAt:'2026-11-12',complete:true,coveredMarkets:['US','SG','HK'],
    rows:[sourceRow],unresolvedListings:[{sourceTicker:'UK-EXAMPLE',reason:'Unresolved listing'}]},
    [{symbol:'US-EXAMPLE'},{symbol:'OTHER.SI'},{symbol:'0001.HK'},{symbol:'UK-EXAMPLE.L'},{symbol:'OTHER.TO'}]);
  assert.equal(parsed.references['US-EXAMPLE'].present,false);
  assert.equal(parsed.references['OTHER.SI'].present,false);
  assert.equal(parsed.references['0001.HK'].present,false);
  assert.equal(Object.hasOwn(parsed.references,'UK-EXAMPLE.L'),false);
  assert.equal(Object.hasOwn(parsed.references,'OTHER.TO'),false);
  assert.deepEqual(parsed.metadata.coveredMarkets,['US','SG','HK']);
  const explicit=parseAdamSnapshot({retrievedAt:'2026-11-12',complete:true,coveredMarkets:['US','SG','HK'],
    universe:['UK-EXAMPLE.L'],rows:[sourceRow]});
  assert.equal(explicit.references['UK-EXAMPLE.L'].present,false,'an explicitly checked universe can cover an outside-market listing');
});

test('backup quiesce drains the first write, stops the next symbol and resumes only after restore failure',async()=>{
  const writes=[];let releaseFirst,started;
  const firstStarted=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{releaseFirst=resolve;});
  let cloud={};let serial=0;
  const controller=createResearchController({load:async()=>({researchBySecurity:cloud}),now:()=>clock,uuid:()=>`pause-${++serial}`,
    write:async patch=>{writes.push(patch);if(writes.length===1){started();await gate;}cloud={...cloud,...patch.researchBySecurity};}});
  const ensuring=controller.ensure([security,{symbol:'OTHER',securityId:'OTHER',held:true}]);
  await firstStarted;
  let drained=false;
  const pausing=controller.pause().then(()=>{drained=true;});
  await Promise.resolve();
  assert.equal(drained,false,'restore must wait for the already-started save');
  releaseFirst();
  await Promise.all([ensuring,pausing]);
  assert.equal(writes.length,1,'the old ensure loop cannot advance after restore is paused');
  assert.equal(controller.getState().paused,true);
  await assert.rejects(controller.request({symbol:'THIRD'},{force:true}),/paused/);
  await assert.rejects(controller.importSnapshot({retrievedAt:'2026-11-12',rows:[sourceRow]}),/paused/);
  assert.equal(writes.length,1);
  await controller.resume();
  assert.equal(controller.getState().paused,false);
  assert.equal(writes.length,2,'a failed restore may explicitly resume missing live requests');
});

test('backup quiesce also drains an active atomic reference import without starting its follow-up calculations',async()=>{
  let finishImport,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{finishImport=resolve;});
  const writes=[];
  const controller=createResearchController({load:async()=>({researchBySecurity:{EXAMPLE:record()}}),now:()=>clock,
    write:async patch=>{writes.push(patch);if(patch.researchReferenceSnapshotMeta){started();await gate;}}});
  await controller.ensure([security]);
  const importing=controller.importSnapshot({retrievedAt:'2026-11-12',universe:['EXAMPLE'],rows:[sourceRow]});
  await waiting;
  const pausing=controller.pause();
  finishImport();
  await Promise.all([importing,pausing]);
  assert.equal(writes.length,1);
  assert.ok(writes[0].researchReferenceSnapshotMeta);
  assert.equal(controller.getState().paused,true);
});

test('a restored unfinished record stays paused across model upgrades until explicit recalculation',async()=>{
  const saved={...record('restore-one'),modelVersion:'old-model-version',phase:'restored',
    iv:{processing:'blocked',reason:'Paused after backup restore.'},supports:{processing:'blocked'}};
  const writes=[];
  const controller=createResearchController({load:async()=>({researchBySecurity:{EXAMPLE:saved}}),now:()=>clock,uuid:()=> 'manual-retry',
    write:async patch=>{writes.push(patch);}});
  await controller.ensure([security]);
  assert.equal(writes.length,0,'version mismatch cannot override the restored pause');
  await controller.request(security,{force:true});
  assert.equal(writes.length,1);
  assert.equal(writes[0].researchBySecurity.EXAMPLE.phase,'requested');
  assert.equal(writes[0].researchBySecurity.EXAMPLE.modelVersion,'ak-reconstruction-v1');
});
