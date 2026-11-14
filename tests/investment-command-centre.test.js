import test from 'node:test';
import assert from 'node:assert/strict';
import {currentUniverse,buildCommandCentre,addDecision,settleOrder,reservedCash} from '../assets/investment-command-centre.js';
import {renderCommandCentre,renderOpportunityCard} from '../assets/investment-command-view.js';
import {createPurchasePlan,reviewPurchasePlan,fundingSignature} from '../assets/investment-strategy.js';
import {createDashboardBackup,readDashboardBackup} from '../assets/dashboard-backup.js';
const today='2026-11-14',now=Date.parse('2026-11-14T02:00:00Z'),iso=new Date(now).toISOString();
const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
const state=()=>({strategyCategories:{AAA:'anchor',BBB:'core'},holdings:[{ticker:'AAA',name:'Alpha',accountType:'Cash',shares:5,currency:'USD'},{ticker:'RET',accountType:'Retirement - SRS',shares:999,currency:'USD'}],watchlist:[{symbol:'AAA',name:'Alpha',priceCurrency:'USD',iv:'150',s1:'120',s2:'110',s3:'100',s4:'90',s5:'80'},{symbol:'BBB',name:'Beta',priceCurrency:'USD',iv:'150',s1:'120',s2:'110',s3:'100',s4:'90',s5:'80'}],priceCache:{AAA:{close:95,timestamp:now},BBB:{close:95,timestamp:now}},fxRates:{USD:1.3},cash:{brokers:50000,growth:50000,dividend:0,srs:999999,cpfIs:999999}});
const plan=(symbol='AAA',category='anchor')=>({...createPurchasePlan({symbol,category,levels,base:100000,ceilingPct:10,addBudget:10000,iv:150,currency:'USD',reviewedAt:today,id:'plan-'+symbol}),feeReserve:20,lotSize:1});
const config=s=>({plans:{AAA:plan(),BBB:plan('BBB','core')},funding:{confirmed:true,basisSignature:fundingSignature(s),pending:0,liabilities:0},decisions:{}});
const model=(s,c)=>buildCommandCentre(s,{},c,{today,now});
const action=(c,row,kind,extra={})=>addDecision(c,row,{kind,id:kind+'-'+(Object.keys(c.decisions).length+1),now:iso,today,...extra});
test('quarterly replacement adds new tickers, retires removed watchlist-only tickers and retains actual holdings',()=>{
 const s=state(),c=config(s);const changed={...s,watchlist:[{symbol:'NEW',iv:'50',s1:'40'}]};
 assert.deepEqual(currentUniverse(changed).map(r=>r.symbol),['AAA','NEW']);
 const m=model(changed,c);assert.equal(m.rows.find(r=>r.symbol==='NEW').result.amount,null);
 assert.equal(m.rows.find(r=>r.symbol==='NEW').category,'');assert.equal(m.rows.find(r=>r.symbol==='AAA').held,true);
 assert.deepEqual(m.archivedPlans.map(p=>p.symbol),['BBB']);assert.ok(!m.rows.some(r=>r.symbol==='RET'));
});
test('removed and re-added tickers retain their plan, budgets and completed fills',()=>{
 const s=state(),c=config(s);c.plans.BBB.stages[0]={...c.plans.BBB.stages[0],completed:true,spent:1200};
 const removed={...s,watchlist:s.watchlist.filter(w=>w.symbol!=='BBB')};assert.equal(model(removed,c).archivedPlans[0].stages[0].spent,1200);
 const restored=model({...removed,watchlist:[...removed.watchlist,{...s.watchlist[1],id:'new-row-id'}]},c).rows.find(r=>r.symbol==='BBB');
 assert.equal(restored.plan.stages[0].completed,true);assert.equal(restored.plan.stages[0].spent,1200);
});
test('category, IV, support ladder and rule changes withhold amounts pending review',()=>{
 const s=state(),c=config(s);assert.equal(model(s,c).rows[0].status,'eligible');
 for(const changed of [{...s,strategyCategories:{...s.strategyCategories,AAA:'selective'}},{...s,watchlist:s.watchlist.map(w=>w.symbol==='AAA'?{...w,iv:'140'}:w)},{...s,watchlist:s.watchlist.map(w=>w.symbol==='AAA'?{...w,s3:'99'}:w)}])assert.equal(model(changed,c).rows.find(r=>r.symbol==='AAA').result.amount,null);
 assert.equal(model(s,{...c,plans:{...c.plans,AAA:{...c.plans.AAA,ruleVersion:'old'}}}).rows[0].result.amount,null);
});
test('ordinary quote ticks preserve dismissal, but quarter changes bring the opportunity back',()=>{
 const s=state();let c=config(s);c=action(c,model(s,c).rows[0],'dismissed');
 assert.equal(model(s,c).rows[0].status,'dismissed');
 assert.equal(model({...s,priceCache:{...s.priceCache,AAA:{close:96,timestamp:now}}},c).rows[0].status,'dismissed');
 const changed={...s,watchlist:s.watchlist.map(w=>w.symbol==='AAA'?{...w,iv:'140'}:w)};
 const m=model(changed,c);assert.equal(m.rows[0].status,'review');assert.equal(m.history.length,1);assert.equal(m.history[0].contextCurrent,false);
});
test('deferred opportunities reappear on the requested date, with history retained',()=>{
 const s=state();let c=config(s);c=action(c,model(s,c).rows[0],'deferred',{until:'2026-11-15'});
 assert.equal(model(s,c).rows[0].status,'deferred');
 assert.equal(buildCommandCentre(s,{},c,{today:'2026-11-15',now:now+86400000}).rows[0].status,'eligible');
 assert.throws(()=>action(config(s),model(s,config(s)).rows[0],'deferred',{until:today}),/after today/);
});
test('recorded orders reserve shared cash once and recalculate later opportunities',()=>{
 const s=state();s.cash.brokers=1000;s.cash.growth=2000;s.holdings.push({ticker:'CCC',accountType:'Cash',shares:1000,currency:'USD'});s.priceCache.CCC={close:100,timestamp:now};let c=config(s);
 const first=model(s,c),a=first.rows[0];assert.equal(a.result.amount,2000); // Saved stage budget is smallest.
 c=action(c,a,'ordered',{amount:2000});assert.equal(reservedCash(c),2000);
 const second=model(s,c);assert.equal(second.funding.available,1000);assert.equal(second.rows[0].status,'ordered');
 const b=second.rows.find(r=>r.symbol==='BBB');assert.equal(b.result.amount,Math.min(b.result.limits.ceiling,1000,2500));
 assert.throws(()=>action(c,second.rows[0],'ordered',{amount:1}),/pending order/);
 assert.throws(()=>action(c,b,'ordered',{amount:9999}),/fit/);
});
test('removing an ordered ticker does not release its cash; explicit cancellation does',()=>{
 const s=state();let c=config(s);const b=model(s,c).rows.find(r=>r.symbol==='BBB');c=action(c,b,'ordered',{amount:500});
 const removed={...s,watchlist:s.watchlist.filter(w=>w.symbol!=='BBB')};const m=model(removed,c);
 assert.equal(m.reserved,500);assert.equal(m.history[0].active,false);
 c=settleOrder(c,m.history[0].id,{kind:'cancelled',now:iso,today});assert.equal(reservedCash(c),0);
 assert.equal(model(removed,c).history[0].status,'cancelled');
});
test('a filled order updates actual spend atomically, closes reservation, and invalidates funding',()=>{
 const s=state();let c=config(s);const row=model(s,c).rows[0];c=action(c,row,'ordered',{amount:1000});
 const id=Object.keys(c.decisions)[0];c=settleOrder(c,id,{kind:'filled',spent:950,completed:true,date:today,now:iso,today});
 assert.equal(reservedCash(c),0);assert.equal(c.funding.confirmed,false);
 const stage=c.plans.AAA.stages.find(s=>s.id===row.result.stage.id);assert.equal(stage.spent,950);assert.equal(stage.completed,true);
 assert.equal(model(s,c).rows[0].result.amount,null);
 assert.throws(()=>settleOrder(c,id,{kind:'filled',spent:950,date:today,now:iso,today}),/already/);
});
test('an order can reconcile to its original stage even after a category change archives that stage',()=>{
 const s=state();s.priceCache.AAA.close=115;let c=config(s);const row=model(s,c).rows[0];assert.equal(row.result.stage.key,'s1');
 c=action(c,row,'ordered',{amount:500});const id=Object.keys(c.decisions)[0];
 const selective={...createPurchasePlan({symbol:'AAA',category:'selective',selectivePercents:[2,3],levels,base:100000,ceilingPct:10,iv:150,currency:'USD',reviewedAt:today,id:'plan-AAA'}),feeReserve:20,lotSize:1};
 c={...c,plans:{...c.plans,AAA:reviewPurchasePlan(c.plans.AAA,selective)}};
 c=settleOrder(c,id,{kind:'filled',spent:490,completed:true,date:today,now:iso,today});
 assert.equal(c.plans.AAA.archivedStages.find(s=>s.key==='s1').spent,490);assert.equal(c.plans.AAA.archivedStages.find(s=>s.key==='s1').completed,true);
});
test('dates use Singapore today even when the ISO timestamp is the previous UTC day',()=>{
 const s=state();let c=config(s),row=model(s,c).rows[0];
 c=addDecision(c,row,{kind:'ordered',id:'morning',amount:100,now:'2026-11-13T17:00:00Z',today});
 assert.doesNotThrow(()=>settleOrder(c,'morning',{kind:'filled',spent:95,date:today,today,now:'2026-11-13T17:00:00Z'}));
});
test('cards use actual entry levels, SGD suggestions and current/projected allocation, with safe text escaping',()=>{
 const s=state(),c=config(s),row=model(s,c).rows[0];row.name='<script>alert(1)</script>';
 const html=renderOpportunityCard(row,{show:n=>'S$'+n,today});
 assert.ok(html.includes('USD 100.00'));assert.ok(html.includes('Current allocation'));assert.ok(html.includes('projected allocation'));
 assert.ok(html.includes('S$2000'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
 const full=renderCommandCentre(model(s,c),{show:n=>n==null?'—':'S$'+n,today});assert.ok(full.includes('Needs attention'));assert.ok(full.includes('My decisions'));
});
test('all command decisions, reservations and archived plans survive dashboard backup restore',()=>{
 const s=state();let c=config(s);c=action(c,model(s,c).rows[0],'ordered',{amount:500});
 const perf={snapshots:{},flows:{},trades:{},coverage:{},settings:{investmentStrategy:c}};
 const restored=readDashboardBackup(createDashboardBackup(s,perf,{records:{}}));
 assert.deepEqual(restored.performance.settings.investmentStrategy,c);assert.equal(reservedCash(restored.performance.settings.investmentStrategy),500);
});

test('a stale holding quote blocks portfolio sizing, even when the target watchlist quote is fresh',()=>{
 const s=state(),c=config(s);s.priceCache.AAA.timestamp=now-5*86400000;
 const m=model(s,c);assert.equal(m.funding,null);assert.match(m.fundingError,/current holding prices/);assert.equal(m.rows.find(r=>r.symbol==='BBB').result.amount,null);
});

test('inactive Anchor selections can be cleared without deleting their plans or fills',()=>{
 const s=state();s.strategyCategories.OLD='anchor';const c=config(s),m=model(s,c);
 assert.deepEqual(m.inactiveCategories,[{symbol:'OLD',category:'anchor'}]);
 const html=renderCommandCentre(m,{show:n=>'S$'+n,today,filter:'decisions'});assert.ok(html.includes('data-clear-category="OLD"'));assert.ok(html.includes('Unassign OLD'));
 assert.deepEqual(c.plans.AAA.stages,plan().stages);
});
test('an inactive company remains absent from active cards even while its saved category is retained',()=>{
 const s=state(),c=config(s);s.watchlist=s.watchlist.filter(w=>w.symbol!=='BBB');const m=model(s,c);
 assert.equal(m.inactiveCategories.find(r=>r.symbol==='BBB').category,'core');assert.ok(m.archivedPlans.some(p=>p.symbol==='BBB'));assert.ok(!m.rows.some(r=>r.symbol==='BBB'));
});
