import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommandCentre,resolvedCompany} from '../assets/investment-command-centre.js';
import {createPurchasePlan,fundingSignature} from '../assets/investment-strategy.js';
import {renderCommandCentre} from '../assets/investment-command-view.js';
const today='2026-11-15',now=Date.parse(today+'T02:00:00Z');
const base=()=>({strategyCategories:{AAA:'anchor',BBB:'core'},holdings:[],watchlist:['AAA','BBB'].map(symbol=>({symbol,priceCurrency:'USD',iv:200,s1:120,s2:100,s3:80})),priceCache:{AAA:{close:115,timestamp:now},BBB:{close:150,timestamp:now}},fxRates:{USD:1.3},cash:{brokers:10000,growth:5000,dividend:0}});
const config=s=>({cashTrackingVersion:1,plans:{},decisions:{},funding:{confirmed:true,basisSignature:fundingSignature(s)}});
const build=(s,c)=>buildCommandCentre(s,{},c,{today,now});
const plan=()=>({...createPurchasePlan({id:'plan-a',symbol:'AAA',category:'anchor',ceilingPct:10,addBudget:1500,base:15000,iv:200,currency:'USD',reviewedAt:today,levels:[120,100,80].map((price,i)=>({key:'s'+(i+1),price}))}),lotSize:1,plannedEntryKey:'s1'});
test('saved current plan moves to collapsed Plan set; price reached without a plan stays open',()=>{
 const s=base(),c=config(s);let m=build(s,c);assert.equal(m.stats.opportunities,1);assert.equal(m.stats.attention,0);assert.equal(m.rows[1].reviewReasons.length,0);
 c.plans.AAA=plan();m=build(s,c);assert.equal(m.rows[0].planSet,true);assert.equal(m.rows[0].openOpportunity,false);assert.equal(m.stats.opportunities,0);
 const html=renderCommandCentre(m,{show:String,today});assert.match(html,/<details class="ic-plans-set" data-section="plans-set" >/);assert.match(html,/Plan set \(1\)/);
 const before=html.slice(0,html.indexOf('class="ic-plans-set"'));assert.doesNotMatch(before,/data-opportunity="AAA"/);
});
test('deeper unused stage, updated IV and overdue review reopen a saved plan',()=>{
 for(const cause of ['deeper','iv','due']){
  const s=base(),c=config(s);c.plans.AAA=plan();
  if(cause==='deeper')s.priceCache.AAA.close=95;
  if(cause==='iv')s.watchlist[0].iv=210;
  if(cause==='due')c.plans.AAA.reviewedAt='2026-09-01';
  const r=build(s,c).rows[0];assert.equal(r.planSet,false,cause);assert.equal(r.openOpportunity,true,cause);assert.ok(r.reviewReasons.length,cause);
 }
});
test('allocation and above-IV checks apply without a plan and across Sell/Hold, independent of entry distance',()=>{
 const s=base();s.holdings=[{ticker:'AAA',accountType:'Cash',shares:100,currency:'USD'}];s.priceCache.AAA.close=250;const c=config(s);
 for(const action of [null,'sell','hold']){
  c.plans=action?{AAA:{...plan(),action,revisitOn:'2027-01-15',sale:{quantity:5,price:300}}}:{};
  const m=build(s,c),r=m.rows[0];assert.ok(r.reviewReasons.some(c=>c.key==='ceiling'));assert.ok(r.reviewReasons.some(c=>c.key==='above-iv'));assert.equal(r.openOpportunity,false);assert.equal(m.stats.attention,1);
  const html=renderCommandCentre(m,{show:String,today,filter:'attention'});assert.match(html,/Allocation above company ceiling/);assert.match(html,/Price above IV/);
 }
});
test('unplanned distant ticker is monitoring, while missing data stays in collapsed setup checks',()=>{
 const s=base(),c=config(s);s.priceCache.AAA.close=180;s.watchlist[1].iv='';const m=build(s,c);
 assert.equal(m.stats.attention,0);assert.equal(m.stats.opportunities,0);assert.equal(m.stats.setup,1);
 const html=renderCommandCentre(m,{show:String,today,filter:'attention'});assert.match(html,/<details class="ic-setup-checks" data-section="setup-checks" >/);assert.match(html,/IV unavailable/);
 const watch=renderCommandCentre(m,{show:String,today,filter:'watchlist'});assert.match(watch,/Monitoring · entry not reached/);
});
test('summary uses known cash even with stale quotes, adds sale BValue only to potential cash and nets commitments once',()=>{
 const s=base();s.holdings=[{ticker:'AAA',accountType:'Cash',shares:20,currency:'USD'}];s.priceCache.AAA.timestamp=now-5*86400000;const c=config(s);
 c.plans.AAA={...plan(),action:'sell',sale:{quantity:5,price:120}};c.funding.liabilities=1000;c.funding.pending=500;
 c.decisions={order:{id:'order',symbol:'REMOVED',status:'ordered',reserved:1000}};
 c.cashUsage={use:{id:'use',symbol:'BBB',amount:500,basis:JSON.stringify({account:'Cash',importedAt:null,brokerCash:10000}),status:'unreconciled'}};
 const m=build(s,c);assert.equal(m.funding,null);assert.equal(m.displayFunding.available,12000);assert.equal(m.potentialSales,780);assert.equal(m.potentialCash,12780);
 const html=renderCommandCentre(m,{show:String,today});assert.match(html,/Cash available now<\/span><strong>12000/);assert.match(html,/Potential cash incl. sales<\/span><strong>12780/);
});
test('planned sale proceeds first cover cash shortfalls; retiring a sale never credits official cash',()=>{
 const s=base();s.holdings=[{ticker:'AAA',accountType:'Cash',shares:1000,currency:'USD'}];const c=config(s);c.funding.liabilities=16000;c.plans.AAA={...plan(),action:'sell',sale:{quantity:5,price:120}};
 let m=build(s,c);assert.equal(m.displayFunding.available,0);assert.equal(m.potentialCash,0);
 c.plans.AAA.sale.completed=true;m=build(s,c);assert.equal(m.potentialSales,0);assert.equal(s.cash.brokers,10000);
});
test('Watchlist add is a closed dialog and plan currency follows the listing',()=>{
 const s=base(),c=config(s);const html=renderCommandCentre(build(s,c),{show:String,today,filter:'watchlist'});
 assert.match(html,/data-open-watchlist/);assert.match(html,/<dialog class="ic-add-dialog" data-watchlist-dialog/);assert.doesNotMatch(html,/<dialog[^>]*\bopen[ >]/);
 const r=resolvedCompany(s,{records:{AAA:{instrument:{currency:'USD'}}}},'AAA',{researchOverrides:{priceCurrency:'HKD'}});assert.equal(r.currency,'USD');
});
test('price sort promotes reached rows; nearest entry uses distance, not allocation headroom',()=>{
 const s=base(),c=config(s);s.priceCache.AAA.close=115;s.priceCache.BBB.close=121;
 const m=build(s,c),html=renderCommandCentre(m,{show:String,today,filter:'watchlist',categorySort:'price'});assert.ok(html.indexOf('data-opportunity="AAA"')<html.indexOf('data-opportunity="BBB"'));
 const near=renderCommandCentre(m,{show:String,today,filter:'watchlist',categorySort:'distance'});assert.ok(near.indexOf('data-opportunity="BBB"')<near.indexOf('data-opportunity="AAA"'));
});

test('changing category applies its lower ceiling before a stale plan is reviewed',()=>{
 const s=base();s.holdings=[{ticker:'AAA',accountType:'Cash',shares:8,currency:'USD'}];s.priceCache.AAA.close=100;s.strategyCategories.AAA='core';const c=config(s);c.plans.AAA=plan();
 const row=build(s,c).rows[0];assert.equal(row.ceiling,6);assert.ok(row.currentWeight>6&&row.currentWeight<10);assert.equal(row.concentration,true);assert.equal(row.planSet,false);
});
