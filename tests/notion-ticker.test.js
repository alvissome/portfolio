import test from 'node:test';
import assert from 'node:assert/strict';
import {upsert} from '../.github/scripts/notion-ticker.mjs';
const request={action:'buy',stage:'s3',quantity:0,price:103,currency:'USD',reviewed:'2026-11-17',record:'current review'};
test('first export creates a ticker and a later export updates that same page',async()=>{
 let exists=false;
 const writes=[];
 async function api(path,method,body){
   if(path.endsWith('/query')){
     assert.deepEqual(body.filter,{property:'Ticker',title:{equals:'NVDA'}});
     return {results:exists?[{id:'nvda-page'}]:[]};
   }
   writes.push({path,method,body});exists=true;
 }
 await upsert('NVDA',request,api);
 await upsert('NVDA',{...request,quantity:5},api);
 assert.deepEqual(writes.map(w=>[w.path,w.method]),[['pages','POST'],['pages/nvda-page','PATCH']]);
 assert.deepEqual(writes.map(w=>w.body.properties.Quantity.number),[0,5]);
 assert.equal(writes[1].body.properties.Stage.rich_text[0].text.content,'S3');
});
test('duplicate ticker rows cannot be overwritten',async()=>{
 await assert.rejects(upsert('SPGI',request,async()=>({results:[{},{}]})),/Duplicate ticker/);
});
