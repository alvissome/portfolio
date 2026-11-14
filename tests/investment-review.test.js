import test from 'node:test';
import assert from 'node:assert/strict';
import {recordPlanReview,reviewText} from '../assets/investment-review.js';
import {createPurchasePlan,reviewPurchasePlan,previewPurchase,RULE_VERSION} from '../assets/investment-strategy.js';
import {buildCommandCentre} from '../assets/investment-command-centre.js';
import {renderCommandCentre} from '../assets/investment-command-view.js';
const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
const create=(category='core')=>createPurchasePlan({symbol:'XYZ',category,levels,base:100000,ceilingPct:{anchor:10,core:6,selective:4}[category],addBudget:10000,iv:150,currency:'USD',reviewedAt:'2026-11-14',id:'plan'});
const funding={base:100000,available:30000,byCompany:{XYZ:0},confirmed:true};
const preview=(p,f=funding,extra={})=>previewPurchase(p,f,{close:79,fx:1,iv:150,category:p.category,today:'2026-11-14',...extra});
test('Core and Selective ceilings cannot exceed the updated game plan',()=>{
 for(const category of ['core','selective'])assert.throws(()=>createPurchasePlan({...create(category),levels,base:100000,ceilingPct:10}),/ceiling/);
 assert.deepEqual(create().stages.map(s=>s.budget),[1500,1500,3000]);
 const old={...create(),ruleVersion:'2026-11-13-three-categories',ceilingPct:10,stages:create().stages.map((s,i)=>({...s,budget:[2500,2500,5000][i],spent:i===0?400:0,completed:i===0}))};
 assert.equal(preview(old).amount,null);
 const revised=reviewPurchasePlan(old,create());assert.equal(revised.ruleVersion,RULE_VERSION);assert.equal(revised.ceilingPct,6);assert.equal(revised.stages[0].spent,400);assert.equal(revised.stages[0].completed,true);assert.equal(revised.stages[1].budget,1500);
});
test('Selective previews are independent, dynamic ranges capped by cash and current company value',()=>{
 const p=create('selective');assert.equal(preview(p).minimumAmount,2000);assert.equal(preview(p).amount,4000);
 const limited=preview(p,{...funding,byCompany:{XYZ:3500}});assert.equal(limited.amount,500);assert.equal(limited.minimumAmount,500);
 const cash=preview(p,{...funding,available:700});assert.equal(cash.amount,700);assert.equal(cash.minimumAmount,700);
});
test('share quantities are reverse-calculated with whole-share odd lots and never breach a cap',()=>{
 const p=create();const board=preview(p,{...funding,available:2350},{lotSize:100});assert.equal(board.units,0);
 const odd=preview(p,{...funding,available:2350},{lotSize:100,oddLots:true});assert.equal(odd.units,29);assert.equal(odd.rawUnits,2350/80);assert.ok(odd.estimatedSpend<=2350);
 const nearest=preview(p,{...funding,available:2350},{lotSize:10,rounding:'nearest'});assert.equal(nearest.units,20);assert.ok(nearest.estimatedSpend<=2350);
});
test('known holdings and base remain visible with stale quotes; missing valuations are marked incomplete',()=>{
 const now=Date.parse('2026-11-14T02:00:00Z');
 const state={strategyCategories:{XYZ:'core'},holdings:[{ticker:'XYZ',shares:10,currency:'USD',accountType:'Cash'}],watchlist:[{symbol:'XYZ',priceCurrency:'USD',iv:150,s1:120,s2:110,s3:100,s4:90,s5:80}],priceCache:{XYZ:{close:79,timestamp:now-5*86400000}},fxRates:{USD:1.3},cash:{brokers:10000,growth:0,dividend:0}};
 const m=buildCommandCentre(state,{}, {plans:{XYZ:{...create(),lotSize:1}},funding:{}},{today:'2026-11-14',now});
 assert.equal(m.funding,null);assert.equal(m.displayFunding.base,11027);assert.equal(m.rows[0].shares,10);assert.equal(m.rows[0].currentHolding,1027);assert.equal(m.rows[0].portfolioBase,11027);assert.equal(m.rows[0].result.amount,null);
 const html=renderCommandCentre(m,{show:n=>String(n),today:'2026-11-14',filter:'all'});assert.match(html,/10 shares/);assert.doesNotMatch(html,/Portfolio base/);assert.match(html,/1027/);
 state.holdings.push({ticker:'MISSING',shares:1,currency:'USD',accountType:'Cash'});
 const partial=buildCommandCentre(state,{}, {},{today:'2026-11-14',now});assert.equal(partial.displayFunding.complete,false);assert.equal(partial.rows[0].currentHolding,1027);assert.equal(partial.rows[0].portfolioBase,null);assert.equal(partial.rows[1].currentHolding,null);
});
test('plan remarks retain immutable dated snapshots, escaped rendering and a copyable Notion review',()=>{
 const plan={...create(),remarks:'Watch <script>news</script> & compare alternatives.\nReduce if cash is needed.'};
 const config={plans:{},decisions:{}};const first=recordPlanReview(config,plan,{id:'review-1',now:'2026-11-14T01:00:00Z',base:100000,holding:1200,shares:10});
 const second=recordPlanReview(first,{...plan,remarks:'Defer next buy.'},{id:'review-2',now:'2026-11-14T02:00:00Z'});
 assert.equal(first.decisions['review-1'].note,plan.remarks);assert.equal(second.decisions['review-1'].note,plan.remarks);assert.equal(second.plans.XYZ.remarks,'Defer next buy.');
 const text=reviewText(first.decisions['review-1']);assert.match(text,/10 shares/);assert.match(text,/100,000/);assert.match(text,/Watch <script>/);assert.match(text,/review-1/);
 const html=renderCommandCentre({history:[first.decisions['review-1']],archivedPlans:[],inactiveCategories:[],visible:[],stats:{},funding:null},{show:String,today:'2026-11-14',filter:'decisions'});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-copy-review="review-1"/);
});
