import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateIV} from '../.github/scripts/research-calculations.mjs';
import {buildResearchRequest} from '../assets/research-client.js';
import {normalizeValuationSettings,IV_POLICY_VERSION} from '../assets/valuation-settings.js';
import {prepareValuationUpgrade,claimRecord,mergeProgress} from '../.github/scripts/runResearch.js';

const date='2026-03-02';
const source={source:'Dated worked calculator',inputsAsOf:date};
const facts={source:'Fixture',asOf:date,financialCurrency:'USD',listingSharesVerified:true,
  annual:[2021,2022,2023,2024,2025].map((year,i)=>({end:year+'-12-31',cfo:100+i*10,capex:20,netIncome:60+i*5,equity:600,shares:10})),
  ttm:{cfo:150,capex:20,netIncome:85,cash:100,totalDebt:50,shares:10,equity:600,revenue:1000}};
const data={instrument:{type:'EQUITY',currency:'USD',methodFamily:'stock'},fundamentals:facts};
const run=(valuation,other=data)=>calculateIV(other,{valuation:{...source,...valuation}},date);

test('FCF and OCF worked examples use supplied scenarios and full discount precision',()=>{
  const cases=[
    [{method:'ocf',baseFlow:5651,cash:1801,debt:13088,shares:305.1,g1:.1167,g2:.1167,g3:.04,discountRate:.0657},'463.78'],
    [{method:'ocf',baseFlow:5651,cash:1801,debt:13088,shares:305.1,g1:.1317,g2:.1317,g3:.04,discountRate:.0657},'520.70'],
    [{method:'dcf',baseFlow:4533,cash:6290,debt:1491,shares:1046.7,g1:.2084,g2:.15,g3:.04,discountRate:.0597},'204.49'],
    [{method:'dcf',baseFlow:8403,cash:13122,debt:3226,shares:1659,g1:.509,g2:.25,g3:.04,discountRate:.0797},'757.00'],
  ];
  for(const [inputs,expected] of cases)assert.equal(run(inputs).result.value.toFixed(2),expected);
});

test('normalization windows and balance-sheet bridge are explicit for FCF, OCF and DNI',()=>{
  const average=run({method:'dni',flowYears:5,g1:.1});
  assert.equal(average.result.inputs.baseFlow,70);
  assert.equal(average.result.inputs.cash,100);
  assert.equal(average.result.inputs.debt,50);
  assert.equal(run({method:'ocf',flowYears:5,g1:.1}).result.inputs.baseFlow,120);
  assert.equal(run({method:'dcf',capexYears:3,g1:.1}).result.inputs.baseFlow,130);
  const short={...data,fundamentals:{...facts,annual:facts.annual.slice(-2)}};
  assert.equal(run({method:'dni',flowYears:5,g1:.1},short).processing,'unavailable');
});

test('negative FCF requires an explicit alternate method instead of silently switching to earnings',()=>{
  const negative={...data,fundamentals:{...facts,ttm:{...facts.ttm,cfo:10,capex:500}}};
  assert.equal(calculateIV(negative,{},date).code,'flow_basis_required');
  assert.equal(run({method:'dni',g1:.1},negative).processing,'completed');
});

test('forecast average/lowest/highest, stage overrides and historical proxy remain distinguishable',()=>{
  for(const [growthSelection,g1] of [['average',.2],['lowest',.1],['highest',.3]]){
    const result=run({method:'dcf',growthEstimates:[.1,.2,.3],growthSelection,g3:.06});
    assert.ok(Math.abs(result.result.inputs.g1-g1)<1e-12);
    assert.equal(result.result.inputs.g3,.06);
    assert.match(result.result.method,/Forecast/);
  }
  assert.match(calculateIV(data,{},date).result.method,/Historical-growth proxy/);
});

test('sales methods use revenue growth in percentage points and require their own inputs',()=>{
  const psg=run({method:'psg',g1:.7});
  assert.equal(psg.result.inputs.impliedPS,14);
  assert.equal(psg.result.value,1400);
  assert.equal(run({method:'ps',historicalMultiple:2.5}).result.value,250);
  assert.equal(run({method:'psg'}).code,'revenue_forecast_required');
});

test('NAV and dividend yield are separate and funds need explicit dated NAV',()=>{
  const fund={instrument:{type:'ETF',currency:'USD',methodFamily:'fund'}};
  assert.equal(calculateIV(fund,{},date).validation,'not_applicable');
  assert.equal(run({method:'nav',bookValuePerShare:11.42},fund).result.value,11.42);
  assert.equal(run({method:'yield',dividendPerShare:.12,targetYield:.06}).result.value,2);
  assert.equal(run({method:'historical_pb',bookValuePerShare:65.11,historicalMultiple:1.68}).result.value.toFixed(2),'109.38');
});

test('unverified ADR and currency mapping require dated explicit listing shares and FX',()=>{
  const adr={...data,instrument:{...data.instrument,currency:'HKD'},fundamentals:{...facts,listingSharesVerified:false}};
  assert.equal(calculateIV(adr,{valuation:{method:'ocf'}},date).code,'currency_mapping_required');
  const mapped=run({method:'ocf',shares:80,fxRate:7.8,g1:.1},adr);
  assert.equal(mapped.processing,'completed');
  assert.equal(mapped.result.inputs.shares,80);
  assert.equal(mapped.result.inputs.fxRate,7.8);
  assert.equal(mapped.result.pointInTimeVerified,false);
});

test('settings reject untraceable numeric overrides, future dates and invalid denominators',()=>{
  assert.throws(()=>normalizeValuationSettings({g1:.1}),/source and date/);
  assert.throws(()=>normalizeValuationSettings({...source,shares:0}),/positive/);
  assert.equal(run({discountRate:-1}).code,'invalid_assumptions');
  assert.equal(run({inputsAsOf:'2026-03-03',g1:.1}).code,'input_vintage_required');
});

test('settings persist across recalculation and automatic method resets, and can be cleared explicitly',()=>{
  const security={symbol:'EXAMPLE',valuation:{...source,method:'ocf',g1:.2}};
  const first=buildResearchRequest(security,{requestId:'a'});
  const next=buildResearchRequest({symbol:'EXAMPLE',methodFamilyOverride:'auto'},{previous:first,requestId:'b'});
  assert.deepEqual(next.valuation,first.valuation);
  assert.deepEqual(buildResearchRequest({symbol:'EXAMPLE',valuation:{}},{previous:next,requestId:'c'}).valuation,{});
  assert.equal(next.ivPolicyVersion,IV_POLICY_VERSION);
});

test('policy migration retries once, retains old results and respects an in-flight request',()=>{
  const previous=buildResearchRequest({symbol:'EXAMPLE'},{requestId:'before'});
  const finished={...previous,phase:'finished',ivPolicyVersion:'old',iv:{processing:'completed',result:{value:10}}};
  const upgrade=prepareValuationUpgrade(finished);
  assert.equal(upgrade.iv.previousResult.value,10);
  const claimed=claimRecord(upgrade,Date.now(),'lease');
  assert.ok(claimed);
  const complete=mergeProgress(claimed,claimed,{phase:'finished',iv:{processing:'completed',result:{value:12}}},'lease');
  assert.equal(prepareValuationUpgrade(complete).phase,'finished');
  assert.equal(prepareValuationUpgrade({...finished,phase:'fetching'}).phase,'fetching');
});

test('input editor converts percentages once and submits through the normal research request',async()=>{
  const {createValuationEditor}=await import('../assets/valuation-editor.js');
  const values=[];let cursor=0;const calls=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat().filter(v=>v!=null)}),
    useEffect:()=>{},useState:initial=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;
      return [values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];}};
  const Editor=createValuationEditor(React);
  const props={row:{symbol:'EXAMPLE'},record:{},research:{request:async(...args)=>calls.push(args)}};
  const render=()=>{cursor=0;return Editor(props);};
  const find=(node,predicate)=>node&&typeof node==='object'?(predicate(node)?node:node.children.map(child=>find(child,predicate)).find(Boolean)):null;
  let tree=render();
  for(const [label,value] of [['Growth years 1–5 (%) for EXAMPLE','18'],['Input source / scenario rationale for EXAMPLE','Dated source'],['Input date for EXAMPLE',date]]){
    find(tree,n=>n.props['aria-label']===label).props.onChange({target:{value}});tree=render();
  }
  const save=find(tree,n=>n.type==='button'&&n.children.includes('Save inputs & recalculate'));
  await save.props.onClick();
  assert.equal(calls.length,1);
  assert.equal(calls[0][1].valuation.g1,.18);
  assert.equal(calls[0][1].force,true);
  tree=render();
  find(tree,n=>n.type==='button'&&n.children.includes('Reset to automatic')).props.onClick();
  await Promise.resolve();
  assert.deepEqual(calls[1][1].valuation,{});
});
