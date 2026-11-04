import test from 'node:test';
import assert from 'node:assert/strict';
import {cashParts,readCashParts,snapshotProgress} from '../assets/performance-view.js';
import {cashFields,chart} from '../assets/performance-panel.js';
import {confirmationSnapshot,todaySG,calculate} from '../assets/performance-core.js';
import {planAccountImports} from '../assets/account-portfolio.js';

const state=()=>({accountImportVersion:1,holdings:[{ticker:'DEMO.SI',accountType:'Cash',importAccount:'cash',shares:10,currency:'SGD'}],cash:{brokers:100,growth:200,dividend:50,srs:20,cpfIs:30},priceCache:{'DEMO.SI':{close:12}},fxRates:{SGD:1}});
test('cash review separates broker balance from all bank money set aside',()=>{
 const s=state(),parts=cashParts(s,'cash');assert.equal(parts[0].value,100);assert.equal(parts[1].value,250);
 const fd=new FormData();fd.set('review-broker','100');fd.set('review-bank','250');assert.equal(readCashParts(fd,'cash','review'),350);
 const markup=cashFields(s,'cash','review',true);assert.match(markup,/Cash in broker/);assert.match(markup,/Money set aside in bank/);assert.match(markup,/review-broker/);assert.match(markup,/review-bank/);assert.equal((markup.match(/readonly/g)||[]).length,2);
 assert.equal(cashParts(s,'srs')[0].value,20);assert.equal(cashParts(s,'cpf')[0].value,30);
});
test('first reconciliation bootstraps current account tracking without a separate setup',()=>{
 const s=state(),before=structuredClone(s),p=confirmationSnapshot({settings:{}},s,{account:'cash',date:todaySG(),cash:350,coverage:{start:todaySG(),basis:'total'}});
 assert.equal(p.snapshots[todaySG()].accounts.cash.cash,350);assert.equal(p.snapshots[todaySG()].accounts.cash.invested,120);assert.equal(p.settings.dailyEnabled,true);assert.ok(p.settings.capture.cash.positionSignature);assert.deepEqual(s,before);
 assert.throws(()=>confirmationSnapshot({settings:{}},s,{account:'cash',date:todaySG(),cash:350,unchanged:true}));
});
test('ongoing reconciliation accepts freshly imported positions while no-change cannot bypass them',()=>{
 const s=state(),first=confirmationSnapshot({settings:{}},s,{account:'cash',date:todaySG(),cash:350});
 const changed={...s,holdings:s.holdings.map(h=>({...h,shares:11}))};
 const next=confirmationSnapshot(first,changed,{account:'cash',date:todaySG(),cash:350});assert.equal(next.snapshots[todaySG()].accounts.cash.invested,132);
 assert.throws(()=>confirmationSnapshot(first,changed,{account:'cash',date:todaySG(),cash:350,unchanged:true}));
});
test('a single saved date renders a visible value point without inventing return history',()=>{
 const date=todaySG(),s=state(),h=confirmationSnapshot({settings:{}},s,{account:'cash',date,cash:350});
 const r=calculate(h,'cash','total',date,date);assert.equal(r.points.length,1);assert.equal(r.returnPct,null);
 const svg=chart(r.points,'value',false);assert.match(svg,/<circle/);assert.doesNotMatch(svg,/NaN|Infinity|pf-empty/);
 const hidden=chart(r.points,'value',true);assert.doesNotMatch(hidden,/470/);
 assert.match(chart(r.points,'returnPct',false),/two different snapshot dates/);
});
test('snapshot status distinguishes incomplete combined accounts and transaction evidence',()=>{
 const date=todaySG(),h={snapshots:{[date]:{accounts:{cash:{verified:true,invested:120,cash:350}}}},trades:{one:{}},settings:{dailyEnabled:true,capture:{cash:{}}}};
 const a=snapshotProgress(h,'cash','total',date,date);assert.equal(a.dates.length,1);assert.equal(a.configured,true);assert.equal(a.transactions,1);
 const b=snapshotProgress(h,'combined','total',date,date);assert.equal(b.dates.length,0);assert.deepEqual(b.missing,['srs','cpf']);assert.equal(b.configured,false);
});
test('import review order is Investment, SRS, CPF regardless of file selection order',()=>{
 const header='Exchange\tName\tSymbol\tCurrency\tShares\tAveragePrice\tClose\tProfitAndLossPlusDividendInBaseCurrency\tCostInBaseCurrency\tValueInBaseCurrency\tDividendPercent';
 const make=(account,cash)=>({account,name:account+'.tsv',text:header+'\nCASH\tCASH\tCASH\tSGD\t'+cash+'\t1\t1\t0\t'+cash+'\t'+cash+'\tNA'});
 const p=planAccountImports({...state(),accountImportVersion:0},[make('cpf',3),make('cash',1),make('srs',2)]);
 assert.deepEqual(p.summary.map(s=>s.account),['cash','srs','cpf']);assert.equal(p.patch.cash.brokers,1);assert.equal(p.patch.cash.srs,2);assert.equal(p.patch.cash.cpfIs,3);
});
