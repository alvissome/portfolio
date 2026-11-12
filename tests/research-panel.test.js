import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {combinedHolding} from '../assets/account-portfolio.js';
import {createResearchComponents,researchProcessingLabel,researchComparisonLabel} from '../assets/research-panel.js';
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
function trackButton(tree) {return nodes(tree, 'button').find(button => ['Track in watchlist', 'Tracked'].includes(content(button)));}
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
  assert.ok(text.includes('S$30.00'));
  assert.ok(text.includes('15.00'));
  assert.ok(!text.includes('98765'));
  assert.ok(!text.includes('87654'));
  assert.equal((text.match(/Research service is not connected/g) || []).length, 1);
  assert.equal((text.match(/Not started/g) || []).length, 2, 'separate IV and SL processing badges');
  assert.equal(nodes(tree, 'td').filter(cell => content(cell) === '—').length, 6);
});

test('track button uses existing add callback once even on repeated clicks before a rerender', () => {
  const runtime = host();
  const additions = [];
  const props = {holdings: [holding], watchlist: [], onTrack: row => additions.push(row)};
  let tree = runtime.render(runtime.components.ResearchPanel, props);
  const button = trackButton(tree);
  button.props.onClick();
  button.props.onClick();
  assert.equal(additions.length, 1);
  assert.equal(additions[0].name, 'Example Company');
  assert.equal(additions[0].symbol, 'EXAMPLE');
  tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.equal(trackButton(tree).props.disabled, true);
  assert.equal(content(trackButton(tree)), 'Tracked');
});

test('already tracked holding never calls add or patches existing notes and alerts', () => {
  const runtime = host();
  const existing = {id: 'existing', symbol: 'EXAMPLE', notes: 'Keep', notifEnabled: true, s1: '8'};
  const before = structuredClone(existing);
  let additions = 0;
  const tree = runtime.render(runtime.components.ResearchPanel, {
    holdings: [holding], watchlist: [existing], onTrack: () => additions++,
  });
  const button = trackButton(tree);
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.equal(additions, 0);
  assert.deepEqual(existing, before);
});

test('parent watchlist owns tracking after add acknowledgement and permits later re-add', () => {
  const runtime = host();
  const additions = [];
  let props = {holdings: [holding], watchlist: [], onTrack: row => additions.push(row)};
  let tree = runtime.render(runtime.components.ResearchPanel, props);
  trackButton(tree).props.onClick();
  assert.equal(additions.length, 1);
  // The app's real add path now publishes the row back through props.
  props = {...props, watchlist: [{...additions[0], id: 'accepted'}]};
  tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.equal(content(trackButton(tree)), 'Tracked');
  // User removes that row through the independent watchlist view.
  props = {...props, watchlist: []};
  tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.equal(content(trackButton(tree)), 'Track in watchlist');
  assert.equal(trackButton(tree).props.disabled, false);
  trackButton(tree).props.onClick();
  assert.equal(additions.length, 2);
});

test('watchlist research metrics update from callbacks and respect monetary privacy', () => {
  const runtime = host();
  let close = 10;
  const props = {scope: 'watchlist', watchlist: [{symbol: 'EXAMPLE'}], privacyMode: true,
    getHoldingMetrics: () => ({close, avgPrice: 8, bValue: close * 2})};
  let tree = runtime.render(runtime.components.ResearchPanel, props);
  assert.ok(content(tree).includes('10.00'));
  assert.ok(content(tree).includes('8.00'), 'Avg Price remains visible in privacy mode, matching existing tables');
  assert.ok(content(tree).includes('S$•••'));
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
    ResearchPanel: 'research-panel', ResearchViewSwitch: 'research-switch', combinedHolding,
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
