import test from 'node:test';
import assert from 'node:assert/strict';
import {planWatchlistAddition,saveActionPlan,previewActionPlan,potentialSale} from '../assets/investment-actions.js';
import {resolvedCompany,buildCommandCentre,addDecision} from '../assets/investment-command-centre.js';
import {renderCommandCentre,renderPublicCommandCentre} from '../assets/investment-command-view.js';
import {createPurchasePlan,fundingSignature,reviewPurchasePlan} from '../assets/investment-strategy.js';
import {recordPlanReview,reviewText} from '../assets/investment-review.js';
import {planDraft} from '../assets/investment-plan-defaults.js';
const today='2026-11-15',now=Date.parse(today+'T02:00:00Z');
const state=()=>({strategyCategories:{AAA:'anchor',BBB:'core'},cash:{brokers:10000,growth:0,dividend:0},holdings:[{ticker:'AAA',name:'Example Alpha',shares:10,average_cost:70,currency:'USD',accountType:'Cash'},{ticker:'AAA',shares:5,average_cost:100,currency:'USD',accountType:'Cash'},{ticker:'AAA',shares:999,average_cost:999,currency:'USD',accountType:'Retirement - SRS'}],watchlist:[{id:'a',symbol:'AAA',priceCurrency:'USD',iv:'200',s1:'110',s2:'100',s3:'90',refCost:'85'},{id:'b',symbol:'BBB',priceCurrency:'USD',iv:'200',s1:'110',s2:'100',s3:'90'}],priceCache:{AAA:{close:105,timestamp:now},BBB:{close:90,timestamp:now}},fxRates:{USD:1.3}});
const company={symbol:'AAA',category:'anchor',shares:15,iv:200,currency:'USD',fx:1.3,quote:{close:105}};
const fields={reviewedAt:today,remarks:'Synthetic <note>',entry:120,quantity:5};
const save=(action,extra={},prior)=>saveActionPlan(prior,{...fields,action,...extra},company,{today,id:'plan-a'});
const config=s=>({plans:{},decisions:{},cashTrackingVersion:1,funding:{confirmed:true,basisSignature:fundingSignature(s)}});
const model=(s,c)=>buildCommandCentre(s,{},c,{today,now});
test('Watchlist addition requires only ticker and category, normalizes symbols and inherits holding categories',()=>{
 const s=state(),p=planWatchlistAddition({...s,watchlist:[]},{symbol:' aaa ',category:'selective',id:'row'});
 assert.equal(p.watchlist[0].symbol,'AAA');assert.equal(p.strategyCategories.AAA,'anchor');assert.equal(p.watchlist[0].iv,'');assert.equal(p.watchlist[0].levelSource,'ak');assert.equal(s.watchlist.length,2);
 assert.throws(()=>planWatchlistAddition(s,{symbol:'AAA',category:'core'}),/already/);
 assert.throws(()=>planWatchlistAddition(s,{symbol:'NEW',category:''}),/Choose/);
 const full={strategyCategories:Object.fromEntries(['A','B','C','D','E','F'].map(s=>[s,'anchor'])),watchlist:[]};
 assert.throws(()=>planWatchlistAddition(full,{symbol:'NEW',category:'anchor'}),/six/);
});
test('new ticker resolves AK first, falls back per component, and plan overrides can return to auto',()=>{
 const s={...state(),watchlist:[{symbol:'NEW'}],priceCache:{NEW:{currency:'USD',close:90,timestamp:now}}};
 const record={symbol:'NEW',securityId:'NEW',instrument:{currency:'USD',name:'Example New'},reference:{present:true,currency:'USD',iv:{value:150},supports:[100,90]},iv:{result:{value:140,currency:'USD'}},supports:{result:{value:[98,88],currency:'USD'}}};
 const r={records:{NEW:record}};assert.equal(resolvedCompany({...s,priceCache:{}},{records:{NEW:{...record,instrument:undefined}}},'NEW').currency,'USD');let c=resolvedCompany(s,r,'NEW');assert.equal(c.iv,150);assert.equal(c.levels[0].price,100);assert.equal(c.sources.iv,'AK');
 c=resolvedCompany(s,{records:{NEW:{...record,reference:{...record.reference,iv:null}}}},'NEW');assert.equal(c.iv,140);assert.equal(c.levels[0].price,100);
 c=resolvedCompany(s,r,'NEW',{researchOverrides:{iv:'160',s1:'101',refCost:'95'}});assert.equal(c.iv,160);assert.equal(c.levels[0].price,101);assert.equal(c.refCost,95);
 c=resolvedCompany(s,r,'NEW',{researchOverrides:{iv:'',s1:''}});assert.equal(c.iv,150);assert.equal(c.levels[0].price,100);
});
test('Hold requires future revisit date, never sizes buys, and becomes due on that date',()=>{
 assert.throws(()=>save('hold',{revisitOn:today}),/after today/);
 const p=save('hold',{revisitOn:'2026-12-15'});assert.equal(previewActionPlan(p,company,{today}).status,'hold');assert.equal(previewActionPlan(p,company,{today:'2026-12-15'}).status,'review');
 const s=state(),c=config(s);c.plans.AAA=p;const m=model(s,c),row=m.rows[0];assert.equal(row.action,'hold');assert.equal(row.result.amount,0);assert.equal(row.result.units,undefined);assert.equal(m.potentialSales,0);
 assert.throws(()=>addDecision(c,row,{kind:'ordered',id:'order',now:new Date(now).toISOString(),today,amount:100}),/eligible/);
});
test('Sell sizes only the planned partial holding and keeps potential cash separate from actual allowance',()=>{
 const s=state(),before=structuredClone(s),c=config(s);c.plans.AAA=save('sell');const m=model(s,c);
 assert.equal(m.rows[0].averageCost,80);assert.equal(m.rows[0].sale.native,600);assert.equal(m.potentialSales,780);assert.equal(m.funding.available,10000);assert.equal(m.potentialCash,10780);assert.equal(m.rows[0].status,'sell');assert.equal(m.rows[0].result.amount,0);assert.deepEqual(s,before);
 assert.throws(()=>save('sell',{quantity:16}),/Cash holding/);assert.throws(()=>save('sell',{quantity:0}),/positive/);assert.throws(()=>save('sell',{entry:0}),/positive/);
 c.plans.AAA=save('sell',{saleCompleted:true});assert.equal(model(s,c).potentialSales,0);
 s.holdings=s.holdings.map(h=>({...h,shares:1}));c.plans.AAA=save('sell');assert.equal(model(s,c).potentialSales,0);assert.equal(model(s,c).rows[0].status,'review');
 assert.equal(potentialSale(save('sell'),{...company,fx:undefined}).sgd,null);
});
test('action switching retains earlier purchase fills and first-time Hold does not freeze Anchor budget at zero',()=>{
 const levels=[110,100,90].map((price,i)=>({key:'s'+(i+1),price}));
 const buy=createPurchasePlan({symbol:'AAA',category:'anchor',levels,base:100000,ceilingPct:10,addBudget:6000,iv:200,currency:'USD',reviewedAt:today,id:'plan-a'});buy.stages[0].spent=500;buy.stages[0].completed=true;
 const hold=save('hold',{revisitOn:'2026-12-15'},buy),sell=save('sell',{},hold);assert.equal(sell.stages[0].spent,500);assert.equal(sell.stages[0].completed,true);
 const restored=reviewPurchasePlan(sell,{...buy,action:'buy'});assert.equal(restored.stages[0].spent,500);
 const firstHold=save('hold',{revisitOn:'2026-12-15'}),draft=planDraft({...company,levels},firstHold,{base:100000,byCompany:{AAA:1000},available:10000});assert.equal(draft.addBudget,9000);
});
test('saved plans leave Watchlist and remain in the latest-plan table',()=>{
 const s=state(),c=config(s);c.plans.AAA=save('hold',{revisitOn:'2026-12-15'});c.plans.BBB={...save('sell'),symbol:'BBB'};let m=model(s,c);
 c.decisions={defer:{id:'defer',symbol:'AAA',status:'deferred',context:m.rows[0].context,until:'2026-12-01',updatedAt:'2026-11-15T02:00:00Z'}};m=model(s,c);
 const watch=renderCommandCentre(m,{show:String,today,filter:'watchlist'});assert.doesNotMatch(watch,/data-opportunity="AAA"/);assert.doesNotMatch(watch,/data-opportunity="BBB"/);assert.match(watch,/data-add-watchlist/);assert.doesNotMatch(watch,/<table/);
 const table=renderCommandCentre(m,{show:String,today,filter:'decisions'});for(const label of ['Ticker','Company','Action','Close','Avg Price','BValue','IV','Ref cost','Current SL','Notes'])assert.ok(table.includes('>'+label+'<'),label);
 assert.equal((table.match(/data-decision-row="AAA"/g)||[]).length,1);assert.match(table,/HOLD/);assert.match(table,/2026-12-15/);assert.match(table,/US\$80.00/);assert.match(table,/Synthetic &lt;note&gt;/);assert.match(table,/Decision history & orders/);
 const core=renderCommandCentre(m,{show:String,today,filter:'watchlist',categoryFilter:'core'});assert.doesNotMatch(core,/data-opportunity="AAA"/);assert.doesNotMatch(core,/data-opportunity="BBB"/);
});
test('non-Buy review snapshots copy the explicit action and preserve dated decisions',()=>{
 const first=recordPlanReview(config(state()),save('hold',{revisitOn:'2026-12-15'}),{id:'hold-review',now:'2026-11-15T02:00:00Z'});
 const second=recordPlanReview(first,save('sell'),{id:'sell-review',now:'2026-11-15T03:00:00Z'});
 assert.match(reviewText(first.decisions['hold-review']),/HOLD\nRevisit: 2026-12-15/);assert.match(reviewText(second.decisions['sell-review']),/SELL\nSale: 5 shares/);assert.equal(second.decisions['hold-review'].action,'hold');
});
test('privacy exposes only public research and hides action, sale quantities, remarks and conditional cash',()=>{
 const s=state(),c=config(s);c.plans.AAA=save('sell',{remarks:'PRIVATE REMARK'});const m=model(s,c),html=renderPublicCommandCentre(m);
 assert.doesNotMatch(html,/PRIVATE REMARK|Potential cash|600.00|780.00|data-decision-row|data-add-watchlist/);assert.match(html,/US\$105.00/);
});
test('deferred notification timing never changes Hold action or suppresses an overdue Hold review',()=>{
 const s=state(),c=config(s);c.plans.AAA=save('hold',{revisitOn:'2026-11-16'});
 const context=model(s,c).rows[0].context;c.decisions={defer:{id:'d',symbol:'AAA',context,status:'deferred',until:'2026-12-20'}};
 const m=buildCommandCentre(s,{},c,{today:'2026-11-16',now:now+86400000});assert.equal(m.rows[0].action,'hold');assert.equal(m.rows[0].status,'review');assert.equal(m.rows[0].notificationDeferred,true);assert.ok(m.rows[0].reviewReasons.length);
 const html=renderCommandCentre(m,{show:String,today:'2026-11-16',filter:'decisions'});assert.match(html,/due/);
});
test('invalid research overrides are rejected for every non-Buy plan rather than silently saved',()=>{
 for(const researchOverrides of [{iv:'bad'},{s1:-1},{priceCurrency:'US'},{unknown:1}])assert.throws(()=>save('hold',{revisitOn:'2026-12-15',researchOverrides}));
});

test('a changed listing currency requires sale-price review and excludes conditional proceeds',()=>{
 const p=save('sell'),changed={...company,currency:'HKD',fx:.17};assert.equal(previewActionPlan(p,changed,{today}).status,'review');assert.equal(potentialSale(p,changed),null);
});
