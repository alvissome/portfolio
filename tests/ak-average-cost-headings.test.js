import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAkSheet,readAkSources} from '../assets/ak-sheet-sources.js';
import {parseAdamSnapshot} from '../assets/research-client.js';
import {akReferenceCost} from '../assets/ak-reference-cost.js';

const growth = `Capital Gains Portfolio
Updated on:,14 Nov 26
Ticker,Currency,SL1,SL2,SL3,SL4,SL5,Base IV,Avg. Price
NVDA-US,USD,200,169,153,130,91,250,US$61.25
META-US,USD,650,600,550,500,400,900,$180.50
NVO-US,USD,50,45,40,36,,90,25.75`;

test('NVDA, META and NVO average-price columns survive AK IV/SL import', () => {
  const parsed=parseAkSheet(growth,'capital_gains',{today:'2026-11-15'});
  assert.equal(parsed.costHeaderFound,true);
  assert.deepEqual(parsed.rows.map(r=>[r.symbol,r.averageCost]),[['NVDA',61.25],['META',180.5],['NVO',25.75]]);
  const reference=parseAdamSnapshot({retrievedAt:'2026-11-15',rows:parsed.rows}).references;
  for(const ticker of ['NVDA','META','NVO']){
    assert.ok(reference[ticker].iv.value>0);
    assert.ok(reference[ticker].supports.length>=4);
    assert.equal(akReferenceCost({reference:reference[ticker]},'buy','USD').value,parsed.rows.find(r=>r.symbol===ticker).averageCost);
  }
});
test('additional active average-cost labels resolve without borrowing IV, sale or cost-basis values',()=>{
 const base=growth.split('\n').slice(0,3).join('\n');
 for(const label of ['Avg Cost','Average Cost (USD)','Average Purchase Price','Avg Buy Price','Average Entry Price','Average Cost Per Share','Avg Price']){
   const sheet=base.replace('Avg. Price',label)+'\nNVDA-US,USD,200,169,153,130,91,250,61.25';
   assert.equal(parseAkSheet(sheet,'capital_gains',{today:'2026-11-15'}).rows[0].averageCost,61.25,label);
 }
 const noCost=base.replace(',Avg. Price','')+'\nNVDA-US,USD,200,169,153,130,91,250';
 const row=parseAkSheet(noCost,'capital_gains',{today:'2026-11-15'});
 assert.equal(row.costHeaderFound,false);assert.equal(row.rows[0].averageCost,null);
});
test('closed-position average price is treated only as sale price',()=>{
 const parsed=parseAkSheet(`Closed Positions
Updated on:,14 Nov 26
Ticker,Currency,Average Price
META-US,USD,320.25`,'closed_positions',{today:'2026-11-15'});
 assert.equal(parsed.costHeaderFound,true);
 assert.equal(parsed.rows[0].averageSellPrice,320.25);
 assert.equal(parsed.rows[0].averageCost,null);
 const ref=parseAdamSnapshot({retrievedAt:'2026-11-15',rows:parsed.rows}).references.META;
 assert.equal(akReferenceCost({reference:ref},'sell','USD').value,320.25);
 assert.equal(akReferenceCost({reference:ref},'buy','USD').value,null);
});
test('sheet read reports cost-column coverage separately from IV and support validity',async()=>{
 const settings={capital_gains:'https://docs.google.com/spreadsheets/d/e/2PACX-ExampleIdentifier000000000/pubhtml?gid=1'};
 const result=await readAkSources(settings,{},{
   now:new Date('2026-11-15T09:00:00Z'),
   fetch:async()=>({ok:true,text:async()=>growth})
 });
 assert.equal(result.readable,1);
 assert.equal(result.statuses.capital_gains.costHeaderFound,true);
 assert.equal(result.snapshot.rows.find(r=>r.symbol==='NVDA').averageCost,61.25);
});
