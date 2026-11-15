import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createInvestmentStore} from '../assets/investment-store.js';

function cloudHarness(){
  let version=1,strategy={plans:{NVDA:{action:'hold'}},decisions:{}},checks=0,writes=0;
  function encode(value){
    if(value===null)return {nullValue:null};
    if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
    if(typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
    if(typeof value==='string')return {stringValue:value};
    if(typeof value==='boolean')return {booleanValue:value};
    return {integerValue:String(value)};
  }
  const fetch=async(url,options)=>{
    if(options.method==='POST'){
      writes++;
      const input=JSON.parse(options.body);
      const expected=input.writes[0].currentDocument.updateTime;
      if(expected!=='revision-'+version)return {ok:false,status:409,json:async()=>({error:{status:'FAILED_PRECONDITION'}})};
      return {ok:true,status:200,json:async()=>({writeResults:[{updateTime:'revision-'+ ++version}]})};
    }
    checks++;
    return {ok:true,status:200,json:async()=>({updateTime:'revision-'+version,fields:{settings:encode({investmentStrategy:strategy})}})};
  };
  const create=()=>createInvestmentStore({projectId:'personal-test',uid:'test-user',getToken:async()=>'private-token',fetch});
  return {create,get checks(){return checks},get writes(){return writes},set(data){strategy=data;version++},touch(){version++}};
}
async function eventually(predicate){
  for(let n=0;n<40;n++){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,8));
  }
  assert.fail('Expected cloud observation was not received');
}
test('auto watch observes changed remote plan without saving or discarding the local revision',async()=>{
  const h=cloudHarness(),store=h.create();
  const initial=await store.load();assert.equal(initial.plans.NVDA.action,'hold');
  const seen=[];
  const stop=store.watch(remote=>seen.push(remote),error=>assert.fail(error.message),{intervalMs:6});
  try{
    h.set({plans:{NVDA:{action:'buy',quantity:10}},decisions:{}});
    await eventually(()=>seen.length>0);
    assert.equal(seen[0].strategy.plans.NVDA.quantity,10);
    assert.equal(h.writes,0);
    // Until UI accepts the remote revision, its original version precondition
    // protects pending local inputs from an accidental overwrite.
    await assert.rejects(store.save({plans:{NVDA:{quantity:5}}}),/another tab or device/);
    assert.equal(h.writes,1);
    assert.equal((await store.readLatest()).strategy.plans.NVDA.quantity,10);
    assert.equal(store.acceptCloud(seen[0]),true);
    await store.save({plans:{NVDA:{quantity:12}}});
    assert.equal(h.writes,2);
  }finally{stop();}
});
test('accepted non-CC performance document revisions do not force decision conflicts',async()=>{
  const h=cloudHarness(),store=h.create();
  await store.load();
  let calls=0;
  const stop=store.watch(remote=>{calls++;store.acceptCloud(remote);},error=>assert.fail(error.message),{intervalMs:6});
  try{
    h.touch();
    await eventually(()=>calls>0);
    await store.save({plans:{NVDA:{action:'buy'}}});
    assert.equal(h.writes,1);
  }finally{stop();}
});
test('unsubscribing an automatic watcher stops subsequent cloud reads',async()=>{
  const h=cloudHarness(),store=h.create();
  await store.load();
  const stop=store.watch(()=>{},()=>{},{intervalMs:6});
  stop();
  const before=h.checks;
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(h.checks,before);
});
test('CC screen has bulk AK sync in place of reload, protects forms, and Settings owns the AK links',async()=>{
  const panel=await readFile(new URL('../assets/investment-panel.js',import.meta.url),'utf8');
  const main=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
  assert.match(panel,/data-sync-ak/);
  assert.doesNotMatch(panel,/data-reload-command|Reload saved decisions/);
  assert.doesNotMatch(panel,/className:'ic-watchlist-host'/);
  assert.match(panel,/watchStop=storage\.watch/);
  assert.match(panel,/pendingCloud=cloud;cloudWarning\(\)/);
  assert.match(panel,/A newer CC plan was saved elsewhere/);
  assert.match(main,/function ON\(\{state:n,onUpdate:e,onClose:t,uid:r,research:akResearch\}\)/);
  assert.match(main,/m\.jsx\(SharedAkSheetControls,\{research:akResearch,renderLayout:/);
  assert.match(main,/e&&m\.jsx\(ON,\{state:d,onUpdate:w,onClose:\(\)=>t\(!1\),uid:n\.uid,research\}\)/);
});
