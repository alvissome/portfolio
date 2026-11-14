import {selectCategoryRows,categoryRank,createCategoryControls} from '../assets/strategy-categories.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {combinedHolding} from '../assets/account-portfolio.js';
import {createResearchComponents,researchProcessingLabel,researchComparisonLabel,researchWaitReason} from '../assets/research-panel.js';
import {mergeResolvedWatchlistNames} from '../assets/research-client.js';
import {planTrackInWatchlist, VALIDATION_STATES} from '../assets/research-core.js';

// Minimal hook host tests the component's event and render contracts without
// adding a second React runtime or reaching private portfolio state.
function host() {
  const values = [];
  let cursor = 0;
  let effects = [];
  const React = {
    createElement(type, props, ...children) {
      return typeof type === 'function' ? type({...props,children}) : {type, props: props || {}, children: children.flat(Infinity).filter(x => x != null)};
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = {current: initial};
      return values[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => {values[index] = typeof next === 'function' ? next(values[index]) : next;}];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = values[index];
      if (!previous || dependencies.some((value, i) => value !== previous[i])) effects.push(effect);
      values[index] = dependencies;
    },
  };
  return {components: createResearchComponents(React),
    render(Component, props) {
      cursor = 0; effects = [];
      const tree = Component(props);
      for (const effect of effects) effect();
      return tree;
    }};
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap(child => nodes(child, type))];
}
function trackCheckbox(tree) {return nodes(tree, 'input').find(input => input.props.type === 'checkbox');}
function content(tree) {
  if (tree == null) return '';
  return typeof tree === 'object' ? tree.children.map(content).join(' ') : String(tree);
}
const holding = {ticker: 'EXAMPLE', name: 'Example Company', shares: 2, average_cost: 10};

test('new track action starts blank with alerts off and uses caller identity', () => {
  const result = planTrackInWatchlist([], {securityId: 'EXAMPLE@VENUE', symbol: 'EXAMPLE', name: 'Example Company'});
  assert.equal(result.kind, 'add');
  assert.equal(result.item.securityId, 'EXAMPLE@VENUE');
  assert.equal(result.item.notifEnabled, false);
  assert.equal(result.item.reviewed, false);
  for (const field of ['iv', 's1', 's2', 's3', 's4', 's5']) assert.equal(result.item[field], '');
  assert.deepEqual(Object.values(result.item.alertConfig), [false, false, false, false, false]);
  assert.equal(Object.hasOwn(result.item, 'id'), false, 'existing app add callback owns row IDs');
});

test('existing tracking preserves the actual row, including notes and alert choices', () => {
  const existing = {id: 'row-one', symbol: 'EXAMPLE', iv: '19', s1: '17', notes: 'Keep my note', notifEnabled: true};
  const snapshot = structuredClone(existing);
  const result = planTrackInWatchlist([existing], {symbol: 'EXAMPLE', name: 'New name'});
  assert.equal(result.kind, 'existing');
  assert.equal(result.item, existing);
  assert.deepEqual(existing, snapshot);
});

test('research view deduplicates account positions and never exposes manual levels as generated output', () => {
  const runtime = host();
  const tree = runtime.render(runtime.components.ResearchPanel, {
    holdings: [holding, {...holding, accountType: 'Retirement - SRS'}, {ticker: 'EXITED', exited: true}],
    watchlist: [{symbol: 'EXAMPLE', iv: '98765', s1: '87654', notes: 'Manual plan'}],
    getHoldingMetrics: () => ({avgPrice: 10, bValue: 30, close: 15}),
  });
  assert.equal(nodes(tree, 'tbody')[0].children.length, 1);
  const text = content(tree);
  assert.ok(!text.includes('S$30.00'));assert.ok(!text.includes('BValue'));assert.ok(!text.includes('Category'));
  assert.ok(text.includes('15.00'));
  assert.ok(!text.includes('98765'));
  assert.ok(!text.includes('87654'));
  assert.equal((text.match(/Research service is not connected/g) || []).length, 1);
  assert.equal((text.match(/Not started/g) || []).length, 2, 'separate IV and SL processing badges');
  assert.equal(nodes(tree, 'td').filter(cell => content(cell) === '—').length, 6);
});

test('track checkbox uses existing add callback once even on repeated changes before a rerender', () => {
  const runtime = host();
  const additions = [];
  const props = {holdings: [holding], watchlist: [], onTrack: row => additions.push(row)};
  let tree = runtime.render(runtime.components.ResearchPanel, props);
  const button = trackCheckbox(tree);
  button.props.onChange({target:{checked:true}});
  button.props.onChange({target:{checked:true}});
  assert.equal(additions.length, 1);
  assert.equal(additions[0].name, 'Example Company');
  assert.equal(additions[0].symbol, 'EXAMPLE');
  tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.equal(trackCheckbox(tree).props.disabled, true);
  assert.equal(trackCheckbox(tree).props.checked, true);
});

test('already tracked holding never calls add or patches existing notes and alerts', () => {
  const runtime = host();
  const existing = {id: 'existing', symbol: 'EXAMPLE', notes: 'Keep', notifEnabled: true, s1: '8'};
  const before = structuredClone(existing);
  let additions = 0;
  const tree = runtime.render(runtime.components.ResearchPanel, {
    holdings: [holding], watchlist: [existing], onTrack: () => additions++,
  });
  const button = trackCheckbox(tree);
  assert.equal(button.props.disabled, true);
  button.props.onChange({target:{checked:true}});
  assert.equal(additions, 0);
  assert.deepEqual(existing, before);
});

test('parent watchlist owns tracking after add acknowledgement and permits later re-add', () => {
  const runtime = host();
  const additions = [];
  let props = {holdings: [holding], watchlist: [], onTrack: row => additions.push(row)};
  let tree = runtime.render(runtime.components.ResearchPanel, props);
  trackCheckbox(tree).props.onChange({target:{checked:true}});
  assert.equal(additions.length, 1);
  // The app's real add path now publishes the row back through props.
  props = {...props, watchlist: [{...additions[0], id: 'accepted'}]};
  tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.equal(trackCheckbox(tree).props.checked, true);
  // User removes that row through the independent watchlist view.
  props = {...props, watchlist: []};
  tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.equal(trackCheckbox(tree).props.checked, false);
  assert.equal(trackCheckbox(tree).props.disabled, false);
  trackCheckbox(tree).props.onChange({target:{checked:true}});
  assert.equal(additions.length, 2);
});

test('watchlist research metrics update from callbacks and respect monetary privacy', () => {
  const runtime = host();
  let close = 10;
  const props = {scope: 'watchlist', watchlist: [{symbol: 'EXAMPLE'}], privacyMode: true,
    getHoldingMetrics: () => ({close, avgPrice: 8, bValue: close * 2})};
  let tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.ok(content(tree).includes('10.00'));
  assert.ok(!content(tree).includes('8.00'), 'Private average purchase price is hidden while public quotes remain visible');
  assert.ok(!content(tree).includes('S$•••'), 'BValue is removed entirely from research');
  assert.equal(nodes(tree, 'button').length, 1);
  assert.equal(nodes(tree, 'button')[0].props.disabled, true, 'calculation is unavailable without a service adapter');
  close = 11;
  tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.ok(content(tree).includes('11.00'));
  assert.ok(!content(tree).includes('S$22.00'));
});

test('view switch exposes state and sends explicit positions/research choices', () => {
  const runtime = host();
  const choices = [];
  const tree = runtime.render(runtime.components.ResearchViewSwitch, {
    research: false, defaultLabel: 'Positions', onChange: next => choices.push(next),
  });
  const buttons = nodes(tree, 'button');
  assert.equal(buttons[0].props['aria-pressed'], true);
  assert.equal(buttons[1].props['aria-pressed'], false);
  buttons[1].props.onClick(); buttons[0].props.onClick();
  assert.deepEqual(choices, [true, false]);
});

test('product validation states distinguish provisional/experimental and not applicable', () => {
  for (const state of ['experimental', 'provisional', 'not_applicable']) assert.ok(VALIDATION_STATES.includes(state));
});

test('compiled Holdings integration keeps Research across accounts despite remembered Positions filters', () => {
  const bundle = readFileSync(new URL('../assets/index-CUEh86Kk.js', import.meta.url), 'utf8');
  const start = bundle.indexOf('function NN(');
  const end = bundle.indexOf('async function ', start);
  assert.ok(start >= 0 && end > start, 'Holdings component extraction boundary');
  const states = [true, false, false, 'Growth', 'Cash'];
  let hook = 0;
  const jsx = (type, props) => ({type, props});
  const context = {
    ne: {useState: initial => [hook < states.length ? states[hook++] : (hook++, initial), () => {}],
      useMemo: calculate => calculate()},
    m: {jsx, jsxs: jsx}, Ca: 'expand', md: 'collapse', eg: 'columns', ka: 'warning',
    selectCategoryRows,categoryRank,CategoryControls:'category-controls',ResearchPanel: 'research-panel', ResearchViewSwitch: 'research-switch', combinedHolding,
    Dt: (row, prices) => row.shares * prices[row.ticker].close,
    Tr: row => row.shares * row.average_cost,
  };
  runInNewContext(`${bundle.slice(start, end)}; this.renderHoldings = NN;`, context);
  const holdings = [
    {...holding, accountType: 'Cash', portfolioType: 'Growth'},
    {...holding, accountType: 'Retirement - SRS', portfolioType: 'Growth', shares: 3, average_cost: 20},
    {ticker: 'OTHER-EXAMPLE', accountType: 'Retirement - SRS', portfolioType: 'Dividend', shares: 1, average_cost: 7},
    {ticker: 'EXITED-EXAMPLE', portfolioType: 'Growth', exited: true},
  ];
  const tree = context.renderHoldings({holdings, prices: {EXAMPLE: {close: 25}, 'OTHER-EXAMPLE': {close: 9}},
    fxRate: 1, fxRates: {}, cash: {}, portfolioTypes: [], accountTypes: [], columnVisibility: {}});
  function find(node, type) {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === type) return node;
    return [node.props?.children].flat(Infinity).map(child => find(child, type)).find(Boolean);
  }
  const panel = find(tree, 'research-panel');
  assert.equal(panel.props.holdings, holdings, 'Research receives the whole account universe');
  const metrics = panel.props.getHoldingMetrics('EXAMPLE');
  assert.equal(metrics.avgPrice, 16, 'Avg Price combines active accounts by shares');
  assert.equal(metrics.bValue, 125, 'BValue matches that same combined universe');
  const runtime = host();
  const rendered = runtime.render(runtime.components.ResearchPanel, panel.props);
  assert.equal(nodes(rendered, 'tbody')[0].children.length, 2, 'hidden filters cannot remove a Research symbol');
  assert.ok(content(rendered).includes('OTHER-EXAMPLE'));
  assert.ok(!content(rendered).includes('EXITED-EXAMPLE'));
});

test('completed research renders independent values and separate matched or uncovered comparisons', () => {
  const runtime=host();
  const base={securityId:'EXAMPLE',symbol:'EXAMPLE',requestId:'request',workerAcknowledged:true,
    reference:{present:true,asOf:'2026-11-03',currency:'USD',source:'capital_gains',iv:{value:20,method:'dcf_20y',variants:[{label:'Base IV',value:20}]},supports:[18,16]},
    iv:{processing:'completed',validation:'experimental',result:{value:20.5,method:'Historical-growth DCF20',source:'Fixture',asOf:'2026-11-03'}},
    supports:{processing:'completed',validation:'experimental',result:{value:[18.1,16],method:'Chart confluence',source:'Fixture',asOf:'2026-11-03'}},
    comparison:{iv:{status:'matched',errorPct:2.5},supports:{status:'different',matchedCount:1,referenceCount:2,missingCount:1,extraCount:1}}};
  const tree=runtime.render(runtime.components.ResearchPanel,{scope:'watchlist',watchlist:[{symbol:'EXAMPLE',iv:'999'}],
    research:{records:{EXAMPLE:base},request:async()=>{}}});
  const text=content(tree);
  assert.ok(text.includes('20.50'));
  assert.ok(text.includes('18.10'));
  assert.ok(text.includes('Matches'));
  assert.ok(text.includes('Different'));
  assert.ok(text.includes('Historical-growth DCF20'));
  assert.ok(!text.includes('999'));
  assert.equal(researchComparisonLabel({...base,reference:{present:false}},'iv').text,'No benchmark');
  assert.equal(researchComparisonLabel({...base,reference:undefined},'iv').text,'Reference not loaded');
});

test('requested, no reference value, different dates and ETF states are never presented as a validated match', () => {
  const completed={requestId:'one',workerAcknowledged:true,reference:{present:true,iv:{value:20},supports:[18]},
    iv:{processing:'completed'},supports:{processing:'completed'},comparison:{iv:{status:'matched'},supports:{status:'matched'}}};
  assert.equal(researchProcessingLabel({...completed,workerAcknowledged:false,iv:{processing:'processing'}},'iv'),'Requested');
  assert.equal(researchComparisonLabel({...completed,iv:{processing:'not_started'}},'iv').text,'Awaiting calculation');
  assert.equal(researchComparisonLabel({...completed,reference:{present:true,iv:{value:null,variants:[]}}},'iv').text,'No published IV');
  assert.equal(researchComparisonLabel({...completed,comparison:{iv:{status:'awaiting_comparable_vintage'}}},'iv').text,'Different data dates');
  assert.equal(researchComparisonLabel({...completed,iv:{processing:'unsupported',validation:'not_applicable'}},'iv').text,'Not applicable');
});

test('the compiled original watchlist receives automatic names without overwriting a custom name',()=>{
  const bundle=readFileSync(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
  const start=bundle.indexOf('function tN('),end=bundle.indexOf('const nN=',start);
  assert.ok(start>=0&&end>start);
  const values=[];let cursor=0;
  const initial={holdings:[],priceCache:{},emailSettings:{},watchlist:[{id:'one',symbol:'EXAMPLE',name:''},{id:'two',symbol:'CUSTOM',name:'My custom company'}]};
  const React={useState:initial=>{const index=cursor++;if(!(index in values))values[index]=initial;return [values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;}];},
    useRef:value=>({current:value}),useEffect:()=>{},useCallback:fn=>fn};
  const context={ne:React,In:initial,mergeResolvedWatchlistNames};
  runInNewContext(`${bundle.slice(start,end)};this.hook=tN;`,context);
  cursor=0;let result=context.hook({uid:'private-test-user',restoring:{current:false}});
  result.resolveResearchNames({EXAMPLE:{securityId:'EXAMPLE',symbol:'EXAMPLE',instrument:{name:'Resolved company'}},CUSTOM:{securityId:'CUSTOM',symbol:'CUSTOM',instrument:{name:'Vendor name'}}});
  cursor=0;result=context.hook({uid:'private-test-user',restoring:{current:false}});
  assert.equal(result.state.watchlist[0].name,'Resolved company');
  assert.equal(result.state.watchlist[1].name,'My custom company');
  assert.ok(bundle.includes('onResolvedNames:resolveResearchNames'));
});

test('a completed result with an old comparison snapshot cannot claim a match against a newly imported reference',()=>{
  const base={requestId:'one',workerAcknowledged:true,reference:{present:true,snapshotId:'new',asOf:'2026-11-03',iv:{value:20}},
    iv:{processing:'completed'},comparison:{iv:{status:'matched',snapshotId:'old',referenceAsOf:'2026-10-20'}}};
  assert.equal(researchComparisonLabel(base,'iv').text,'Awaiting comparison');
  const current={...base,comparison:{iv:{status:'matched',snapshotId:'new',referenceAsOf:'2026-11-03'}}};
  assert.equal(researchComparisonLabel(current,'iv').text,'Matches');
});

test('collapsed pasted-reference fallback uses the existing private importer and clears successful pasted data',async()=>{
  const runtime=host();
  const imports=[];
  const props={scope:'watchlist',watchlist:[],research:{records:{},importSnapshot:async text=>{imports.push(text);return {dates:['2026-11-03']};}}};
  let tree=runtime.render(runtime.components.ResearchPanel,props);
  assert.ok(content(tree).includes('Experimental · validation in progress'));
  const fallback=nodes(tree,'details').find(item=>content(item).includes('Paste reference JSON'));
  assert.equal(fallback.props.open,undefined,'paste fallback stays collapsed by default');
  assert.ok(nodes(tree,'input').some(item=>item.props.type==='file'),'existing file chooser is retained');
  const source='{"retrievedAt":"2026-11-12","rows":[]}';
  nodes(tree,'textarea')[0].props.onChange({target:{value:source}});
  tree=runtime.render(runtime.components.ResearchPanel,props);
  const button=nodes(tree,'button').find(item=>content(item)==='Import pasted reference');
  assert.equal(button.props.disabled,false);
  await Promise.all([button.props.onClick(),button.props.onClick()]);
  assert.deepEqual(imports,[source],'repeated clicks cannot duplicate the import');
  tree=runtime.render(runtime.components.ResearchPanel,props);
  assert.equal(nodes(tree,'textarea')[0].props.value,'','successful pasted data is cleared');
  assert.ok(content(tree).includes('Reference imported: 2026-11-03'));
});

test('pasted-reference validation errors use the same status path and keep text available for correction',async()=>{
  const runtime=host();
  const imports=[];
  const props={scope:'watchlist',watchlist:[],research:{records:{},importSnapshot:async text=>{
    imports.push(text);if(text==='invalid')throw Error('Invalid reference JSON.');return {dates:['2026-11-04']};
  }}};
  let tree=runtime.render(runtime.components.ResearchPanel,props);
  nodes(tree,'textarea')[0].props.onChange({target:{value:'invalid'}});
  tree=runtime.render(runtime.components.ResearchPanel,props);
  await nodes(tree,'button').find(item=>content(item)==='Import pasted reference').props.onClick();
  tree=runtime.render(runtime.components.ResearchPanel,props);
  assert.equal(nodes(tree,'textarea')[0].props.value,'invalid');
  assert.ok(nodes(tree,'p').some(item=>item.props.role==='alert'&&content(item)==='Invalid reference JSON.'));
  const target={files:[{size:100,text:async()=> 'file-reference'}],value:'chosen.json'};
  await nodes(tree,'input').find(item=>item.props.type==='file').props.onChange({target});
  assert.deepEqual(imports,['invalid','file-reference'],'both controls use the same importer');
  assert.equal(target.value,'');
  tree=runtime.render(runtime.components.ResearchPanel,props);
  assert.ok(content(tree).includes('Reference imported: 2026-11-04'));
  assert.ok(!content(tree).includes('Invalid reference JSON.'));
});

test('a pending calculation or a new reference cannot display stale comparison reasons or metrics',()=>{
  const runtime=host();
  const oldComparison={status:'different',snapshotId:'old',referenceAsOf:'2026-10-20',
    reason:'No reference snapshot has been loaded.',errorPct:33,matchedCount:1,referenceCount:4,missingCount:3,extraCount:2};
  const base={securityId:'EXAMPLE',symbol:'EXAMPLE',requestId:'retry',workerAcknowledged:false,
    reference:{present:true,snapshotId:'new',asOf:'2026-11-03',iv:{value:20},supports:[18,16]},
    iv:{processing:'not_started',result:null},supports:{processing:'not_started',result:null},
    comparison:{iv:{...oldComparison,status:'pending'},supports:{...oldComparison,status:'pending'}}};
  const render=record=>runtime.render(runtime.components.ResearchPanel,{scope:'watchlist',watchlist:[{symbol:'EXAMPLE'}],research:{records:{EXAMPLE:record}}});
  let tree=render(base);
  assert.ok(!content(tree).includes(oldComparison.reason));
  assert.ok(nodes(tree,'span').every(item=>!String(item.props.title??'').includes('33.0%')));
  const completed={...base,workerAcknowledged:true,iv:{processing:'completed',result:{value:20}},supports:{processing:'completed',result:{value:[18,16]}},
    comparison:{iv:oldComparison,supports:oldComparison}};
  tree=render(completed);
  assert.ok(!content(tree).includes(oldComparison.reason),'completion cannot revive comparison details from another snapshot');
  assert.ok(nodes(tree,'span').every(item=>!String(item.props.title??'').includes('supports matched')));
  const current={...completed,comparison:{iv:{...oldComparison,snapshotId:'new',referenceAsOf:'2026-11-03',reason:'Current comparable result.'},
    supports:{...oldComparison,snapshotId:'new',referenceAsOf:'2026-11-03',reason:'Current comparable supports.'}}};
  tree=render(current);
  assert.ok(content(tree).includes('Current comparable result.'));
  assert.ok(nodes(tree,'span').some(item=>String(item.props.title??'').includes('33.0%')));
});

test('an old unacknowledged request reports worker delay without claiming calculation has started',()=>{
  const now=Date.parse('2026-11-12T10:00:00Z');
  const base={requestId:'waiting',workerAcknowledged:false,phase:'requested',requestedAt:'2026-11-12T09:20:00Z',iv:{processing:'not_started'}};
  assert.equal(researchProcessingLabel(base,'iv',now),'Requested');
  assert.equal(researchWaitReason(base,'iv',now),'');
  const older={...base,requestedAt:'2026-11-12T09:10:00Z'};
  assert.equal(researchProcessingLabel(older,'iv',now),'Worker delayed');
  assert.match(researchWaitReason(older,'iv',now),/background worker has not picked up/);
  assert.match(researchWaitReason(older,'iv',now),/previous result remains visible/);
  assert.equal(researchProcessingLabel({...older,workerAcknowledged:true,iv:{processing:'processing'}},'iv',now),'Processing');
  assert.equal(researchWaitReason({...older,workerAcknowledged:true},'iv',now),'');
  assert.equal(researchProcessingLabel({...older,iv:{processing:'completed'}},'iv',now),'Completed');
  assert.equal(researchProcessingLabel({...older,iv:{processing:'unavailable'}},'iv',now),'Data unavailable');
  assert.equal(researchProcessingLabel({...older,phase:'restored',iv:{processing:'blocked'}},'iv',now),'Request blocked');
  assert.equal(researchWaitReason({...older,phase:'restored'},'iv',now),'');
});

test('AK view displays dated sheet levels and updates active levels only after the explicit preview action',()=>{
  const app=host(),applied=[];
  const watchlist=[{id:'existing',symbol:'EXAMPLE',s1:'99',notes:'keep',notifEnabled:true}];
  const record={symbol:'EXAMPLE',securityId:'EXAMPLE',modelVersion:'v1',reference:{present:true,asOf:'2026-11-03',label:'Capital gains',supports:[18,16],iv:{value:20}},supports:{processing:'completed',result:{value:[80,60]}}};
  const props={scope:'watchlist',watchlist,onApplyAkLevels:(...args)=>applied.push(args),research:{records:{EXAMPLE:record}}};
  let tree=app.render(app.components.ResearchPanel,props);
  nodes(tree,'select').find(n=>n.props['aria-label']==='Displayed level source').props.onChange({target:{value:'ak'}});
  tree=app.render(app.components.ResearchPanel,props);
  assert.match(content(tree),/AK IV/);assert.match(content(tree),/Sheet 2026-11-03/);
  nodes(tree,'button').find(n=>content(n)==='Use AK SL in watchlist').props.onClick();
  assert.equal(applied.length,0,'opening a preview does not change active alerts');
  tree=app.render(app.components.ResearchPanel,props);
  nodes(tree,'button').find(n=>content(n)==='Apply AK levels').props.onClick();
  assert.deepEqual(applied,[['existing',{s1:'18',s2:'16',s3:'',s4:'',s5:''}]]);
  assert.equal(watchlist[0].s1,'99');assert.equal(watchlist[0].notifEnabled,true);
});

test('monthly SL numerical comparison is separate from backdated confidence and source freshness',()=>{
  const record={reference:{present:true,asOf:'2026-11-03',supports:[18]},supports:{processing:'completed',result:{value:[18]}},
    comparison:{supports:{status:'awaiting_comparable_vintage',matchedCount:1,referenceCount:1,missingCount:0,extraCount:0}}};
  assert.equal(researchComparisonLabel(record,'supports').text,'Matches');
  assert.equal(researchComparisonLabel({...record,comparison:{supports:{...record.comparison.supports,missingCount:1}}},'supports').text,'Different');
});

test('backdated confidence cannot carry over to a different model, date or reference levels',()=>{
  const app=host();const reference={present:true,asOf:'2026-11-03',supports:[18,16]};
  const assessment={modelVersion:'v1',studyMonth:'2026-11',referenceAsOf:'2026-11-03',referenceKey:JSON.stringify(['EXAMPLE','2026-11-03',[18,16]]),confidence:'low'};
  const base={symbol:'EXAMPLE',securityId:'EXAMPLE',modelVersion:'v1',reference,backdatedSupportAssessment:assessment};
  const render=record=>app.render(app.components.ResearchPanel,{scope:'watchlist',watchlist:[{symbol:'EXAMPLE'}],research:{records:{EXAMPLE:record}}});
  assert.match(content(render(base)),/Backdated confidence: Low/);
  for(const changed of [{...base,modelVersion:'v2'},{...base,reference:{...reference,asOf:'2026-11-04'}},{...base,reference:{...reference,supports:[19,17]}}])
    assert.match(content(render(changed)),/Backdated confidence: Not assessed/);
});
test('monthly IV arithmetic can be compared while the historical input vintage remains unvalidated',()=>{
  const reference={present:true,asOf:'2026-11-04',iv:{value:20}};
  const record={reference,iv:{processing:'completed',result:{value:22}},comparison:{iv:{status:'awaiting_comparable_vintage',selectedKey:'baseIV',errorPct:10,
    variants:[{referenceKey:'baseIV',status:'different'}]}}};
  assert.equal(researchComparisonLabel(record,'iv').text,'Different');
  record.comparison.iv.variants[0].status='matched';assert.equal(researchComparisonLabel(record,'iv').text,'Matches');
  record.comparison.iv.variants[0].status='method_mismatch';assert.equal(researchComparisonLabel(record,'iv').text,'Different data dates');
});

test('symbol badges show only IV and SL with colour, accessible text and hover status',()=>{
 const runtime=host();
 const record={requestId:'one',reference:{present:true,iv:{value:20},supports:[18]},iv:{processing:'unsupported',validation:'not_applicable'},supports:{processing:'completed'},comparison:{supports:{status:'different'}}};
 const tree=runtime.render(runtime.components.ResearchBadge,{record,onOpen:()=>{}});
 assert.equal(content(tree).trim(),'IV SL');
 const chips=nodes(tree,'span');assert.match(chips[0].props.className,/research-not-applicable/);assert.equal(chips[0].props.title,'IV: Not applicable');
 assert.match(chips[1].props.className,/research-different/);assert.equal(chips[1].props.title,'SL: Different');
 assert.match(tree.props['aria-label'],/Not applicable.*Different/);
 const noBenchmark=runtime.render(runtime.components.ResearchBadge,{record:{reference:{present:false}}});
 assert.ok(nodes(noBenchmark,'span').every(n=>n.props.className.includes('research-neutral')));
 assert.equal(content(noBenchmark).trim(),'IV SL');
});
test('research column settings hide matching headers and cells and never offer Category or BValue',()=>{
 const runtime=host();let visibility={};
 let controls=runtime.render(runtime.components.ResearchColumnSettings,{scope:'holdings',visibility,onChange:next=>visibility=next});
 assert.ok(!content(controls).includes('BValue'));assert.ok(!content(controls).includes('Category'));
 const labels=nodes(controls,'label'),sl1=labels.find(n=>content(n).trim()==='SL1');nodes(sl1,'input')[0].props.onChange({target:{checked:false}});
 assert.equal(visibility.sl1,false);
 const symbol=labels.find(n=>content(n).trim()==='Symbol / Name');assert.equal(nodes(symbol,'input')[0].props.disabled,true);
 const props={scope:'holdings',holdings:[holding],columnVisibility:{...visibility,'iv-status':false,research:false}};
 let tree=runtime.render(runtime.components.ResearchPanel,props);
 const headers=nodes(tree,'th');assert.ok(!headers.some(n=>['sl1','iv-status','research','bvalue','category'].includes(n.props['data-column'])));
 assert.equal(nodes(tree,'td').length,headers.length,'Every row remains aligned with its visible headings');
 assert.ok(headers.some(n=>n.props['data-column']==='track'));
 tree=runtime.render(runtime.components.ResearchPanel,{...props,scope:'watchlist',watchlist:[{symbol:'EXAMPLE'}]});
 assert.ok(!nodes(tree,'th').some(n=>n.props['data-column']==='track'));
});
test('research controls place source and sync on the left, settings and maintenance on the right',()=>{
 const runtime=host();const tree=runtime.render(runtime.components.ResearchPanel,{scope:'watchlist',watchlist:[{symbol:'EXAMPLE'}],research:{records:{},hydrated:true,syncAkSheets:async()=>({readable:4}),sheetSyncStatus:{checkedAt:'2026-11-12T12:48:13Z'},sheetSources:{},referenceMeta:{dates:['2026-11-03']}}});
 const groups=nodes(tree,'div');
 const left=groups.find(n=>n.props.className==='research-toolbar-primary'),right=groups.find(n=>n.props.className==='research-toolbar-secondary');
 assert.ok(content(left).includes('Displayed levels'));assert.ok(content(left).includes('Sync AK sheets'));assert.ok(!content(left).includes('AK sheet settings'));
 assert.ok(content(right).includes('AK sheet settings'));assert.ok(content(right).includes('Refresh status'));assert.ok(content(left).includes('Last sheet check'));assert.ok(!content(right).includes('Last sheet check'));
});
