import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,makeFlow,accountForLabel,importTrades,stableId,parseDelimited,sourceSignature,derivePositions} from '../assets/performance-core.js';
const row=(invested,cash=0)=>({invested,cash,verified:true});
const snapshot=(cash,srs=row(0),cpf=row(0))=>({accounts:{cash,srs,cpf}});
const coverage=Object.fromEntries(['cash','srs','cpf'].map(a=>[a,{total:{start:'2020-01-01',end:'2030-01-01'},invested:{start:'2020-01-01',end:'2030-01-01'}}]));
const history=(snapshots,flows={})=>({snapshots,flows,coverage});
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
