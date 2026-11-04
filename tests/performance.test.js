import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,confirmationSnapshot,todaySG,makeFlow,makeBankTransfer,confirmCashLocations,accountForLabel,importTrades,stableId,parseDelimited,sourceSignature,derivePositions} from '../assets/performance-core.js';
const row=(invested,cash=0)=>({invested,cash,verified:true});
const snapshot=(cash,srs=row(0),cpf=row(0))=>({accounts:{cash,srs,cpf}});
const coverage=Object.fromEntries(['cash','srs','cpf'].map(a=>[a,{total:{start:'2020-01-01',end:'2030-01-01'},invested:{start:'2020-01-01',end:'2030-01-01'}}]));
const history=(snapshots,flows={})=>({snapshots,flows,coverage});
test('bank to broker transfer preserves both cash boundaries and original funding',()=>{
  const f=makeBankTransfer({id:'a',date:'2026-01-02',amount:20000,bankBefore:75000,brokerBefore:10000});
  assert.equal(f.bankAfter,55000);assert.equal(f.brokerAfter,30000);
  assert.equal(f.bankBefore+f.brokerBefore,f.bankAfter+f.brokerAfter);
  const h=history({'2026-01-01':snapshot(row(100000,85000)),'2026-01-02':snapshot(row(100000,85000))},{a:f});
  for(const basis of ['total','invested']){const r=calculate(h,'cash',basis,'2026-01-01','2026-01-02');assert.equal(r.gain,0);assert.equal(r.netFlow,0);assert.equal(r.returnPct,0);}
});
test('bank transfers reject insufficient funds and require both updated balances',()=>{
  const args={date:'2026-01-02',amount:20,bankBefore:75,brokerBefore:10};
  const f=makeBankTransfer(args);assert.doesNotThrow(()=>confirmCashLocations(f,55,30));
  assert.throws(()=>confirmCashLocations(f,75,30));assert.throws(()=>confirmCashLocations(f,55,10));
  for(const amount of [0,-1,76,0.001,NaN])assert.throws(()=>makeBankTransfer({...args,amount}));
});
test('deposit is not mistaken for investment gain',()=>{
  const h=history({'2026-01-01':snapshot(row(100)), '2026-01-02':snapshot(row(110,20))},{a:makeFlow({id:'a',date:'2026-01-02',account:'cash',kind:'contribution',amount:20})});
  const r=calculate(h,'cash','total','2026-01-01','2026-01-02');assert.equal(r.gain,10);assert.ok(Math.abs(r.returnPct-10)<1e-10);
});
test('money earmarked in a bank is a contribution only to the full cash portfolio',()=>{
  const f=makeFlow({id:'a',date:'2026-01-02',account:'cash',kind:'earmark',amount:20});
  assert.equal(f.total,20);assert.equal(f.invested,0);assert.equal(f.location,'bank');
  assert.throws(()=>makeFlow({id:'b',date:'2026-01-02',account:'srs',kind:'earmark',amount:20}));
});
test('earmarked money already in the opening value is not counted twice',()=>{
  const h=history({'2026-02-01':snapshot(row(100,20)),'2026-02-02':snapshot(row(100,20))},{a:makeFlow({id:'a',date:'2026-01-02',account:'cash',kind:'earmark',amount:20})});
  const r=calculate(h,'cash','total','2026-02-01','2026-02-02');assert.equal(r.netFlow,0);assert.equal(r.gain,0);assert.equal(r.returnPct,0);
});
test('an approximate funding date is labelled as an estimated return',()=>{
  const h=history({'2026-01-01':snapshot(row(100)),'2026-01-02':snapshot(row(100,20))},{a:makeFlow({id:'a',date:'2026-01-02',account:'cash',kind:'earmark',amount:20,dateApproximate:true})});
  assert.equal(calculate(h,'cash','total','2026-01-01','2026-01-02').method,'Modified Dietz estimate');
});
test('holdings return excludes idle cash while full portfolio includes it',()=>{
  const h=history({'2026-01-01':snapshot(row(100,100)),'2026-01-31':snapshot(row(110,100))});
  assert.ok(Math.abs(calculate(h,'cash','invested','2026-01-01','2026-01-31').returnPct-10)<1e-10);
  assert.ok(Math.abs(calculate(h,'cash','total','2026-01-01','2026-01-31').returnPct-5)<1e-10);
});
test('CPF income paid out to OA remains earned return without fictitious cash',()=>{
  const h=history({'2026-01-01':snapshot(row(0),row(0),row(100)),'2026-01-02':snapshot(row(0),row(0),row(95))},{a:makeFlow({id:'a',date:'2026-01-02',account:'cpf',kind:'dividend_to_oa',amount:10})});
  const r=calculate(h,'cpf','total','2026-01-01','2026-01-02');assert.equal(r.closing,95);assert.equal(r.gain,5);assert.ok(Math.abs(r.returnPct-5)<1e-10);
});
test('dividends retained in SRS cash are not double-counted',()=>{
  const h=history({'2026-01-01':snapshot(row(0),row(100)),'2026-01-02':snapshot(row(0),row(95,10))},{a:makeFlow({id:'a',date:'2026-01-02',account:'srs',kind:'dividend',amount:10})});
  assert.equal(calculate(h,'srs','total','2026-01-01','2026-01-02').gain,5);
  assert.equal(calculate(h,'srs','invested','2026-01-01','2026-01-02').gain,5);
});
test('matching transfers cancel in the combined portfolio',()=>{
  const h=history({'2026-01-01':snapshot(row(100,20),row(100)),'2026-01-02':snapshot(row(100),row(100,20))},{a:makeFlow({id:'a',date:'2026-01-02',account:'cash',kind:'transfer_out',amount:20}),b:makeFlow({id:'b',date:'2026-01-02',account:'srs',kind:'transfer_in',amount:20})});
  assert.equal(calculate(h,'combined','total','2026-01-01','2026-01-02').returnPct,0);
});
test('a trade within the whole portfolio is a flow only for invested holdings',()=>{
  const h=history({'2026-01-01':snapshot(row(100,20)),'2026-01-02':snapshot(row(120))},{a:makeFlow({id:'a',date:'2026-01-02',account:'cash',kind:'buy',amount:20})});
  assert.equal(calculate(h,'cash','total','2026-01-01','2026-01-02').gain,0);assert.equal(calculate(h,'cash','invested','2026-01-01','2026-01-02').gain,0);
});
test('missing a valuation on a flow date gives a labelled Dietz estimate',()=>{
  const h=history({'2026-01-01':snapshot(row(100)),'2026-01-11':snapshot(row(130))},{a:makeFlow({id:'a',date:'2026-01-06',account:'cash',kind:'contribution',amount:20})});
  const r=calculate(h,'cash','total','2026-01-01','2026-01-11');assert.equal(r.method,'Modified Dietz estimate');assert.ok(Math.abs(r.returnPct-100/11)<1e-10);
});
test('missing reconciliation or a second valuation never produces a return',()=>{
  const h=history({'2026-01-01':snapshot(row(100)),'2026-01-02':snapshot(row(120))});delete h.coverage;
  assert.equal(calculate(h,'cash','total','2026-01-01','2026-01-02').returnPct,null);
  assert.equal(calculate(history({'2026-01-01':snapshot(row(100))}),'cash','total','2026-01-01','2026-01-02').returnPct,null);
});
test('combined portfolios need a shared verified valuation date',()=>{
  const h=history({'2026-01-01':{accounts:{cash:row(100)}}});assert.equal(calculate(h,'combined','total','2026-01-01','2026-01-02').points.length,0);
});
test('scope mapping excludes options, bonds, trading and test portfolios',()=>{
  for(const s of ['Trading','Options - Trading','| Bond','Test'])assert.equal(accountForLabel(s),null);
  assert.equal(accountForLabel('Portfolio - Investment Main'),'cash');assert.equal(accountForLabel('| CPF-SRS'),'srs');assert.equal(accountForLabel('| CPF-IS'),'cpf');
});
test('CSV preserves quoted commas, multiline notes and identical fills',async()=>{
  const line='1,USX,NOW,10,50,2026-01-01,USD,500,501,Investment Main,"a,b\nc",SGD,650';
  const r=importTrades(line+'\r\n'+line);assert.equal(r.trades.length,2);assert.equal(r.trades[0].note,'a,b\nc');assert.notEqual(await stableId(r.trades[0].sourceKey),await stableId(r.trades[1].sourceKey));
  assert.equal(await stableId(r.trades[0].sourceKey),await stableId(importTrades(line).trades[0].sourceKey));
});
test('missing historical FX is preserved for reconciliation',()=>{
  const r=importTrades('1,USX,ABC,10,1,2020-01-01,USD,10,10,Investment Main,,,');assert.equal(r.missingBase,1);assert.equal(r.trades[0].baseAmount,null);
});
test('native SGD amounts need no historical FX conversion',()=>{
  const r=importTrades('1,SGX,ABC,10,1,2020-01-01,SGD,10,11,Investment SG,,,');assert.equal(r.missingBase,0);assert.equal(r.trades[0].baseAmount,11);
});
test('account inventory keeps the same stock separate across cash and retirement',()=>{
  const t={exchange:'SGX',symbol:'ABC',currency:'SGD',action:1};
  const p=derivePositions({a:{...t,account:'cash',units:100},b:{...t,account:'srs',units:50}});
  assert.equal(p.cash[0].shares,100);assert.equal(p.srs[0].shares,50);assert.equal(p.cash[0].ticker,'ABC.SI');
});
test('incomplete trade history cannot create a daily-capture inventory',()=>{
  assert.throws(()=>derivePositions({a:{account:'cash',exchange:'SGX',symbol:'ABC',currency:'SGD',action:-1,units:10}}));
});
test('closed positions with different transaction currencies do not block active inventory',()=>{
  const t={account:'srs',exchange:'SGX',symbol:'ABC',units:10};
  const p=derivePositions({a:{...t,currency:'SGD',action:1},b:{...t,currency:'USD',action:-1}});
  assert.equal(p.srs.length,0);
});
test('malformed files and invalid dates are rejected',()=>{
  assert.throws(()=>parseDelimited('"unclosed'));assert.throws(()=>importTrades('Symbol,Shares\nABC,10'));
  assert.throws(()=>makeFlow({date:'2026-02-30',account:'cash',kind:'buy',amount:10}));
  assert.throws(()=>makeFlow({date:'2026-01-01',account:'srs',kind:'dividend_to_oa',amount:10}));
});
test('daily source signature changes when holdings or cash change',()=>{
  const a={holdings:[{ticker:'X',shares:1,currency:'SGD',accountType:'Cash'}],cashPositions:{brokers:10}};
  assert.notEqual(sourceSignature(a,'cash'),sourceSignature({...a,cashPositions:{brokers:20}},'cash'));
});

const confirmationFixture=()=>{
  const state={holdings:[{ticker:'ABC.SI',shares:10,currency:'SGD',accountType:'Cash'}],cash:{brokers:20,growth:0,dividend:0,srs:0,cpfIs:0},priceCache:{'ABC.SI':{close:12}},fxRates:{SGD:1}};
  const trades={a:{account:'cash',exchange:'SGX',symbol:'ABC',currency:'SGD',action:1,units:10}};
  const positions=derivePositions(trades).cash;
  const signature=sourceSignature({holdings:state.holdings,cashPositions:{...state.cash,cpf:state.cash.cpfIs}},'cash');
  const h={trades,flows:{},settings:{capture:{cash:{cash:20,holdings:positions,positionSignature:JSON.stringify(positions),sourceSignature:signature,reconciledOn:'2026-01-01',needsReconciliation:false}}},coverage:{cash:{total:{start:'2026-01-01',end:'2026-01-01'}}}};
  return {state,h};
};
test('no-change confirmation saves today at new prices and enables cloud capture atomically',()=>{
  const {state,h}=confirmationFixture();const date=todaySG();const p=confirmationSnapshot(h,state,{account:'cash',date,cash:20,unchanged:true});
  assert.equal(p.snapshots[date].accounts.cash.invested,120);assert.equal(p.snapshots[date].accounts.cash.cash,20);
  assert.equal(p.settings.dailyEnabled,true);assert.equal(p.settings.capture.cash.needsReconciliation,false);
  assert.equal(p.coverage.cash.total.end,date);assert.equal(p.flows,undefined);assert.equal(h.settings.dailyEnabled,undefined);
});
test('reconciliation saves updated cash and coverage together without inventing contributions',()=>{
  const {state,h}=confirmationFixture();state.cash.brokers=30;h.settings.capture.cash.needsReconciliation=true;
  const date=todaySG(),p=confirmationSnapshot(h,state,{account:'cash',date,cash:30,coverage:{start:'2026-01-01',basis:'total'}});
  assert.equal(p.snapshots[date].accounts.cash.cash,30);assert.equal(p.settings.capture.cash.cash,30);assert.equal(p.coverage.cash.total.end,date);assert.equal(p.flows,undefined);
});
test('automatic confirmations reject historical dates and unverified setup',()=>{
  const {state,h}=confirmationFixture();assert.throws(()=>confirmationSnapshot(h,state,{account:'cash',date:'2025-01-01',cash:20}));
  assert.throws(()=>confirmationSnapshot({...h,settings:{}},state,{account:'cash',date:todaySG(),cash:20}));
});
test('no-change confirmation cannot bypass changed holdings, recorded activity or stale prices',()=>{
  const {state,h}=confirmationFixture(),args={account:'cash',date:todaySG(),cash:20,unchanged:true};
  state.cash.brokers=30;assert.throws(()=>confirmationSnapshot(h,state,args));state.cash.brokers=20;
  h.flows.a={account:'cash',date:todaySG()};assert.throws(()=>confirmationSnapshot(h,state,args));delete h.flows.a;
  state.priceCache['ABC.SI'].priceStale=true;assert.throws(()=>confirmationSnapshot(h,state,args));state.priceCache['ABC.SI'].priceStale=false;
  h.trades.a.units=11;assert.throws(()=>confirmationSnapshot(h,state,args));
});

test('dated holdings-only imports never invent cash or enable total values',async()=>{
  const {importValuations,snapshotValue}=await import('../assets/performance-core.js');
  const parsed=importValuations('date,account,invested_sgd,cash_sgd\n2025-12-31,cash,100,\n2026-01-31,cash,110,0');
  assert.equal(parsed.holdingsOnly,1);
  const old=parsed.snapshots['2025-12-31'];
  assert.equal(old.accounts.cash.cash,null);
  assert.equal(snapshotValue(old,'cash','total'),null);
  assert.equal(snapshotValue(old,'cash','invested'),100);
  assert.equal(snapshotValue(parsed.snapshots['2026-01-31'],'cash','total'),110);
  const result=calculate({snapshots:parsed.snapshots,flows:{},coverage:{}},'cash','invested','2025-12-31','2026-01-31');
  assert.equal(result.points.length,2);assert.equal(result.returnPct,null);assert.equal(result.gain,null);
  assert.throws(()=>importValuations('date,account,invested_sgd,cash_sgd\n2026-01-31,cash,110,',parsed.snapshots),/checked cash/);
  for(const line of ['2026-01-31,cash,,','2026-01-31,cash,-1,','2026-01-31,unknown,1,','2026-02-30,cash,1,'])assert.throws(()=>importValuations('date,account,invested_sgd,cash_sgd\n'+line));
});
