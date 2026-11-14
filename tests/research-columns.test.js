import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {normalizeResearchColumnSettings,researchColumns,visibleResearchColumns} from '../assets/research-columns.js';
import {normalizeStrategyCategories} from '../assets/strategy-categories.js';
import {holdingKey} from '../assets/account-portfolio.js';
import {createDashboardBackup,readDashboardBackup} from '../assets/dashboard-backup.js';

test('research defaults show all current columns while excluding removed fields',()=>{
 for(const scope of ['watchlist','holdings']){
  const columns=researchColumns(scope);assert.ok(!columns.some(c=>['bvalue','category'].includes(c.key)));
  assert.deepEqual(visibleResearchColumns(scope,false,{}),columns.map(c=>c.key==='iv'?{...c,label:'Independent IV'}:c));
  assert.ok(visibleResearchColumns(scope,false,{symbol:false}).some(c=>c.key==='symbol'));
 }
 assert.ok(!researchColumns('watchlist').some(c=>c.key==='track'));assert.ok(researchColumns('holdings').some(c=>c.key==='track'));
});
test('research preferences are independent for holdings and watchlist and reject malformed values',()=>{
 const input={holdings:{sl1:false},watchlist:{research:false}},result=normalizeResearchColumnSettings(input);
 assert.deepEqual(result,input);result.holdings.sl1=true;assert.equal(input.holdings.sl1,false);
 assert.throws(()=>normalizeResearchColumnSettings({holdings:{sl1:'false'}}),/true or false/);
 assert.deepEqual(normalizeResearchColumnSettings(undefined),{holdings:{},watchlist:{}});
});
test('production cloud storage round-trips research preferences',async()=>{
 const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
 const start=bundle.indexOf('function MR('),end=bundle.indexOf('async function JT(',start);
 const context={holdingKey,normalizeStrategyCategories,normalizeResearchColumnSettings,In:{cash:{},emailSettings:{}}};
 runInNewContext(bundle.slice(start,end)+';this.save=BR;this.load=UR;',context);
 const settings={holdings:{sl2:false},watchlist:{avg:false,'sl-status':false}};
 const state={holdings:[],watchlist:[],cash:{},emailSettings:{},researchColumnVisibility:settings};
 const saved=context.save(state);assert.deepEqual(JSON.parse(JSON.stringify(saved.settings.researchColumnVisibility)),settings);
 assert.deepEqual(JSON.parse(JSON.stringify(context.load(saved).researchColumnVisibility)),settings);
});
test('research preferences survive dashboard backup and malformed imports are rejected',()=>{
 const state={holdings:[],watchlist:[],cash:{},researchColumnVisibility:{holdings:{close:false},watchlist:{sl5:false}}};
 const history={snapshots:{},flows:{},trades:{},settings:{},coverage:{}};
 assert.deepEqual(readDashboardBackup(createDashboardBackup(state,history)).state.researchColumnVisibility,state.researchColumnVisibility);
 assert.throws(()=>readDashboardBackup(createDashboardBackup({...state,researchColumnVisibility:{holdings:{iv:'hidden'}}},history)),/true or false/);
});
test('both toolbar column buttons are immediately beside the Research switch and route research preferences separately',async()=>{
 const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
 for(const [name,end,scope]of [['RN','function NN(','watchlist'],['NN','async function','holdings']]){
  const a=bundle.indexOf('function '+name+'('),b=bundle.indexOf(end,a+15),part=bundle.slice(a,b);
  const switchAt=part.indexOf('m.jsx(ResearchViewSwitch,');const after=part.slice(switchAt,part.indexOf('children:m.jsx(eg',switchAt));
  assert.ok(after.includes('m.jsx("button"'));assert.ok(!after.includes('className:"ml-auto p-1.5'));
  assert.ok(part.includes('m.jsx(ResearchColumnSettings,{scope:"'+scope+'",visibility:researchColumnVisibility,onChange:onResearchColumnsChange})'));
  assert.ok(part.includes('columnVisibility:researchColumnVisibility'));
 }
});
