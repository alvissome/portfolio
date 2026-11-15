import test from 'node:test';
import assert from 'node:assert/strict';
import {viewerUrl,manualReferenceRows} from '../assets/ak-viewer.js';
import {createResearchController,parseAdamSnapshot} from '../assets/research-client.js';

test('saved CSV addresses open their corresponding viewer tab',()=>{
  const base='https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrst';
  assert.equal(viewerUrl(base+'/export?format=csv&gid=12'),base+'/edit?gid=12');
  assert.equal(viewerUrl(base.replace('/d/','/d/e/')+'/pub?gid=3&output=csv'),base.replace('/d/','/d/e/')+'/pubhtml?gid=3');
  assert.throws(()=>viewerUrl('https://example.com'));
});
test('manual entries preserve other list data and validate the support ladder',()=>{
  const entry={source:'dividend',currency:'USD',asOf:'2026-11-01',supports:[80],variants:[]};
  const values={currency:'USD',asOf:'2026-11-12',iv:'150',cost:'90',s1:'110',s2:'100'};
  const rows=manualReferenceRows('META',{entries:[entry]},'capital_gains',values);
  const result=parseAdamSnapshot({retrievedAt:values.asOf,rows}).references.META;
  assert.equal(result.entries.length,2);
  assert.equal(result.iv.value,150);
  assert.deepEqual(result.supports,[110,100]);
  assert.equal(result.entries[0].averageCost,90);
  assert.throws(()=>manualReferenceRows('META',null,'capital_gains',{...values,s1:''}));
});
test('a manual save writes a single ticker without replacing snapshot metadata',async()=>{
  const writes=[];
  const controller=createResearchController({load:async()=>({}),write:async data=>writes.push(data),
    now:()=>'2026-11-15T10:00:00Z',uuid:()=> 'demo'});
  await controller.ensure([{symbol:'META',held:true}]);
  writes.length=0;
  await controller.saveManualReference('META','capital_gains',{currency:'USD',asOf:'2026-11-12',iv:'150'},'');
  assert.ok(writes.length);
  assert.deepEqual(Object.keys(writes[0].researchBySecurity),['META']);
  assert.equal(writes[0].researchReferenceSnapshotMeta,undefined);
  await assert.rejects(controller.saveManualReference('META','capital_gains',{currency:'USD'},''));
  controller.close();
});
