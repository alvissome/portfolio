import test from 'node:test';
import assert from 'node:assert/strict';
import {cashImportBasis,cashAllowance,recordCashUse,recordStageCashFill,reconcileCashUse} from '../assets/cc-cash-allowance.js';
import {buildCommandCentre,addDecision,settleOrder} from '../assets/investment-command-centre.js';
import {fundingSignature,createPurchasePlan} from '../assets/investment-strategy.js';
import {createDashboardBackup,readDashboardBackup} from '../assets/dashboard-backup.js';
const today='2026-11-14',now='2026-11-14T02:00:00Z',tick=Date.parse(now);
const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
const state=()=>({holdings:[{ticker:'AAA',accountType:'Cash',shares:50,currency:'SGD'}],watchlist:[{symbol:'AAA',priceCurrency:'SGD',iv:150,s1:120,s2:110,s3:100,s4:90,s5:80},{symbol:'BBB',priceCurrency:'SGD',iv:150,s1:120,s2:110,s3:100,s4:90,s5:80}],strategyCategories:{AAA:'core',BBB:'core'},cash:{brokers:50000,growth:45000,dividend:0},priceCache:{AAA:{close:100,timestamp:tick},BBB:{close:95,timestamp:tick}},fxRates:{SGD:1},cashImportInfo:{brokers:{importedAt:'2026-11-01T01:00:00Z',source:'StocksCafe CASH row'}},lastImportDate:'2026-11-01T01:00:00Z'});
const plan=s=>createPurchasePlan({symbol:s,category:'core',levels,base:100000,ceilingPct:6,iv:150,currency:'SGD',reviewedAt:today,id:'p-'+s});
const config=s=>({plans:{AAA:plan('AAA'),BBB:plan('BBB')},decisions:{},funding:{confirmed:true,basisSignature:fundingSignature(s)}});
const model=(s,c)=>buildCommandCentre(s,{},c,{today,now:tick});
const fill=(s,c,amount,id='use-1',completed=false)=>recordStageCashFill(c,'AAA','p-AAA-s3',{spent:amount,date:today,completed},{id,now,state:s});
test('a fill reduces only CC cash and company purchase room, never imported holdings/balances/history',()=>{
 const s=state(),before=structuredClone(s),c=config(s),next=fill(s,c,1000);
 const m=model(s,next);assert.equal(m.allowance.spent,1000);assert.equal(m.funding.available,94000);assert.equal(m.funding.base,100000);assert.equal(m.rows[0].currentHolding,5000);assert.equal(m.rows[0].result.amount,null); // Core room is exhausted.
 assert.equal(m.rows[1].status,'eligible');assert.equal(next.funding.confirmed,true);assert.deepEqual(s,before);assert.equal(c.plans.AAA.stages[0].spent,0);
 assert.equal(next.flows,undefined);assert.equal(next.trades,undefined);assert.equal(next.snapshots,undefined);
});
test('cumulative fill edits charge only the increase; completing with unchanged spend charges nothing',()=>{
 const s=state();let c=fill(s,config(s),400);c=fill(s,c,650,'use-2');assert.equal(cashAllowance(c,s).spent,650);
 c=fill(s,c,650,'unused',true);assert.equal(Object.keys(c.cashUsage).length,2);assert.equal(c.plans.AAA.stages[0].completed,true);
 assert.throws(()=>fill(s,c,600,'use-3',true),/reset/);
});
test('pending-order reservation becomes actual cash used exactly once and unused reservation is released',()=>{
 const s=state();let c=config(s),row=model(s,c).rows[1];c=addDecision(c,row,{kind:'ordered',id:'order-1',amount:1000,now,today});assert.equal(model(s,c).funding.available,94000);
 c=settleOrder(c,'order-1',{kind:'filled',spent:900,completed:true,date:today,now,today,cashBasis:cashImportBasis(s),cashId:'fill-1'});
 const m=model(s,c);assert.equal(m.reserved,0);assert.equal(m.allowance.spent,900);assert.equal(m.funding.available,94100);assert.equal(c.funding.confirmed,true);
 assert.throws(()=>settleOrder(c,'order-1',{kind:'filled',spent:900,date:today,now,today,cashBasis:cashImportBasis(s),cashId:'duplicate'}),/already/);
});
test('a cash import pauses sizing until included spending is confirmed, then avoids double deduction',()=>{
 const s=state();let c=fill(s,config(s),1000);const imported={...s,cash:{...s.cash,brokers:49000},holdings:[{...s.holdings[0],shares:60}],cashImportInfo:{brokers:{importedAt:'2026-11-14T05:00:00Z',source:'StocksCafe CASH row'}}};
 assert.equal(model(imported,c).allowance.needsReconciliation,true);assert.equal(model(imported,c).rows[1].result.amount,null);
 assert.throws(()=>reconcileCashUse(c,imported,{includedIds:['use-1'],now}),/Confirm/);
 c=reconcileCashUse(c,imported,{includedIds:['use-1'],confirmed:true,now});assert.equal(cashAllowance(c,imported).spent,0);assert.equal(c.cashUsage['use-1'].status,'reflected');
 c={...c,funding:{...c.funding,confirmed:true,basisSignature:fundingSignature(imported)}};assert.equal(model(imported,c).funding.available,94000);
});
test('spending not yet reflected in an import carries forward and unrelated retirement imports do not reset it',()=>{
 const s=state();let c=fill(s,config(s),500);assert.equal(cashImportBasis({...s,lastImportDate:'2026-11-15',cashImportInfo:{...s.cashImportInfo,srs:{importedAt:'2026-11-15'}}}),cashImportBasis(s));
 const imported={...s,cashImportInfo:{brokers:{importedAt:'2026-11-14T05:00:00Z',source:'StocksCafe CASH row'}}};
 c=reconcileCashUse(c,imported,{includedIds:[],confirmed:true,now});assert.equal(cashAllowance(c,imported).spent,500);assert.equal(cashAllowance(c,imported).needsReconciliation,false);
});
test('future/unimported fills cannot be cleared; retrospective fills need an explicit inclusion attestation',()=>{
 const s=state();let c=fill(s,config(s),500);
 assert.throws(()=>reconcileCashUse(c,s,{includedIds:['use-1'],confirmed:true,now}),/Only spending/);
 assert.throws(()=>reconcileCashUse(c,s,{includedIds:[],confirmed:true,now}),/Import/);
 const recent={...s,cashImportInfo:{brokers:{importedAt:'2026-11-14T05:00:00Z',source:'StocksCafe CASH row'}}};
 c=fill(recent,config(recent),500);c=reconcileCashUse(c,recent,{includedIds:['use-1'],confirmed:true,now});assert.equal(cashAllowance(c,recent).spent,0);
});
test('earlier history-only fills require a one-time opening allowance review and are not charged automatically',()=>{
 const s=state(),c=config(s);c.plans.AAA.stages[0].spent=300;
 assert.equal(model(s,c).allowance.spent,0);assert.equal(model(s,c).allowance.legacyReviewRequired,true);assert.equal(model(s,c).rows[1].result.amount,null);
 c.cashTrackingVersion=1;assert.equal(model(s,c).rows[1].status,'eligible');
});
test('CC cash-use records survive backup and corrupt or duplicate use records cannot silently size',()=>{
 const s=state(),c=fill(s,config(s),500);const perf={snapshots:{},flows:{},trades:{},coverage:{},settings:{investmentStrategy:c}};
 assert.deepEqual(readDashboardBackup(createDashboardBackup(s,perf)).performance.settings.investmentStrategy.cashUsage,c.cashUsage);
 assert.throws(()=>recordCashUse(c,{...c.cashUsage['use-1']}),/unique/);
 const bad={...c,cashUsage:{bad:{id:'bad',symbol:'AAA',basis:'x',amount:-100,status:'unreconciled'}}};assert.match(model(s,bad).fundingError,/invalid CC/);assert.equal(model(s,bad).rows[1].result.amount,null);
});

test('cash deductions survive ticker removal and affect planning projections, not imported allocations',()=>{
 const s=state();let c=fill(s,config(s),500);
 const row=model(s,c).rows[0];assert.equal(row.currentWeight,5);assert.equal(row.currentHolding,5000);assert.equal(row.ccSpent,500);assert.ok(row.result.projectedWeight>=5.5);
 const removed={...s,holdings:[],watchlist:s.watchlist.filter(w=>w.symbol!=='AAA')};assert.equal(model(removed,c).allowance.spent,500);assert.equal(model(removed,c).funding.available,94500);
});
