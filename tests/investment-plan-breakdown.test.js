import test from 'node:test';
import assert from 'node:assert/strict';
import {planDraft,entryDraft} from '../assets/investment-plan-defaults.js';
import {renderPlanBreakdown} from '../assets/investment-plan-breakdown.js';
const company={symbol:'EXAMPLE',category:'anchor',currency:'USD',fx:1.3,iv:900,levels:[600,550,500,450].map((price,i)=>({key:'s'+(i+1),price})),quote:{close:598}};
const funding={base:1000000,available:50000,byCompany:{EXAMPLE:94000}};
test('Anchor breakdown explains the total budget split, FX cost per share and rounded selected quantity',()=>{
 const draft=planDraft(company,null,funding),selected=entryDraft(draft,company,funding,{stageKey:'s1',useStageAllowance:true});
 const html=renderPlanBreakdown(draft,company,funding,selected);
 assert.equal(draft.addBudget,6000);assert.equal(selected.maximumUnits,1);
 assert.match(html,/S\$6,000.00 split equally across 4 supports: S\$1,500.00 per support/);
 assert.match(html,/S1: S\$1,500.00 available ÷ approximately S\$780.00 per share = 1.92 shares → up to 1 after rounding to whole shares/);
 assert.equal((html.match(/data-support-allocation=/g)||[]).length,4);assert.match(html,/data-support-allocation="s1" data-selected="true"/);assert.match(html,/US\$600.00/);
});
test('Core and Selective show their own ladders and cap current room without implying summed Selective budgets',()=>{
 const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
 for(const category of ['core','selective']){
  const c={...company,symbol:'XYZ',category,levels},f={base:100000,available:50000,byCompany:{XYZ:category==='core'?5900:3900}},d=planDraft(c,null,f);
  const selected=entryDraft(d,c,f,{stageKey:d.stages[0].key,useStageAllowance:true});const html=renderPlanBreakdown(d,c,f,selected);
  assert.equal(selected.capacity,100);assert.match(html,/S\$100.00/);assert.equal((html.match(/data-support-allocation=/g)||[]).length,category==='core'?3:2);
  if(category==='core'){assert.match(html,/1.5% \+ 1.5% \+ up to 3%/);assert.match(html,/S\$1,500.00/);}else assert.match(html,/4% ceiling applies across both supports/);
 }
});
test('selected entry/quantity edits appear in the explanation, and completed or missing values stay explicit',()=>{
 const d=planDraft(company,null,funding);const selected=entryDraft(d,company,funding,{stageKey:'s2',entryPrice:550,quantity:1,useStageAllowance:true});
 const html=renderPlanBreakdown(d,company,funding,selected);assert.match(html,/US\$550.00/);assert.match(html,/Your selected quantity: 1/);assert.match(html,/data-support-allocation="s2" data-selected="true"/);
 const edge={...selected,capacity:199.99,entry:100,fx:1,increment:1,maximumUnits:1};assert.match(renderPlanBreakdown(d,company,funding,edge),/just under 2 shares → up to 1/);
 d.stages[1].completed=true;const done=entryDraft(d,company,funding,{stageKey:'s2',useStageAllowance:true});assert.match(renderPlanBreakdown(d,company,funding,done),/S2 is completed/);
 const missing=planDraft(company,null,null);const pending=entryDraft(missing,company,null);assert.match(renderPlanBreakdown(missing,company,null,pending),/needed to calculate shares/);
});
