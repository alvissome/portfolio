import test from 'node:test';
import assert from 'node:assert/strict';
import {claimRecord, mergeProgress, LEASE_MS} from '../.github/scripts/runResearch.js';
import {runPrivateResearch} from '../.github/scripts/research-cli.js';

const request={symbol:'EXAMPLE.HK',securityId:'EXAMPLE.HK',requestId:'one',modelVersion:'ak-reconstruction-v1',
  iv:{processing:'not_started'},supports:{processing:'not_started'},reference:{present:false}};
test('claim owns an eight-minute lease; simultaneous consumers cannot claim it',()=>{
  const first=claimRecord(request,Date.parse('2026-01-01T00:00:00Z'),'lease-one');
  assert.equal(first.workerAcknowledged,true);
  assert.equal(Date.parse(first.leaseUntil)-Date.parse(first.startedAt),LEASE_MS);
  assert.equal(claimRecord(first,Date.parse('2026-01-01T00:01:00Z'),'lease-two'),null);
  assert.equal(claimRecord(first,Date.parse('2026-01-01T00:09:00Z'),'lease-two').leaseToken,'lease-two');
});
test('completion never overwrites a newer request, a recovered lease, or imported reference',()=>{
  const claimed=claimRecord(request,Date.now(),'lease-one');
  const incoming={...claimed,phase:'finished',finishedAt:'2026-01-01',iv:{processing:'unavailable'},supports:{processing:'unavailable'},
    reference:{present:false},watchlist:[{symbol:'DO-NOT-WRITE'}]};
  assert.equal(mergeProgress({...claimed,requestId:'two'},claimed,incoming,'lease-one'),null);
  assert.equal(mergeProgress({...claimed,leaseToken:'lease-two'},claimed,incoming,'lease-one'),null);
  const fresh={...claimed,reference:{present:true,asOf:'2026-01-02',source:'New reference',iv:{value:50,method:'dcf_20y'},supports:[]}};
  const done=mergeProgress(fresh,claimed,incoming,'lease-one');
  assert.equal(done.reference,fresh.reference);
  assert.equal(done.leaseToken,null);
  assert.equal(Object.hasOwn(done,'watchlist'),false);
  assert.equal(done.comparison.supports.status,'no_reference_value');
});
test('private CLI executes shared engine without requiring or mutating Firebase',async()=>{
  const result=await runPrivateResearch({requests:[request]}, {
    fetchData:async()=>({instrument:{type:'ETF',currency:'HKD',name:'Example ETF'},bars:[]}),
    now:()=>new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].instrument.name,'Example ETF');
  assert.equal(result.records[0].iv.validation,'not_applicable');
  assert.equal(result.records[0].comparison.supports.status,'no_benchmark');
});
test('new uncovered security still calculates against proven complete market coverage',async()=>{
  const result=await runPrivateResearch({referenceSnapshotMeta:{complete:true,coveredMarkets:['US','SG','HK'],id:'complete-one'},
    requests:[{...request,symbol:'EXAMPLE',securityId:'EXAMPLE',reference:undefined}]}, {
    fetchData:async()=>({instrument:{type:'ETF',currency:'USD'},bars:[]}),
  });
  assert.equal(result.records[0].reference.present,false);
  assert.equal(result.records[0].reference.snapshotId,'complete-one');
  assert.equal(result.records[0].comparison.supports.status,'no_benchmark');
});
