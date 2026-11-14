import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestmentStore} from '../assets/investment-store.js';
function cloud(){
 let version='2026-11-14T00:00:00.000000Z',strategy={},writes=0;const calls=[];
 const value=o=>({mapValue:{fields:Object.fromEntries(Object.entries(o).map(([k,v])=>[k,typeof v==='object'&&v!==null?value(v):typeof v==='number'?{integerValue:String(v)}:typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)}]))}});
 const request=async(url,options)=>{
  calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer test-user-id-token');
  if(!options.method)return {status:200,ok:true,json:async()=>({updateTime:version,fields:{settings:value({investmentStrategy:strategy}),snapshots:value({keep:'unchanged'})}})};
  const write=JSON.parse(options.body).writes[0];
  assert.deepEqual(write.updateMask.fieldPaths,['settings.investmentStrategy']);
  assert.equal(write.update.name,'projects/personal-test/databases/(default)/documents/users/alvin/portfolio/performance');
  if(write.currentDocument.updateTime!==version)return {ok:false,status:409,json:async()=>({error:{status:'FAILED_PRECONDITION'}})};
  writes++;version='2026-11-14T00:00:0'+writes+'.000000Z';strategy=write.update.fields.settings.mapValue.fields.investmentStrategy.mapValue.fields;
  return {ok:true,status:200,json:async()=>({writeResults:[{updateTime:version}]})};
 };
 const store=()=>createInvestmentStore({projectId:'personal-test',uid:'alvin',getToken:async()=>'test-user-id-token',fetch:request});
 return {store,calls,get writes(){return writes;}};
}
test('saving changes only investment settings, retains cloud precondition, and never writes before loading',async()=>{
 const c=cloud(),store=c.store();await assert.rejects(store.save({}),/Load cloud/);
 assert.deepEqual(await store.load(),{});await store.save({pending:500,confirmed:true,note:'test',nothing:null,rows:[1,2]});
 assert.equal(c.writes,1);assert.equal(c.calls[0].options.cache,'no-store');
 const payload=JSON.parse(c.calls[1].options.body);assert.deepEqual(payload.writes[0].currentDocument,{updateTime:'2026-11-14T00:00:00.000000Z'});
 assert.ok(!('snapshots'in payload.writes[0].update.fields));
});
test('two devices cannot overwrite each other or double reserve the same stale cash',async()=>{
 const c=cloud(),first=c.store(),second=c.store();await first.load();await second.load();
 await first.save({reserved:500});
 await assert.rejects(second.save({reserved:600}),/another tab or device/);assert.equal(c.writes,1);
 await assert.rejects(second.save({reserved:600}),/Load cloud/);
 await second.load();await second.save({reserved:100});assert.equal(c.writes,2);
});
test('missing documents use a create-only precondition and auth failure sends no request',async()=>{
 let writes;
 const store=createInvestmentStore({projectId:'personal-test',uid:'alvin',getToken:async()=>'token',fetch:async(url,options)=>{
  if(!options.method)return {status:404,ok:false};writes=JSON.parse(options.body).writes;
  return {status:200,ok:true,json:async()=>({writeResults:[{updateTime:'2026-11-14T00:00:00Z'}]})};
 }});
 assert.deepEqual(await store.load(),{});await store.save({});assert.deepEqual(writes[0].currentDocument,{exists:false});
 const signedOut=createInvestmentStore({projectId:'personal-test',uid:'alvin',getToken:async()=>{throw Error('Sign in again');},fetch:async()=>assert.fail('Must not send request')});
 await assert.rejects(signedOut.load(),/Sign in/);
});
test('ambiguous network save failures require reload rather than risk duplicate decisions',async()=>{
 const store=createInvestmentStore({projectId:'personal-test',uid:'alvin',getToken:async()=>'token',fetch:async(url,options)=>{
  if(!options.method)return {status:404,ok:false};throw Error('connection lost');
 }});
 await store.load();await assert.rejects(store.save({reserved:500}),/unconfirmed/);await assert.rejects(store.save({reserved:600}),/Load cloud/);
});

test('Firestore codec round-trips command data and ignores unrelated timestamp settings',async()=>{
 let fields={settings:{mapValue:{fields:{unrelated:{timestampValue:'2026-11-14T00:00:00Z'}}}}};
 let version='2026-11-14T00:00:00Z';
 const store=createInvestmentStore({projectId:'personal-test',uid:'alvin',getToken:async()=>'token',fetch:async(url,options)=>{
  if(!options.method)return {status:200,ok:true,json:async()=>({fields,updateTime:version})};
  const write=JSON.parse(options.body).writes[0];fields=write.update.fields;version='2026-11-14T00:00:01Z';
  return {status:200,ok:true,json:async()=>({writeResults:[{updateTime:version}]})};
 }});
 assert.deepEqual(await store.load(),{});
 const data={sequence:1,amount:123.45,confirmed:false,empty:null,note:'',stages:[{id:'s1',completed:true},2]};
 await store.save(data);assert.deepEqual(await store.load(),data);
});
