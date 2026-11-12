import test from 'node:test';
import assert from 'node:assert/strict';
import {compareResearch, validRequest, sameRequest, needsProcessing, processResearchRequest, resolveReference, prioritizeRequests} from '../.github/scripts/research-engine.mjs';

const request={symbol:'EXAMPLE.X',securityId:'EXAMPLE.X',requestId:'one',modelVersion:'ak-reconstruction-v1',
  iv:{processing:'not_started'},supports:{processing:'not_started'}};
const reference={present:true,asOf:'2026-01-02',currency:'USD',source:'Private fixture',
  iv:{value:100,method:'dcf_20y'},supports:[90,80,70]};
const result={...request,asOf:'2026-01-02',reference,
  iv:{processing:'completed',result:{value:104,methodId:'dcf_20y',currency:'USD',asOf:'2026-01-02',pointInTimeVerified:true}},
  supports:{processing:'completed',result:{value:[91,80,70],currency:'USD',asOf:'2026-01-02',pointInTimeVerified:true}}};
test('same-method/date/currency matches require every support with no extras',()=>{
  assert.equal(compareResearch(result).iv.status,'matched');
  assert.equal(compareResearch(result).supports.status,'matched');
  assert.equal(compareResearch({...result,supports:{processing:'completed',result:{...result.supports.result,value:[91,80,70,60]}}}).supports.status,'different');
});
test('dates and financial vintages gate a passing IV without hiding its numeric error',()=>{
  const iv={...result.iv,result:{...result.iv.result,asOf:'2026-01-03'}};
  assert.equal(compareResearch({...result,iv}).iv.status,'awaiting_comparable_vintage');
  assert.equal(compareResearch({...result,iv}).iv.errorPct,4);
  assert.equal(compareResearch({...result,iv:{...result.iv,result:{...result.iv.result,pointInTimeVerified:false}}}).iv.status,'awaiting_comparable_vintage');
});
test('missing reference, explicit absence, covered missing output and ETF IV remain distinct',()=>{
  assert.equal(compareResearch({...result,reference:undefined}).iv.status,'reference_unknown');
  assert.equal(compareResearch({...result,reference:{present:false}}).iv.status,'no_benchmark');
  assert.equal(compareResearch({...result,reference:{...reference,supports:[]}}).supports.status,'no_reference_value');
  assert.equal(compareResearch({...result,iv:{validation:'not_applicable'}}).iv.status,'not_applicable');
});
test('reference variants cannot pick whichever target is closest',()=>{
  const bank={...result,reference:{...reference,iv:{variants:[{method:'yield_5pct',value:100},{method:'justified_pb',value:200}]}},
    iv:{processing:'completed',result:{...result.iv.result,variants:[{key:'yield_5pct',value:200},{key:'justified_pb',value:100}]}}};
  assert.equal(compareResearch(bank).iv.status,'different');
  assert.equal(compareResearch(bank).iv.variants[0].calculated,200);
  assert.equal(compareResearch(bank).iv.variants[1].calculated,100);
});
test('ordinary-equity P/B cannot pass an unreconciled tangible-book benchmark',()=>{
  const bank={...result,reference:{...reference,iv:{variants:[{method:'historical_pb',value:100}]}},
    iv:{processing:'completed',result:{...result.iv.result,variants:[{key:'historical_pb',basis:'unadjusted_equity',value:100}]}}};
  assert.equal(compareResearch(bank).iv.status,'method_mismatch');
  assert.equal(compareResearch({...bank,reference:{...bank.reference,iv:{variants:[{method:'historical_pb',basis:'unadjusted_equity',value:100}]}}}).iv.status,'matched');
});
test('headline uses the explicit base variant while keeping nonselected alternatives separate',()=>{
  const growth={...result,reference:{...reference,iv:{selectedKey:'baseIV',variants:[
    {key:'conservativeIV',method:'other_forecast',value:50},{key:'baseIV',method:'dcf_20y',value:100},{key:'averageIV',method:'average_forecasts',value:75}]}},
    iv:{...result.iv,result:{...result.iv.result,value:104}}};
  const comparison=compareResearch(growth).iv;
  assert.equal(comparison.status,'matched');
  assert.equal(comparison.selectedKey,'baseIV');
  assert.equal(comparison.variants.length,3);
});
test('conflicting reference sources cannot produce a matching badge',()=>{
  const comparison=compareResearch({...result,reference:{...reference,conflict:true}});
  assert.equal(comparison.iv.status,'reference_conflict');
  assert.equal(comparison.iv.errorPct,4);
  assert.equal(comparison.supports.status,'reference_conflict');
  assert.equal(comparison.supports.matchedCount,3);
});
test('complete imported coverage establishes absence only within covered markets',()=>{
  const meta={complete:true,coveredMarkets:['US','SG','HK'],snapshotId:'snapshot-one'};
  assert.equal(resolveReference({...request,symbol:'EXAMPLE',reference:undefined},meta).present,false);
  assert.equal(resolveReference({...request,symbol:'EXAMPLE.L',reference:undefined},meta),undefined);
  assert.equal(resolveReference({...request,reference:undefined},{...meta,complete:false}),undefined);
  assert.equal(resolveReference({...request,reference:{present:true}},meta).present,true);
});
test('actual queue ordering prioritizes held securities and then FIFO requests',()=>{
  const entries=[['watched',{priority:'watchlist',requestedAt:'2026-01-01'}],
    ['held-later',{priority:'holding',requestedAt:'2026-01-03'}],['held-first',{priority:'holding',requestedAt:'2026-01-02'}]];
  assert.deepEqual(prioritizeRequests(entries).map(([key])=>key),['held-first','held-later','watched']);
});
test('identities and leases prevent stale work and recover abandoned processing',()=>{
  assert.equal(validRequest(request),true);
  assert.equal(validRequest({...request,symbol:'../escape'}),false);
  assert.equal(sameRequest(request,{...request,requestId:'two'}),false);
  assert.equal(needsProcessing(request),true);
  const claimed={...request,workerAcknowledged:true,leaseUntil:'2026-01-01T00:10:00Z'};
  assert.equal(needsProcessing(claimed,Date.parse('2026-01-01T00:05:00Z')),false);
  assert.equal(needsProcessing(claimed,Date.parse('2026-01-01T00:11:00Z')),true);
});
test('no-benchmark calculation still calls both independent models and ends fetch failures visibly',async()=>{
  let calls=0;
  const record=await processResearchRequest({...request,reference:{present:false}}, {
    fetchData:async()=>{calls++;return{instrument:{type:'ETF',currency:'USD'},bars:[]};},
    now:()=>new Date('2026-01-02T00:00:00Z'),
  });
  assert.equal(calls,1);
  assert.equal(record.iv.validation,'not_applicable');
  assert.equal(record.supports.processing,'unavailable');
  assert.equal(record.comparison.supports.status,'no_benchmark');
  const failed=await processResearchRequest(request,{fetchData:async()=>{throw new Error('secret URL must not appear');}});
  assert.equal(failed.iv.processing,'failed');
  assert.ok(!JSON.stringify(failed).includes('secret URL'));
});
test('failed refresh retains the previous successful output without calling it completed',async()=>{
  const old={value:90,method:'Old method',asOf:'2026-01-01'};
  const refreshed=await processResearchRequest({...request,iv:{processing:'not_started',previousResult:old}},
    {fetchData:async()=>{throw new Error('Unavailable');}});
  assert.equal(refreshed.iv.processing,'failed');
  assert.equal(refreshed.iv.result,null);
  assert.deepEqual(refreshed.iv.previousResult,old);
});
