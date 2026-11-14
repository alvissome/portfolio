import {normalizeResearchColumnSettings} from '../assets/research-columns.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {INITIAL_ANCHORS,normalizeStrategyCategories,chooseStrategyCategory,categoryFor,createStrategyCategorySelect,selectCategoryRows,categoryRank,createCategoryControls,reconcileStrategyCategories} from '../assets/strategy-categories.js';
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
 const context={holdingKey,normalizeStrategyCategories,normalizeResearchColumnSettings,In:{cash:{},emailSettings:{}}};
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
 assert.equal(tree.type,'select');assert.equal(tree.props.value,'core');assert.equal(tree.props['aria-label'],'Category for XYZ');
 assert.deepEqual(tree.props.children.map(c=>c.props.value),['','anchor','core','selective']);
 tree.props.onChange({target:{value:'selective'}});assert.deepEqual(event,['XYZ','selective']);
});
function renderProductionTable(name,props,states=[]){
 let hook=0;const testReact={...React,useState:initial=>[hook<states.length?states[hook++]:(hook++,typeof initial==='function'?initial():initial),()=>{}]};
 const start=bundle.indexOf('function '+name+'('),end=bundle.indexOf(name==='RN'?'function NN(':'function ON(',start+1);
 const defaults={ne:testReact,m:jsx,selectCategoryRows,categoryRank,CategoryControls:createCategoryControls(React),combinedHolding,holdingKey,resolveWatchlistLevels,StrategyCategorySelect:createStrategyCategorySelect(React),ResearchBadge:()=>null,
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
  assert.ok(all(tree,n=>n.type==='th'&&(n.props.children==='Category'||Array.isArray(n.props.children)&&n.props.children[0]==='Category')).length);
  const cells=all(tree,n=>typeof n.type==='function'&&n.type.name==='StrategyCategorySelect');
  assert.equal(cells.length,1);
  const select=cells[0].type(cells[0].props);assert.equal(select.props.value,'core');
  select.props.onChange({target:{value:'selective'}});assert.deepEqual(change,['GOOGL','selective']);
 }
});
test('research views omit Category while keeping Track in watchlist',()=>{
 const {ResearchPanel}=createResearchComponents(React);
 const tree=ResearchPanel({holdings:[{ticker:'XYZ'}],watchlist:[],strategyCategories:{XYZ:'selective'},onStrategyCategoryChange:()=>{}});
 const headings=all(tree,n=>n.type==='th');assert.ok(!headings.some(n=>n.props.children.includes('Category')));
 const cells=all(tree,n=>typeof n.type==='function'&&n.type.name==='StrategyCategorySelect');
 assert.equal(cells.length,0);assert.ok(headings.some(n=>n.props.children.includes('Watchlist')));
});

test('production category handler saves immediately in order; normal autosave cannot overwrite it',async()=>{
 const cloud={settings:{strategyCategories:{AAA:'core'},other:'keep'}};
 const state={strategyCategories:{AAA:'core'}},writes=[],statuses=[],alerts=[];
 const context={ne:{useRef:value=>({current:value})},d:state,n:{uid:'test-user'},chooseStrategyCategory,
  w:patch=>Object.assign(state,patch),u:status=>statuses.push(status),qT:uid=>uid,alert:text=>alerts.push(text),
  RR:async(ref,data,options)=>{writes.push({ref,data:clone(data),options});for(const path of options.mergeFields){if(path==='settings.strategyCategories')cloud.settings.strategyCategories=clone(data.settings.strategyCategories);else if(path.startsWith('settings.'))cloud.settings[path.slice(9)]=data.settings[path.slice(9)];else cloud[path]=data[path];}},
  OR:v=>v,CR:()=>123,BR:v=>({holdings:[],settings:{strategyCategories:v.strategyCategories,other:'updated'}})};
 const start=bundle.indexOf('const categorySaveQueue='),end=bundle.indexOf(';ne.useEffect(',start);
 runInNewContext(bundle.slice(start,end+1)+';this.choose=updateStrategyCategory;this.pending=()=>categorySaveQueue.current;',context);
 context.choose('AAA','selective');context.choose('BBB','core');
 assert.equal(writes.length,0,'network calls queue without a two-second timer');
 await context.pending();assert.equal(writes.length,2);assert.deepEqual(cloud.settings.strategyCategories,{AAA:'selective',BBB:'core'});
 const a=bundle.indexOf('async function pd('),b=bundle.indexOf('function zR(',a);
 runInNewContext(bundle.slice(a,b)+';this.autosave=pd;',context);
 await context.autosave('test-user',{strategyCategories:{AAA:'anchor'}});
 assert.deepEqual(cloud.settings.strategyCategories,{AAA:'selective',BBB:'core'});
 assert.equal(cloud.settings.other,'updated');assert.equal(statuses.at(-1),'saved');assert.deepEqual(alerts,[]);
 const decodeStart=bundle.indexOf('function UR('),decodeEnd=bundle.indexOf('function BR(',decodeStart);
 context.In={emailSettings:{},columnVisibility:{}};context.normalizeStrategyCategories=normalizeStrategyCategories;context.normalizeResearchColumnSettings=normalizeResearchColumnSettings;
 runInNewContext(bundle.slice(decodeStart,decodeEnd)+';this.reload=UR;',context);
 assert.deepEqual(clone(context.reload(cloud).strategyCategories),{AAA:'selective',BBB:'core'});
});
test('failed category writes surface an error and the queue can save a retry',async()=>{
 let fail=true;const alerts=[],statuses=[],saved=[];
 const context={ne:{useRef:value=>({current:value})},d:{strategyCategories:{}},n:{uid:'test-user'},chooseStrategyCategory,w:()=>{},u:s=>statuses.push(s),qT:()=>null,alert:s=>alerts.push(s),RR:async(_,data)=>{if(fail)throw Error('permission denied');saved.push(clone(data));}};
 const start=bundle.indexOf('const categorySaveQueue='),end=bundle.indexOf(';ne.useEffect(',start);
 runInNewContext(bundle.slice(start,end+1)+';this.choose=updateStrategyCategory;this.pending=()=>categorySaveQueue.current;',context);
 context.choose('AAA','core');await context.pending();assert.equal(statuses.at(-1),'error');assert.match(alerts[0],/not saved/);
 fail=false;context.choose('AAA','selective');await context.pending();assert.equal(saved[0].settings.strategyCategories.AAA,'selective');assert.equal(statuses.at(-1),'saved');
});

test('category filtering and ordering preserve row identity and original order within each group',()=>{
 const rows=[{symbol:'S'},{symbol:'A'},{symbol:'U'},{symbol:'C'},{symbol:'A2'}],categories={S:'selective',A:'anchor',C:'core',A2:'anchor'};
 assert.deepEqual(selectCategoryRows(rows,categories,'symbol','all','asc').map(r=>r.symbol),['A','A2','C','S','U']);
 assert.deepEqual(selectCategoryRows(rows,categories,'symbol','all','desc').map(r=>r.symbol),['S','C','A','A2','U']);
 assert.deepEqual(selectCategoryRows(rows,categories,'symbol','anchor').map(r=>r.symbol),['A','A2']);
 assert.equal(selectCategoryRows(rows,categories,'symbol','selective')[0],rows[0]);
 assert.deepEqual(selectCategoryRows(rows,categories,'symbol','unassigned'),[rows[2]]);assert.equal(rows[0].symbol,'S');
});
test('inactive exited tickers become Selective without affecting active holdings or watchlist categories',()=>{
 const categories={J69U:'anchor',ACTIVE:'core',WATCH:'anchor',RETIREMENT:'core'};
 const next=reconcileStrategyCategories(categories,[{ticker:'J69U',exited:true},{ticker:'ACTIVE'},{ticker:'RETIREMENT',accountType:'Retirement - SRS'}],[{symbol:'WATCH'}]);
 assert.deepEqual(next,{J69U:'selective',ACTIVE:'core',WATCH:'anchor',RETIREMENT:'core'});assert.equal(categories.J69U,'anchor');
 assert.equal(chooseStrategyCategory(next,'NEW','anchor').NEW,'anchor');
});
test('production inactive category migration persists through the same immediate cloud queue',async()=>{
 const d={strategyCategories:{J69U:'anchor',ACTIVE:'core'},holdings:[{ticker:'J69U',exited:true},{ticker:'ACTIVE'}],watchlist:[]};let saved;
 const context={ne:{useRef:value=>({current:value}),useEffect:fn=>fn()},f:true,restoring:{current:false},d,n:{uid:'test-user'},reconcileStrategyCategories,chooseStrategyCategory,w:patch=>Object.assign(d,patch),u:()=>{},qT:()=>null,alert:()=>{},RR:async(_,data)=>{saved=clone(data);}};
 const start=bundle.indexOf('const categorySaveQueue='),end=bundle.indexOf(';return f?',start);
 runInNewContext(bundle.slice(start,end+1)+';this.pending=()=>categorySaveQueue.current;',context);await context.pending();
 assert.equal(saved.settings.strategyCategories.J69U,'selective');assert.equal(d.strategyCategories.ACTIVE,'core');
});


test('both production tables filter by category and watchlist filtering disables index-based dragging',()=>{
 const categories={AAA:'anchor',BBB:'core'},holdings=['AAA','BBB'].map(ticker=>({ticker,accountType:'Cash',portfolioType:'Growth',shares:1,currency:'USD',average_cost:50}));
 const common={holdings,prices:{AAA:{close:100},BBB:{close:100}},fxRate:1.3,fxRates:{USD:1.3},cash:{},portfolioTypes:['Growth'],accountTypes:['Cash'],columnVisibility:{},strategyCategories:categories,onStrategyCategoryChange:()=>{}};
 const watch=renderProductionTable('RN',{...common,watchlist:holdings.map((h,i)=>({id:String(i),symbol:h.ticker,alertConfig:{},s1:90}))},['core','none']);
 const held=renderProductionTable('NN',common,[false,false,false,'All','All',null,'',{growth:true,dividend:true,brokers:true,srs:true,cpf:true},'core']);
 for(const tree of [watch,held]){
  const cells=all(tree,n=>typeof n.type==='function'&&n.type.name==='StrategyCategorySelect');assert.equal(cells.length,1);assert.equal(cells[0].props.symbol,'BBB');
  assert.ok(all(tree,n=>typeof n.type==='function'&&n.type.name==='CategoryControls').length);
 }
 assert.ok(all(watch,n=>n.type==='tr'&&n.props.draggable===false).length);
});

test('privacy masks account quantities, average costs and notes while keeping public closes',()=>{
 const holdings=[{ticker:'XYZ',accountType:'Cash',portfolioType:'Growth',shares:123456,currency:'USD',average_cost:543.21}],prices={XYZ:{close:95}};
 const common={holdings,prices,fxRate:1.3,fxRates:{USD:1.3},cash:{},privacyMode:true,portfolioTypes:['Growth'],accountTypes:['Cash'],columnVisibility:{shares:true,avgPrice:true,close:true,notes:true},strategyCategories:{XYZ:'core'}};
 for(const tree of [renderProductionTable('NN',common),renderProductionTable('RN',{...common,watchlist:[{id:'row',symbol:'XYZ',notes:'PRIVATE NOTE',alertConfig:{}}]})]){
  const json=JSON.stringify(tree,(key,value)=>typeof value==='function'?undefined:value);
  assert.ok(!json.includes('543.21'));assert.ok(!json.includes('123,456'));assert.ok(!json.includes('PRIVATE NOTE'));assert.ok(json.includes('95.00'));
 }
});
