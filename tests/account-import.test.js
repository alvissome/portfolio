import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {parseAccountFile,planAccountImports,holdingKey,editAccountHolding,combinedHolding} from '../assets/account-portfolio.js';
import {capturePositions,confirmationSnapshot,sourceSignature,todaySG} from '../assets/performance-core.js';
import {createCashSettings} from '../assets/account-import-dialog.js';

const header=['Exchange','Name','Symbol','Currency','Shares','AveragePrice','Close','ProfitAndLossPlusDividendInBaseCurrency','CostInBaseCurrency','ValueInBaseCurrency','DividendPercent'].join('\t');
const stock=({symbol='EXAMPLE',shares=10,cost=10,close=12,currency='SGD',baseCost=100,baseValue=120,pnl=35}={})=>['SGX','Example',symbol,currency,shares,cost,close,pnl,baseCost,baseValue,'15%'].join('\t');
const file=(account,{cash=0,rows=[stock()],name=account+'.tsv'}={})=>({account,name,text:[header,...rows,...(cash===null?[]:[['CASH','CASH','CASH','SGD',cash,1,1,0,cash,cash,'NA'].join('\t')])].join('\n')});
const state=()=>({accountImportVersion:0,holdings:[{ticker:'EXAMPLE.SI',shares:30,currency:'SGD',average_cost:10,portfolioType:'Dividend',accountType:'Cash',bDiv:999}],cash:{brokers:50,srs:60,cpfIs:70,growth:10000,dividend:200},priceCache:{'EXAMPLE.SI':{close:12}},watchlist:[{id:'keep'}]});
const files=()=>[file('cash',{cash:100}),file('srs',{cash:200,rows:[stock({shares:7,cost:8,baseCost:56,baseValue:84,pnl:38})]}),file('cpf',{cash:300,rows:[stock({symbol:'OTHER',shares:13})]})];
const migrated=()=>({...state(),...planAccountImports(state(),files()).patch});

test('first batch splits a ticker across accounts without duplicating the old aggregate',()=>{
 const before=state(),original=structuredClone(before),p=planAccountImports(before,files());
 assert.deepEqual(before,original);assert.equal(p.initial,true);
 const h=p.patch.holdings;assert.equal(h.length,3);assert.equal(h.filter(x=>x.ticker==='EXAMPLE.SI').reduce((n,x)=>n+x.shares,0),17);
 assert.equal(new Set(h.map(holdingKey)).size,3);assert.deepEqual(h.filter(x=>x.ticker==='EXAMPLE.SI').map(x=>x.accountType),['Cash','Retirement - SRS']);
 assert.equal(h[0].portfolioType,'Dividend');assert.equal(h[1].portfolioType,'Dividend');
 assert.deepEqual(p.patch.cash,{brokers:100,srs:200,cpfIs:300,growth:10000,dividend:200});assert.equal(p.patch.accountImportVersion,1);
});
test('first import requires three mapped accounts before replacing ambiguous legacy holdings',()=>{
 assert.throws(()=>planAccountImports(state(),files().slice(0,2)),/all three/);
 assert.throws(()=>planAccountImports(state(),[...files().slice(0,2),file('srs')]),/only once/);
 assert.throws(()=>planAccountImports(state(),[{...files()[0],account:''},...files().slice(1)]),/Select/);
 assert.throws(()=>planAccountImports({...state(),holdings:[{ticker:'OLD',accountType:'Custom'}]},files()),/another account/);
});
test('partial imports update only their selected account, cash and metadata',()=>{
 const s=migrated(),before=structuredClone(s);
 const p=planAccountImports(s,[file('cash',{cash:0,rows:[stock({shares:4,baseCost:40,baseValue:48,pnl:11})]})]);
 assert.equal(p.patch.cash.brokers,0);assert.equal(p.patch.cash.srs,s.cash.srs);assert.equal(p.patch.cash.cpfIs,s.cash.cpfIs);
 assert.deepEqual(p.patch.holdings.filter(h=>h.accountType!=='Cash'),s.holdings.filter(h=>h.accountType!=='Cash'));
 assert.equal(p.patch.holdings.find(h=>h.accountType==='Cash').shares,4);assert.deepEqual(s,before);
 const again=planAccountImports({...s,...p.patch},[file('cash',{cash:0,rows:[stock({shares:4,baseCost:40,baseValue:48,pnl:11})]})]);
 assert.equal(again.patch.holdings.length,3);assert.equal(again.patch.holdings.filter(h=>!h.exited).length,3);
});
test('missing positions become exited only within the account being replaced',()=>{
 const s=migrated(),p=planAccountImports(s,[file('cash',{rows:[],cash:0})]);
 assert.equal(p.patch.holdings.find(h=>h.accountType==='Cash').exited,true);
 assert.equal(p.patch.holdings.find(h=>h.accountType==='Retirement - SRS').exited,false);
 assert.deepEqual(capturePositions({},p.patch).cash,[]);
});
test('BDiv subtracts the base-currency unrealised gain, not native or current-FX gain',()=>{
 const p=parseAccountFile(file('cash').text,'cash');assert.equal(p.holdings[0].bDiv,15);assert.equal(p.holdings[0].divPct,15);
 const f=file('cash',{rows:[stock({currency:'USD',cost:10,close:14,baseCost:150,baseValue:210,pnl:85})]});
 assert.equal(parseAccountFile(f.text,'cash').holdings[0].bDiv,25);
 const zero=file('cash',{rows:[stock({pnl:20})]});assert.equal(parseAccountFile(zero.text,'cash').holdings[0].bDiv,0);
});
test('invalid inputs abort the complete batch without changing any account',()=>{
 const s=state(),copy=structuredClone(s);
 const bad=file('srs',{rows:[stock({shares:0})]});assert.throws(()=>planAccountImports(s,[files()[0],bad,files()[2]]));assert.deepEqual(s,copy);
 assert.throws(()=>planAccountImports(s,[files()[0],{...files()[0],account:'srs'},files()[2]]),/same export/);
 assert.throws(()=>parseAccountFile(file('cash',{rows:[stock(),stock()]}).text,'cash'),/Duplicate/);
 assert.throws(()=>parseAccountFile(file('cash',{rows:[stock({pnl:'NA'})]}).text,'cash'),/P&L/);
 assert.throws(()=>planAccountImports(migrated(),[file('cash',{cash:null})]),/no CASH row/);
 const missing={...file('cash',{cash:null}),cashIfMissing:'0'};assert.equal(planAccountImports(migrated(),[missing]).patch.cash.brokers,0);
 assert.throws(()=>planAccountImports(s,[files()[0],file('srs',{rows:[stock({close:13})]}),files()[2]]),/Closing prices differ/);
});
test('edits and removals identify a single ticker/account and preserve sibling positions',()=>{
 const h=migrated().holdings,key=holdingKey(h[0]);
 const next=editAccountHolding(h,key,{portfolioType:'Growth'});
 assert.equal(next[0].portfolioType,'Growth');assert.equal(next[1].portfolioType,'Dividend');
 assert.throws(()=>editAccountHolding(h,key,{accountType:'Retirement - SRS'}),/source account/);
 const combined=combinedHolding(h,'EXAMPLE.SI');assert.equal(combined.shares,17);assert.equal(combined.bDiv,25);assert.equal(combined.average_cost,156/17);
});
test('new account imports establish capture inventory without any trade-history file',()=>{
 const s=migrated(),p=capturePositions({},s);
 assert.equal(p.cash[0].shares,10);assert.equal(p.srs[0].shares,7);assert.equal(p.cpf[0].ticker,'OTHER.SI');
 assert.deepEqual(capturePositions({},{settings:{accountImportVersion:1},holdings:Object.fromEntries(s.holdings.map(h=>[holdingKey(h),h]))}),p);
 const account='srs',signature=sourceSignature({holdings:s.holdings,cashPositions:{...s.cash,cpf:s.cash.cpfIs}},account),today=todaySG();
 const history={settings:{capture:{srs:{cash:s.cash.srs,holdings:p.srs,positionSignature:JSON.stringify(p.srs),sourceSignature:signature,reconciledOn:today}}}};
 const next=confirmationSnapshot(history,{...s,priceCache:{'EXAMPLE.SI':{close:12}},fxRates:{SGD:1}},{account,date:today,cash:s.cash.srs});
 assert.equal(next.snapshots[today].accounts.srs.invested,84);assert.equal(next.snapshots[today].accounts.srs.cash,200);
});

const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
const normalize=o=>JSON.parse(JSON.stringify(o));
test('production storage serializer round-trips all accounts, BDiv and import metadata',()=>{
 const start=bundle.indexOf('function MR('),end=bundle.indexOf('async function JT(',start);
 const context={holdingKey,In:{cash:{},emailSettings:{}}};
 runInNewContext(bundle.slice(start,end)+';this.save=BR;this.load=UR;',context);
 const s={...migrated(),emailSettings:{},fxRates:{SGD:1},portfolioTypes:['Dividend'],accountTypes:['Cash','Retirement - SRS','Retirement - CPF']};
 const saved=context.save(s);assert.equal(Object.keys(saved.holdings).length,3);assert.equal(Object.keys(saved.classifications).length,3);
 const restored=context.load(saved);assert.deepEqual(normalize(restored.holdings),normalize(s.holdings.map(h=>({...h,week52High:undefined,week52Low:undefined}))));
 assert.equal(restored.accountImportVersion,1);assert.deepEqual(normalize(restored.cashImportInfo),s.cashImportInfo);
 assert.equal(restored.cash.srs,200);
});
test('production save replaces holdings map so migrated aggregate keys cannot survive',async()=>{
 const start=bundle.indexOf('async function LR('),end=bundle.indexOf('const In=',start);
 let stored={holdings:{OLD:{ticker:'OLD'}},classifications:{OLD:{}},unrelated:'keep'};
 const context={OR:normalize,CR:()=>123,qT:()=>'',RR:async(ref,patch,options)=>{assert.deepEqual(normalize(options.mergeFields),Object.keys(patch));for(const key of options.mergeFields)stored[key]=patch[key];}};
 runInNewContext(bundle.slice(start,end)+';this.save=LR;',context);
 await context.save('owner',{holdings:{NEW:{ticker:'NEW'}},classifications:{NEW:{}}});
 assert.deepEqual(Object.keys(stored.holdings),['NEW']);assert.equal(stored.unrelated,'keep');
});
test('production callback applies a whole batch in a single state update',()=>{
 const start=bundle.indexOf('Q=ne.useCallback(files=>'),end=bundle.indexOf('},[]),K=ne.useCallback',start);
 const callback=bundle.slice(start+'Q=ne.useCallback('.length,end+1);
 let s=state(),updates=0;const context={planAccountImports,r:fn=>{updates++;s=fn(s);},files:files()};
 runInNewContext('const callback='+callback+';callback(files);',context);
 assert.equal(updates,1);assert.equal(s.holdings.length,3);assert.equal(s.watchlist[0].id,'keep');
 assert.equal(s.watchlist[0].reviewed,false);assert.equal(s.accountImportVersion,1);
});
test('cash settings display imported balances read-only and put corrections under Advanced',()=>{
 const jsx={jsx:(type,props)=>({tag:type,...props}),jsxs:(type,props)=>({tag:type,...props})};
 const nodes=[];const collect=x=>{if(!x||typeof x!=='object')return;nodes.push(x);(Array.isArray(x.children)?x.children:[x.children]).forEach(collect);};
 const View=createCashSettings({useState:()=>[false,()=>{}]},jsx);collect(View({cash:state().cash,onChange:()=>{throw Error('Read-only field changed');}}));
 assert.equal(nodes.filter(x=>x.tag==='input'&&x.readOnly).length,3);
 assert.equal(nodes.filter(x=>x.tag==='input'&&x.type==='number'&&!x.readOnly).length,2);
 assert.ok(nodes.some(x=>x.tag==='summary'&&x.children==='Advanced: manual cash corrections'));
 const inputs=nodes.filter(x=>x.tag==='input'&&x.readOnly);assert.ok(inputs.every(x=>x.onChange===undefined));
});
