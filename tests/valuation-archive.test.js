import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateIV, discountedCashFlow, dividendDiscount} from '../.github/scripts/research-calculations.mjs';
import {compareResearch} from '../.github/scripts/research-engine.mjs';
import {normalizeValuationSettings} from '../assets/valuation-settings.js';
import {createValuationEditor} from '../assets/valuation-editor.js';

const day='2026-11-17';
const source={source:'Historical worksheet reconstruction; not current assumptions',inputsAsOf:'2026-07-28'};
const fixture={instrument:{currency:'USD',methodFamily:'stock',type:'EQUITY'},fundamentals:{
  financialCurrency:'USD',listingSharesVerified:true,annual:[],
  ttm:{cfo:10000,capex:2000,netIncome:5000,cash:500,totalDebt:1000,shares:100,equity:3000}}};
const run=(valuation,data=fixture)=>calculateIV(data,{valuation:{...source,...valuation}},day);
const wm={method:'dcf',projection:'terminal_10',baseFlow:2163,cash:485,debt:24020,shares:404.3,
  g1:.0954,g2:.1081,discountRate:.0705,terminalGrowth:.04};
const cjlu={method:'ddm',dividendPerShare:.0542,dividendGrowthRates:[.006,-.02,.015,.02,.02],
  discountRate:.065,terminalGrowth:.0125};

test('NetLink example forecasts five years after the base DPU and does not add a second balance-sheet bridge',()=>{
  const data={instrument:{currency:'SGD',type:'EQUITY',methodFamily:'reit'}};
  const result=run(cjlu,data);
  assert.equal(result.processing,'completed');
  assert.equal(result.result.methodId,'ddm');
  assert.equal(result.result.value.toFixed(3),'1.022');
  assert.ok(Math.abs(result.result.value-1.0216823959871928)<1e-12);
  assert.equal(result.result.inputs.forecastYears,5);
  assert.equal((result.result.inputs.distributionsPresentValue*100).toFixed(3),'22.740');
  assert.equal((result.result.inputs.terminalPresentValue*100).toFixed(3),'79.429');
  assert.equal(result.result.pointInTimeVerified,false);
  const withFacts={...data,fundamentals:{financialCurrency:'USD',listingSharesVerified:false,
    ttm:{cash:1e12,totalDebt:2e12,shares:1},annual:[]}};
  assert.equal(run(cjlu,withFacts).result.value,result.result.value);
  const sixYears=dividendDiscount({dividend0:.0542,growthRates:[.011,...cjlu.dividendGrowthRates],
    discountRate:.065,terminalGrowth:.0125});
  assert.notEqual(sixYears.value.toFixed(3),'1.022');
});

test('WM terminal timing reproduces the worksheet and stays distinct from the conventional end-year value',()=>{
  const following=run({...wm,terminalTiming:'following_year'}).result;
  const conventional=run(wm).result;
  assert.equal(following.methodId,'dcf_terminal');
  assert.equal(following.value.toFixed(2),'230.98');
  assert.equal(conventional.value.toFixed(2),'247.00');
  assert.equal(following.inputs.terminalDiscountYear,11);
  assert.equal(conventional.inputs.terminalDiscountYear,10);
  assert.ok(Math.abs(following.inputs.terminalPresentValue*1.0705-conventional.inputs.terminalPresentValue)<1e-8);
  assert.equal(following.inputs.g3,undefined);
});

test('finite 10-year and 20-year projections do not invent a perpetuity',()=>{
  const inputs={fcf0:100,g1:0,g2:0,g3:0,discountRate:0,cash:20,debt:10,shares:10};
  const ten=discountedCashFlow({...inputs,years:10});
  const twenty=discountedCashFlow({...inputs,years:20});
  assert.equal(ten.value,101);
  assert.equal(twenty.value,201);
  assert.equal(ten.terminalPresentValue,0);
  assert.equal(ten.schedule.length,10);
  const result=run({method:'ocf',projection:'finite_10',g1:.16,g2:.15,discountRate:.066,
    baseFlow:38000,cash:60000,debt:0,shares:2800}).result;
  assert.equal(result.methodId,'ocf_10y');
  // Rounded narrated FB inputs do not reproduce the cited 238.99; retain
  // arithmetic for the actual inputs rather than fitting to that target.
  assert.equal(result.value.toFixed(2),'240.23');
});

test('forecast median is numeric for odd and even sets and does not mutate the supplied observations',()=>{
  const estimates=[.232,.207,.21,.283,.37];
  const result=run({method:'dcf',growthEstimates:estimates,growthSelection:'median'}).result;
  assert.equal(result.inputs.g1,.232);
  assert.deepEqual(estimates,[.232,.207,.21,.283,.37]);
  assert.equal(run({method:'dcf',growthEstimates:[.3,.1],growthSelection:'median'}).result.inputs.g1,.2);
});

test('SBC deduction and separately valued DNI assets have explicit amounts and fail when their basis is missing',()=>{
  const adjusted=run({method:'dcf',baseFlow:10000,stockBasedCompensation:1200,sbcFraction:.5,g1:.1}).result;
  assert.equal(adjusted.inputs.baseFlowBeforeAdjustment,10000);
  assert.equal(adjusted.inputs.baseFlow,9400);
  assert.equal(run({method:'ocf',sbcFraction:.5,g1:.1}).code,'sbc_basis_required');
  assert.equal(run({method:'dni',stockBasedCompensation:1200,sbcFraction:.5,g1:.1}).code,'sbc_basis_required');
  const regular=run({method:'dni',g1:.1}).result.value;
  assert.equal(run({method:'dni',g1:.1,additionalAssets:3900}).result.value-regular,39);
  assert.equal(run({method:'dcf',g1:.1,additionalAssets:3900}).code,'additional_asset_basis_required');
});

test('peer book and earnings multiples retain their own identities without ordinary-share guesses',()=>{
  const bare={instrument:{currency:'USD',type:'EQUITY'}};
  const peer=run({method:'peer_pb',bookValuePerShare:2.21,historicalMultiple:9.39},bare).result;
  assert.equal(peer.methodId,'peer_pb');
  assert.equal(peer.value.toFixed(2),'20.75');
  const earnings=run({method:'pe',earningsPerShare:3.75,historicalMultiple:9.02},bare).result;
  assert.equal(earnings.methodId,'earnings_multiple');
  assert.ok(Math.abs(earnings.value-33.825)<1e-12);
  assert.equal(run({method:'peer_pb',bookValuePerShare:2.21},bare).processing,'unavailable');
});

test('terminal models require a convergent dated forecast and comparison cannot confuse them with finite DCF',()=>{
  assert.equal(run({...wm,terminalGrowth:.0705}).code,'invalid_terminal_rate');
  assert.equal(run({...wm,g2:undefined}).code,'invalid_assumptions');
  const {g2,...missingStage2}=wm;
  assert.equal(run(missingStage2).code,'terminal_inputs_required');
  assert.equal(run({...cjlu,terminalGrowth:.065}).code,'invalid_terminal_rate');
  assert.equal(run({method:'ddm',dividendPerShare:.0542}).code,'dividend_forecast_required');
  assert.throws(()=>normalizeValuationSettings({dividendGrowthRates:[.01]}),/source and date/);
  assert.throws(()=>normalizeValuationSettings({...source,sbcFraction:1.01}),/between/);
  assert.throws(()=>dividendDiscount({dividend0:1,growthRates:[.01],discountRate:.04,terminalGrowth:.04}),/Invalid/);
  const result=run({...wm,terminalTiming:'following_year'}).result;
  const reference={present:true,asOf:day,currency:'USD',iv:{variants:[{key:'baseIV',methodId:'dcf_terminal',value:result.value}]}};
  const record={asOf:day,iv:{processing:'completed',result:{...result,pointInTimeVerified:true}},reference};
  assert.equal(compareResearch(record).iv.status,'matched');
  assert.equal(compareResearch(record,{...reference,iv:{variants:[{key:'baseIV',methodId:'dcf_20y',value:result.value}]}}).iv.status,'method_mismatch');
});

test('DDM editor converts the annual growth path and rates once before the normal worker request',async()=>{
  const state=[];let cursor=0;const calls=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat().filter(v=>v!=null)}),
    useEffect:()=>{},useState:initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;
      return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];}};
  const Editor=createValuationEditor(React);
  const props={row:{symbol:'EXAMPLE'},record:{},research:{request:async(...args)=>calls.push(args)}};
  const render=()=>{cursor=0;return Editor(props);};
  const find=(node,predicate)=>node&&typeof node==='object'?(predicate(node)?node:node.children.map(child=>find(child,predicate)).find(Boolean)):null;
  let tree=render();
  for(const [label,value] of [
    ['Valuation method','ddm'],['Annual dividend / DPU (listing currency)','.0542'],
    ['DDM forward DPU growth by year (%, comma-separated)','0.6, -2, 1.5, 2, 2'],
    ['Discount rate (%)','6.5'],['Perpetual terminal growth (%)','1.25'],
    ['Input source / scenario rationale','Dated source'],['Input date','2026-07-28'],
  ]){
    find(tree,n=>n.props['aria-label']===label+' for EXAMPLE').props.onChange({target:{value}});tree=render();
  }
  await find(tree,n=>n.type==='button'&&n.children.includes('Save inputs & recalculate')).props.onClick();
  assert.equal(calls.length,1);
  const valuation=calls[0][1].valuation;
  assert.deepEqual(valuation.dividendGrowthRates,[.006,-.02,.015,.02,.02]);
  assert.equal(valuation.discountRate,.065);
  assert.equal(run(valuation,{instrument:{currency:'SGD',type:'EQUITY'}}).result.value.toFixed(3),'1.022');
});
