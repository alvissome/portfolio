import test from 'node:test';
import assert from 'node:assert/strict';
import {readPortfolioTSV,exportedCash,cashAllocation} from '../assets/stockscafe-cash.js';
import {calculate,makeFlow} from '../assets/performance-core.js';

const current={brokers:5000,srs:800,cpfIs:200,growth:75000,dividend:100};
const tsv=(cash='6000',currency='SGD')=>'Symbol\tShares\tAveragePrice\tCurrency\nDEMO\t10\t1\tSGD\nCASH\t'+cash+'\t999\t'+currency;
test('combined imported total replaces retirement balances and excludes bank cash',()=>{
  const total=exportedCash(readPortfolioTSV(tsv()));
  const result={...current,...cashAllocation(total,current,{scope:'combined',srs:'900',cpfIs:'100'})};
  assert.deepEqual(result,{brokers:5000,srs:900,cpfIs:100,growth:75000,dividend:100});
  assert.equal(result.brokers+result.srs+result.cpfIs,total);
  assert.deepEqual({...result,...cashAllocation(total,result,{scope:'combined',srs:'900',cpfIs:'100'})},result);
});
test('a broker-only export preserves separately maintained retirement cash',()=>{
  assert.deepEqual({...current,...cashAllocation(6000,current,{scope:'brokers'})},{...current,brokers:6000});
});
test('an explicit zero exported balance clears stale cash instead of using average price',()=>{
  const total=exportedCash(readPortfolioTSV(tsv('0')));
  assert.equal(total,0);
  assert.deepEqual(cashAllocation(total,current,{scope:'combined',srs:0,cpfIs:0}),{brokers:0,srs:0,cpfIs:0});
});
test('missing CASH leaves all balances unchanged',()=>{
  const total=exportedCash(readPortfolioTSV('Symbol\tShares\tAveragePrice\tCurrency\nDEMO\t10\t1\tSGD'));
  assert.equal(total,null);assert.deepEqual(cashAllocation(total,current),{});
});
test('cash scope and valid account allocation are mandatory',()=>{
  for(const args of [{},{scope:'combined',srs:6100,cpfIs:0},{scope:'combined',srs:'',cpfIs:0},{scope:'combined',srs:-1,cpfIs:0},{scope:'combined',srs:NaN,cpfIs:0},{scope:'combined',srs:0.001,cpfIs:0}])assert.throws(()=>cashAllocation(6000,current,args));
  assert.deepEqual(cashAllocation(0.3,current,{scope:'combined',srs:0.1,cpfIs:0.2}),{brokers:0,srs:0.1,cpfIs:0.2});
});
test('currency and multiple CASH rows must not be silently combined',()=>{
  assert.throws(()=>exportedCash(readPortfolioTSV(tsv('10','USD'))),/SGD/);
  assert.throws(()=>exportedCash(readPortfolioTSV(tsv()+'\nCASH\t200\t0\tSGD')),/multiple/);
  assert.throws(()=>exportedCash(readPortfolioTSV(tsv('unknown'))));
});
test('read actual TSV headers and quoted thousands; reject trade-history CSV',()=>{
  assert.equal(exportedCash(readPortfolioTSV('\uFEFF'+tsv('"6,000.00"'))),6000);
  assert.throws(()=>readPortfolioTSV('Action,Symbol,Units\n1,DEMO,10'));
});
test('a later CPF cash return to OA is only a total-portfolio outflow',()=>{
  const f=makeFlow({id:'oa',account:'cpf',date:'2026-03-02',kind:'cash_to_oa',amount:20});
  assert.equal(f.total,-20);assert.equal(f.invested,0);
  assert.throws(()=>makeFlow({account:'srs',date:'2026-03-02',kind:'cash_to_oa',amount:20}));
  const h={snapshots:{'2026-03-01':{accounts:{cpf:{invested:100,cash:20,verified:true}}},'2026-03-02':{accounts:{cpf:{invested:100,cash:0,verified:true}}}},flows:{oa:f},coverage:{cpf:{total:{start:'2026-03-01',end:'2026-03-02'},invested:{start:'2026-03-01',end:'2026-03-02'}}}};
  for(const basis of ['total','invested']){const r=calculate(h,'cpf',basis,'2026-03-01','2026-03-02');assert.equal(r.gain,0);assert.equal(r.returnPct,0);}
});
test('dividend income followed by a later OA cash transfer is earned once',()=>{
  const point=(invested,cash)=>({accounts:{cpf:{invested,cash,verified:true}}});
  const h={snapshots:{'2026-03-01':point(100,0),'2026-03-02':point(95,10),'2026-03-03':point(95,0)},flows:{div:makeFlow({id:'div',account:'cpf',date:'2026-03-02',kind:'dividend',amount:10}),oa:makeFlow({id:'oa',account:'cpf',date:'2026-03-03',kind:'cash_to_oa',amount:10})},coverage:{cpf:{total:{start:'2026-03-01',end:'2026-03-03'},invested:{start:'2026-03-01',end:'2026-03-03'}}}};
  for(const basis of ['total','invested'])assert.equal(calculate(h,'cpf',basis,'2026-03-01','2026-03-03').gain,5);
});

test('production TSV callback applies the reviewed split atomically and preserves classifications',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
  const start=bundle.indexOf('Q=ne.useCallback((I,cashPatch)=>');
  assert.ok(start>0);
  const callback=bundle.slice(start+'Q=ne.useCallback('.length,bundle.indexOf('},[]),K=ne.useCallback',start)+1);
  const mergeStart=bundle.indexOf('function E0(');
  const merge=bundle.slice(mergeStart,bundle.indexOf('function zR(',mergeStart));
  let state={cash:{...current},holdings:[{ticker:'DEMO',shares:1,portfolioType:'Dividend',accountType:'Retirement - CPF'}],priceCache:{},watchlist:[{id:'w',reviewed:true}]};
  const context={eN:readPortfolioTSV,Wr:n=>n&&parseFloat(n.replace(/,/g,''))||0,ZR:()=>'',r:fn=>{state=fn(state);},text:tsv(),cashPatch:cashAllocation(6000,current,{scope:'combined',srs:900,cpfIs:100})};
  runInNewContext(merge+'; const callback='+callback+'; callback(text,cashPatch);',context);
  assert.deepEqual(JSON.parse(JSON.stringify(state.cash)),{...current,brokers:5000,srs:900,cpfIs:100});
  assert.equal(state.holdings[0].shares,10);assert.equal(state.holdings[0].accountType,'Retirement - CPF');assert.equal(state.holdings[0].portfolioType,'Dividend');
  assert.equal(state.watchlist[0].id,'w');
  const before=JSON.stringify(state);context.cashPatch=undefined;
  assert.throws(()=>runInNewContext('callback(text,cashPatch)',context),/Review/);
  assert.equal(JSON.stringify(state),before);
});
