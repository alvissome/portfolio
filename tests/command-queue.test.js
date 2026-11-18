import {researchFromLevels} from './fixtures/company-research.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommandCentre,resolvedCompany,addDecision} from '../assets/investment-command-centre.js';
import {createPurchasePlan,fundingSignature} from '../assets/investment-strategy.js';
import {renderCommandCentre} from '../assets/investment-command-view.js';
const today='2026-11-15',now=Date.parse(today+'T02:00:00Z');
const base=()=>({strategyCategories:{AAA:'anchor',BBB:'core'},holdings:[],researchLevels:['AAA','BBB'].map(symbol=>({symbol,priceCurrency:'USD',iv:200,s1:120,s2:100,s3:80})),watchlist:['AAA','BBB'].map(symbol=>({symbol})),priceCache:{AAA:{close:115,timestamp:now},BBB:{close:150,timestamp:now}},fxRates:{USD:1.3},cash:{brokers:10000,growth:5000,dividend:0}});
const config=s=>({cashTrackingVersion:1,plans:{},decisions:{},funding:{confirmed:true,basisSignature:fundingSignature(s)}});
const build=(s,c)=>buildCommandCentre(s,researchFromLevels(s.researchLevels),c,{today,now});
const plan=()=>({...createPurchasePlan({id:'plan-a',symbol:'AAA',category:'anchor',ceilingPct:10,addBudget:1500,base:15000,iv:200,currency:'USD',reviewedAt:today,levels:[120,100,80].map((price,i)=>({key:'s'+(i+1),price}))}),lotSize:1,plannedEntryKey:'s1'});
test('saved buy plans appear in Opportunities while other views retain their existing scope',()=>{
 const s=base(),c=config(s);c.plans.AAA=plan();s.researchLevels[0].iv=210;
 const m=build(s,c);assert.equal(m.rows[0].openOpportunity,true);
 for(const filter of ['watchlist','balance','data'])assert.doesNotMatch(renderCommandCentre(m,{show:String,today,filter}),/data-opportunity="AAA"/);
 assert.match(renderCommandCentre(m,{show:String,today,filter:'decisions'}),/data-decision-row="AAA"/);
});
test('opportunities contain held stocks at or within five percent of support, not distant holdings',()=>{
 const s=base();s.holdings=[{ticker:'AAA',accountType:'Cash',shares:1,currency:'USD'}];const c=config(s);
 for(const [close,expected]of [[115,true],[125,true],[127,false],[180,false]]){s.priceCache.AAA.close=close;assert.equal(build(s,c).rows[0].openOpportunity,expected);}
 s.holdings=[];assert.equal(build(s,c).rows[0].openOpportunity,false);
});
test('rebalancing labels above-IV and ceiling conditions; data review excludes missing plans',()=>{
 const s=base();s.holdings=[{ticker:'AAA',accountType:'Cash',shares:100,currency:'USD'}];s.priceCache.AAA.close=250;const c=config(s),m=build(s,c);
 assert.ok(m.rows[0].lists.includes('balance'));assert.ok(!m.rows[0].lists.includes('data'));
 const html=renderCommandCentre(m,{show:String,today,filter:'balance'});assert.match(html,/Price above IV/);assert.match(html,/Allocation above company ceiling/);
 s.researchLevels[0].iv='';assert.match(renderCommandCentre(build(s,c),{show:String,today,filter:'data'}),/Review data before setting a plan/);
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
test('decision table supports combined action filters and shows planned quantity, price and following support',()=>{
 const s=base(),c=config(s);c.plans.AAA=plan();c.plans.AAA.stages[0].purchaseQuantity=3;c.plans.AAA.stages[0].entryPrice=119;
 c.plans.BBB={...plan(),symbol:'BBB',action:'hold',revisitOn:'2027-01-01'};
 const m=build(s,c);const html=renderCommandCentre(m,{show:String,today,filter:'decisions',actionFilter:['buy','sell']});
 assert.match(html,/Next SL/);assert.match(html,/Quantity/);assert.match(html,/Entry \/ sale price/);assert.match(html,/US\$119.00/);assert.match(html,/>3<\/td>/);assert.match(html,/data-decision-row="AAA"/);assert.doesNotMatch(html,/data-decision-row="BBB"/);assert.match(html,/Stages &amp; fills|Stages & fills/);assert.match(html,/Record pending order/);
 const none=renderCommandCentre(m,{show:String,today,filter:'decisions',actionFilter:[]});assert.doesNotMatch(none,/data-decision-row=/);
});

test('opportunity summary matches visible cards and separates reached from approaching with category filters',()=>{
 const s=base();s.holdings=['AAA','BBB'].map(ticker=>({ticker,accountType:'Cash',shares:1,currency:'USD'}));s.priceCache.BBB.close=121;
 let c=config(s),m=build(s,c);
 assert.equal(m.stats.opportunities,2);
 let html=renderCommandCentre(m,{show:String,today});
 assert.match(html,/Open opportunities<\/span><strong>2<\/strong><small>1 price reached · 1 approaching support/);
 assert.equal((html.match(/data-opportunity=/g)||[]).length,2);
 assert.match(html,/Approaching support · set up plan/);
 html=renderCommandCentre(m,{show:String,today,categoryFilter:'core'});
 assert.match(html,/Open opportunities<\/span><strong>1<\/strong><small>0 price reached · 1 approaching support/);
 assert.equal((html.match(/data-opportunity=/g)||[]).length,1);
 c=addDecision(c,m.rows.find(r=>r.symbol==='AAA'),{kind:'dismissed',id:'dismiss',today,now:today+'T02:00:00Z'});
 m=build(s,c);assert.equal(m.stats.opportunities,1);
 html=renderCommandCentre(m,{show:String,today});assert.equal((html.match(/data-opportunity=/g)||[]).length,1);assert.match(html,/Open opportunities<\/span><strong>1/);
 c=addDecision(c,m.rows.find(r=>r.symbol==='BBB'),{kind:'deferred',id:'defer',until:'2026-12-01',today,now:today+'T02:00:00Z'});
 m=build(s,c);assert.equal(m.stats.opportunities,0);html=renderCommandCentre(m,{show:String,today});assert.doesNotMatch(html,/data-opportunity=/);assert.match(html,/Open opportunities<\/span><strong>0/);
});

test('My decisions puts Notion sync buttons last and opens company-specific execution without nested stage headings',()=>{
 const s=base(),c=config(s);c.plans.AAA=plan();c.plans.BBB={...plan(),symbol:'BBB',action:'hold',stages:[],revisitOn:'2027-01-01'};
 const m=build(s,c);let html=renderCommandCentre(m,{show:String,today,filter:'decisions'});
 assert.match(html,/<th>Manage<\/th><th>Notion<\/th><\/tr>/);
 assert.match(html,/data-sync-company="AAA"/);assert.match(html,/data-sync-company="BBB"/);
 assert.match(html,/data-company-detail-row="AAA" hidden/);assert.doesNotMatch(html,/<summary>Purchase stages|data-copy-review/);
 html=renderCommandCentre(m,{show:String,today,filter:'decisions',expandedSymbol:'AAA'});
 assert.match(html,/data-company-details="AAA" aria-expanded="true"/);assert.match(html,/data-company-detail-row="AAA" ><td/);
 assert.match(html,/AAA · Stages, fills & orders/);assert.match(html,/data-fill="AAA"/);assert.match(html,/data-company-detail-row="BBB" hidden/);
});

test('completed stages advance opportunity cards and distant plans remain watchable',()=>{
 const s=base(),c=config(s);c.plans.AAA=plan();
 c.plans.AAA.stages[0].completed=true;c.plans.AAA.stages[0].spent=490;
 for(const [close,stage,active] of [[104,'s2',true],[100,'s2',true],[79,'s3',true],[110,'s2',false]]){
  s.priceCache.AAA.close=close;
  const m=build(s,c),row=m.rows[0],html=renderCommandCentre(m,{show:String,today});
  assert.equal(row.entryStage.key,stage);assert.equal(row.openOpportunity,active);
  assert.equal(m.stats.opportunities,Number(active));
  assert.match(html,/S1 completed/);assert.match(html,/Remaining stage budget/);
  assert.match(html,/data-fill="AAA"/);
  assert.equal(html.includes('Watching next entry · 1'),!active);
 }
 s.priceCache.AAA.timestamp=now-5*86400000;
 let m=build(s,c);assert.equal(m.rows[0].openOpportunity,false);
 assert.match(renderCommandCentre(m,{show:String,today}),/Quote needs refreshing/);
 c.plans.AAA.stages.forEach(s=>{s.completed=true;s.spent=s.budget;});
 m=build(s,c);assert.equal(m.rows[0].monitoringBuy,false);
 assert.doesNotMatch(renderCommandCentre(m,{show:String,today}),/data-opportunity="AAA"/);
});
test('hold and sell plans stay out of buying opportunities',()=>{
 for(const action of ['hold','sell']){
  const s=base(),c=config(s);c.plans.AAA={...plan(),action,revisitOn:'2026-12-15',sale:{quantity:1,price:115}};
  const m=build(s,c);assert.equal(m.rows[0].monitoringBuy,false);
  assert.doesNotMatch(renderCommandCentre(m,{show:String,today}),/data-opportunity="AAA"/);
 }
});
