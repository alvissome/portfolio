import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyFunding,fundingSignature,purchaseSchedule,createPurchasePlan,previewPurchase,recordStageFill,CORE_COMPANIES} from '../assets/investment-strategy.js';
import {resolvedCompany} from '../assets/investment-panel.js';
import {createDashboardBackup,readDashboardBackup} from '../assets/dashboard-backup.js';
const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
const state={holdings:[{ticker:'GOOGL',accountType:'Cash',shares:100,currency:'USD'},{ticker:'GOOGL',accountType:'Retirement - SRS',shares:999,currency:'USD'}],priceCache:{GOOGL:{close:100}},fxRates:{USD:1.3},cash:{brokers:20000,growth:30000,dividend:5000,srs:999999,cpfIs:999999},watchlist:[]};
const fund=()=>({...strategyFunding(state,{confirmed:true,basisSignature:fundingSignature(state)}),base:500000,available:100000,byCompany:{GOOGL:0}});
const plan=(symbol='GOOGL')=>createPurchasePlan({symbol,levels,base:500000,ceilingPct:10,addBudget:50000,iv:150,currency:'USD',reviewedAt:'2026-11-13',id:'plan1'});
const preview=(p=plan(),f=fund(),o={})=>previewPurchase(p,f,{close:95,fx:1.3,iv:150,today:'2026-11-13',feeReserve:50,...o});
test('funding uses current cash portfolio only, counts bank once, liabilities once, pending cash only',()=>{
 const f=strategyFunding(state,{liabilities:1000,pending:2000});
 assert.equal(f.invested,13000);assert.equal(f.base,67000);assert.equal(f.available,52000);assert.equal(f.byCompany.GOOGL,13000);
 assert.throws(()=>strategyFunding({...state,cash:{...state.cash,brokers:undefined}}),/broker cash/);
 assert.throws(()=>strategyFunding({...state,priceCache:{GOOGL:{close:100,priceStale:true}}}),/stale/);
});
test('exactly the six named core companies nibble each approved support',()=>{
 assert.deepEqual(CORE_COMPANIES,['GOOGL','META','AMZN','MSFT','NVDA','SPGI']);
 for(const symbol of CORE_COMPANIES)assert.deepEqual(purchaseSchedule(symbol,levels).map(x=>x.fraction),[.2,.2,.2,.2,.2]);
 assert.deepEqual(plan().stages.map(s=>s.budget),[10000,10000,10000,10000,10000]);
 assert.deepEqual(purchaseSchedule('XYZ',levels).map(l=>[l.key,l.portfolioPct]),[['s3',2.5],['s4',2.5],['s5',5]]);
 assert.deepEqual(plan('XYZ').stages.map(s=>s.budget),[12500,12500,25000]);
});
test('reject missing ceilings, invalid supports, missing IV and invalid company identity',()=>{
 assert.throws(()=>createPurchasePlan({...plan(),levels,base:500000,ceilingPct:''}),/ceiling/);
 assert.throws(()=>purchaseSchedule('XYZ',levels.slice(0,2)),/three/);
 assert.throws(()=>purchaseSchedule('GOOGL',[levels[1],levels[0]]),/descend/);
 assert.throws(()=>purchaseSchedule('GOOGL',[levels[0],levels[0]]),/unique/);
 assert.throws(()=>createPurchasePlan({symbol:'GOOGL',levels,base:500000,ceilingPct:11,id:'x'}),/10%/);
});
test('a gap through several supports selects only deepest eligible unused stage',()=>{
 const r=preview();assert.equal(r.stage.key,'s3');assert.equal(r.amount,10000);
 assert.equal(preview(plan(),fund(),{close:79}).stage.key,'s5');
});
test('caps by current company market value, cash and unused stage budget',()=>{
 let p=plan();p=recordStageFill(p,p.stages[2].id,{spent:3000,completed:false,date:'2026-11-13'});
 assert.equal(preview(p).amount,7000);
 const r=preview(p,{...fund(),available:10000,byCompany:{GOOGL:48000}});
 assert.equal(r.amount,2000);assert.deepEqual(r.limitedBy,['ceiling']);
 assert.equal(preview(p,{...fund(),available:500}).amount,500);
 assert.equal(preview(p,{...fund(),byCompany:{GOOGL:60000}}).amount,0);
});
test('actual fills persist, cannot reset a completed stage or reduce actual spend',()=>{
 const p=plan();const filled=recordStageFill(p,p.stages[4].id,{spent:9000,completed:true,date:'2026-11-13'});
 assert.equal(preview(filled,fund(),{close:79}).stage.key,'s4');
 assert.equal(filled.stages[4].id,p.stages[4].id);
 assert.throws(()=>recordStageFill(filled,p.stages[4].id,{spent:8000,completed:true,date:'2026-11-13'}),/reset/);
 assert.throws(()=>recordStageFill(filled,p.stages[4].id,{spent:9000,completed:false,date:'2026-11-13'}),/reset/);
 // A new portfolio base cannot expand an approved stage budget.
 assert.equal(preview(p,{...fund(),base:1000000}).amount,10000);
});
test('pending inputs, stale IV, unresolved changes and missing FX withhold amounts',()=>{
 for(const o of [{priceStale:true},{iv:160},{today:'2026-12-15'},{today:'2026-11-12'},{fx:null},{levelsChanged:true}])assert.equal(preview(plan(),fund(),o).amount,null);
 assert.equal(preview(plan(),{...fund(),confirmed:false}).amount,null);
 assert.equal(preview(plan(),fund(),{close:150}).status,'paused');
 assert.equal(preview(plan(),fund(),{close:125}).status,'hold');
});
test('units round down by lot after fees and SGD conversion; cash is a shared pool',()=>{
 const r=preview(plan(),{...fund(),available:2000},{lotSize:10});
 assert.equal(r.units,10);assert.ok(r.estimatedSpend+50<=r.amount);
 assert.equal(r.projectedWeight,r.estimatedSpend/500000*100);
 assert.equal(preview(plan(),fund(),{feeReserve:20000}).units,0);
 assert.throws(()=>preview(plan(),fund(),{lotSize:1.5}),/whole/);
});
test('existing manual levels override generated levels; conflicting duplicate rows stop preview',()=>{
 const row={symbol:'GOOGL',iv:'140',s1:'110',s2:'90',priceCurrency:'USD'};
 const r=resolvedCompany({...state,watchlist:[row]},null,'GOOGL');
 assert.equal(r.iv,140);assert.equal(r.currency,'USD');assert.deepEqual(r.levels,[{key:'s1',price:110},{key:'s2',price:90}]);
 assert.throws(()=>resolvedCompany({...state,watchlist:[row,row]},null,'GOOGL'),/duplicate/);
});
test('strategy plans and stage fills survive dashboard-wide backup and restore',()=>{
 const strategy={plans:{GOOGL:plan()},funding:{confirmed:true}};
 const history={snapshots:{},flows:{},trades:{},coverage:{},settings:{investmentStrategy:strategy}};
 const backup=createDashboardBackup(state,history,{records:{}});
 assert.deepEqual(readDashboardBackup(backup).performance.settings.investmentStrategy,strategy);
});

test('cash or quantity changes invalidate funding confirmation without price noise',()=>{
 const settings={confirmed:true,basisSignature:fundingSignature(state)};
 assert.equal(strategyFunding(state,settings).confirmed,true);
 assert.equal(strategyFunding({...state,cash:{...state.cash,brokers:1000}},settings).confirmed,false);
 assert.equal(strategyFunding({...state,priceCache:{GOOGL:{close:110}}},settings).confirmed,true);
});

test('CSPX stays review-only until an explicit ETF rule is defined',()=>{
 assert.throws(()=>plan('CSPX'),/review-only/);
 assert.throws(()=>plan('CSPX.L'),/review-only/);
});
