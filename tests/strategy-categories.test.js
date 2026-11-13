import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {INITIAL_ANCHORS,normalizeStrategyCategories,chooseStrategyCategory,categoryFor,createStrategyCategorySelect} from '../assets/strategy-categories.js';
import {planTrackInWatchlist} from '../assets/research-core.js';
import {holdingKey,combinedHolding} from '../assets/account-portfolio.js';
import {resolveWatchlistLevels} from '../assets/watchlist-levels.js';
import {createDashboardBackup,readDashboardBackup} from '../assets/dashboard-backup.js';
import {createResearchComponents} from '../assets/research-panel.js';
const bundle=await readFile(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
const clone=o=>JSON.parse(JSON.stringify(o));
const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:v=>[typeof v==='function'?v():v,()=>{}],useMemo:f=>f(),useRef:v=>({current:v}),useEffect:()=>{}};
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
const all=(node,predicate)=>!node||typeof node!=='object'?[]:[...(predicate(node)?[node]:[]),...[node.props?.children??[]].flat(Infinity).flatMap(n=>all(n,predicate))];

test('legacy seed happens only for a missing map; clearing all selections is permanent',()=>{
 assert.deepEqual(Object.keys(normalizeStrategyCategories(undefined)),INITIAL_ANCHORS);
 assert.deepEqual(normalizeStrategyCategories({}),{});
 let categories=normalizeStrategyCategories(undefined);
 for(const symbol of INITIAL_ANCHORS)categories=chooseStrategyCategory(categories,symbol,'');
 assert.deepEqual(normalizeStrategyCategories(JSON.parse(JSON.stringify(categories))),{});
});
test('editing either table changes the same ticker category; tracking does not create a second copy',()=>{
 const original={GOOGL:'core'};
 const categories=chooseStrategyCategory(original,'GOOGL','selective');
 const track=planTrackInWatchlist([],{symbol:'GOOGL'});
 assert.equal(categoryFor(categories,'GOOGL'),'selective');assert.equal(categoryFor(categories,track.item.symbol),'selective');
 assert.equal(categoryFor(original,'GOOGL'),'core');
 assert.equal(categoryFor(chooseStrategyCategory(categories,'GOOGL','anchor'),track.item.symbol),'anchor');
 assert.equal(categoryFor(chooseStrategyCategory(categories,'GOOGL',''),'GOOGL'),'');
});
test('at most six Anchors, safe keys, and only the three supported categories',()=>{
 const seeded=normalizeStrategyCategories(undefined);
 assert.throws(()=>chooseStrategyCategory(seeded,'NEW','anchor'),/six/);
 const next=chooseStrategyCategory(chooseStrategyCategory(seeded,'GOOGL','core'),'NEW','anchor');
 assert.equal(next.NEW,'anchor');assert.equal(next.GOOGL,'core');
 for(const category of ['other','top6','constructor'])assert.throws(()=>chooseStrategyCategory({},'XYZ',category));
 for(const symbol of ['__proto__','constructor','bad ticker'])assert.throws(()=>chooseStrategyCategory({},symbol,'core'));
});
test('production cloud serializer round-trips categories without placing them in per-account rows',()=>{
 const start=bundle.indexOf('function MR('),end=bundle.indexOf('async function JT(',start);
 const context={holdingKey,normalizeStrategyCategories,In:{cash:{},emailSettings:{}}};
 runInNewContext(bundle.slice(start,end)+';this.save=BR;this.load=UR;',context);
 const state={accountImportVersion:1,strategyCategories:{GOOGL:'selective'},holdings:[{ticker:'GOOGL',accountType:'Cash',shares:1}],watchlist:[{symbol:'GOOGL'}],cash:{},emailSettings:{}};
 const saved=context.save(state);
 assert.deepEqual(clone(saved.settings.strategyCategories),state.strategyCategories);
 assert.deepEqual(clone(context.load(saved).strategyCategories),state.strategyCategories);
 state.strategyCategories={};assert.deepEqual(clone(context.load(context.save(state)).strategyCategories),{});
 delete state.strategyCategories;assert.equal(context.load(context.save(state)).strategyCategories.GOOGL,'anchor');
});
test('category selections and explicit Unassigned survive dashboard-wide backup restore',()=>{
 const performance={snapshots:{},flows:{},trades:{},coverage:{},settings:{}};
 const state={holdings:[],watchlist:[],cash:{},strategyCategories:{XYZ:'core'}};
 assert.deepEqual(readDashboardBackup(createDashboardBackup(state,performance)).state.strategyCategories,{XYZ:'core'});
 assert.deepEqual(readDashboardBackup(createDashboardBackup({...state,strategyCategories:{}},performance)).state.strategyCategories,{});
 assert.throws(()=>readDashboardBackup(createDashboardBackup({...state,strategyCategories:{XYZ:'unknown'}},performance)),/category/);
});
test('shared category selector renders all choices and sends the ticker and selected category',()=>{
 let event;const Select=createStrategyCategorySelect(React);
 const tree=Select({symbol:'XYZ',categories:{XYZ:'core'},onChange:(...args)=>event=args});
 assert.equal(tree.type,'select');assert.equal(tree.props.value,'core');assert.equal(tree.props['aria-label'],'Buying category for XYZ');
 assert.deepEqual(tree.props.children.map(c=>c.props.value),['','anchor','core','selective']);
 tree.props.onChange({target:{value:'selective'}});assert.deepEqual(event,['XYZ','selective']);
});
function renderProductionTable(name,props){
 const start=bundle.indexOf('function '+name+'('),end=bundle.indexOf(name==='RN'?'function NN(':'async function',start+1);
 const defaults={ne:React,m:jsx,combinedHolding,holdingKey,resolveWatchlistLevels,StrategyCategorySelect:createStrategyCategorySelect(React),ResearchBadge:()=>null,
  ResearchPanel:()=>null,ResearchViewSwitch:()=>null,Dt:(h,p)=>h.shares*(p[h.ticker]?.close||0),mh:()=>0,cp:()=>0,hp:()=>null,uh:()=>0,Qt:n=>String(n),A0:n=>String(n),k0:n=>String(n),Fs:()=>null};
 const context=new Proxy(defaults,{get:(target,key)=>key in target?target[key]:key in globalThis?globalThis[key]:()=>null});
 runInNewContext(bundle.slice(start,end)+';this.render='+name+';',context);
 return context.render(props);
}
test('both production position tables include working shared category cells beside each symbol',()=>{
 const categories={GOOGL:'core'};let change;
 const common={holdings:[{ticker:'GOOGL',accountType:'Cash',portfolioType:'Growth',shares:1,currency:'USD',average_cost:50}],prices:{GOOGL:{close:100}},fxRate:1.3,fxRates:{USD:1.3},cash:{},portfolioTypes:['Growth'],accountTypes:['Cash'],columnVisibility:{},strategyCategories:categories,onStrategyCategoryChange:(...args)=>change=args};
 const watch=renderProductionTable('RN',{...common,watchlist:[{id:'x',symbol:'GOOGL',alertConfig:{},s1:'90'}]});
 const holdings=renderProductionTable('NN',common);
 for(const tree of [watch,holdings]){
  assert.ok(all(tree,n=>n.type==='th'&&n.props.children==='Buying category').length);
  const cells=all(tree,n=>typeof n.type==='function'&&n.type.name==='StrategyCategorySelect');
  assert.equal(cells.length,1);
  const select=cells[0].type(cells[0].props);assert.equal(select.props.value,'core');
  select.props.onChange({target:{value:'selective'}});assert.deepEqual(change,['GOOGL','selective']);
 }
});
test('research views also expose shared category without interfering with Track in watchlist',()=>{
 const {ResearchPanel}=createResearchComponents(React);
 const tree=ResearchPanel({holdings:[{ticker:'XYZ'}],watchlist:[],strategyCategories:{XYZ:'selective'},onStrategyCategoryChange:()=>{}});
 const headings=all(tree,n=>n.type==='th');assert.ok(headings.some(n=>n.props.children.includes('Buying category')));
 const cells=all(tree,n=>typeof n.type==='function'&&n.type.name==='StrategyCategorySelect');
 assert.equal(cells.length,1);assert.equal(cells[0].type(cells[0].props).props.value,'selective');
});
