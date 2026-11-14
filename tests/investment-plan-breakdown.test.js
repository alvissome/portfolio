import test from 'node:test';
import assert from 'node:assert/strict';
import {planDraft,entryDraft} from '../assets/investment-plan-defaults.js';
import {renderPlanBreakdown} from '../assets/investment-plan-breakdown.js';
const meta={symbol:'META',category:'anchor',currency:'USD',fx:829.34/644,iv:906.66,levels:[644,580,532,482].map((price,i)=>({key:'s'+(i+1),price})),quote:{close:642}};
const funding={base:883676.55,available:50000,byCompany:{META:82636.71}};
test('Anchor breakdown explains the total budget split, FX cost per share and rounded selected quantity',()=>{
 const draft=planDraft(meta,null,funding),selected=entryDraft(draft,meta,funding,{stageKey:'s1',useStageAllowance:true});
 const html=renderPlanBreakdown(draft,meta,funding,selected);
 assert.equal(draft.addBudget,5730.94);assert.equal(selected.maximumUnits,1);
 assert.match(html,/S\$5,730.94 split equally across 4 supports: S\$1,432.73 per support/);
 assert.match(html,/S1: S\$1,432.73 available ÷ approximately S\$829.34 per share = 1.73 shares → up to 1 after rounding to whole shares/);
 assert.equal((html.match(/data-support-allocation=/g)||[]).length,4);assert.match(html,/data-support-allocation="s1" data-selected="true"/);assert.match(html,/US\$644.00/);
});
test('Core and Selective show their own ladders and cap current room without implying summed Selective budgets',()=>{
 const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
 for(const category of ['core','selective']){
  const c={...meta,symbol:'XYZ',category,levels},f={base:100000,available:50000,byCompany:{XYZ:category==='core'?5900:3900}},d=planDraft(c,null,f);
  const selected=entryDraft(d,c,f,{stageKey:d.stages[0].key,useStageAllowance:true});const html=renderPlanBreakdown(d,c,f,selected);
  assert.equal(selected.capacity,100);assert.match(html,/S\$100.00/);assert.equal((html.match(/data-support-allocation=/g)||[]).length,category==='core'?3:2);
  if(category==='core'){assert.match(html,/1.5% \+ 1.5% \+ up to 3%/);assert.match(html,/S\$1,500.00/);}else assert.match(html,/4% ceiling applies across both supports/);
 }
});
test('selected entry/quantity edits appear in the explanation, and completed or missing values stay explicit',()=>{
 const d=planDraft(meta,null,funding);const selected=entryDraft(d,meta,funding,{stageKey:'s2',entryPrice:550,quantity:1,useStageAllowance:true});
 const html=renderPlanBreakdown(d,meta,funding,selected);assert.match(html,/US\$550.00/);assert.match(html,/Your selected quantity: 1/);assert.match(html,/data-support-allocation="s2" data-selected="true"/);
 const edge={...selected,capacity:199.99,entry:100,fx:1,increment:1,maximumUnits:1};assert.match(renderPlanBreakdown(d,meta,funding,edge),/just under 2 shares → up to 1/);
 d.stages[1].completed=true;const done=entryDraft(d,meta,funding,{stageKey:'s2',useStageAllowance:true});assert.match(renderPlanBreakdown(d,meta,funding,done),/S2 is completed/);
 const missing=planDraft(meta,null,null);const pending=entryDraft(missing,meta,null);assert.match(renderPlanBreakdown(missing,meta,null,pending),/needed to calculate shares/);
});
