import test from 'node:test';
import assert from 'node:assert/strict';
import {redistributeBudget,remainingRedistribution} from '../assets/budget-redistribution.js';
import {createPurchasePlan,reviewPurchasePlan,recordStageFill,previewPurchase} from '../assets/investment-strategy.js';
import {planDraft,entryDraft} from '../assets/investment-plan-defaults.js';
const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
const make=category=>({...createPurchasePlan({symbol:'EXAMPLE',category,levels,base:100000,ceilingPct:{anchor:10,core:6,selective:4}[category],addBudget:10000,iv:200,currency:'USD',reviewedAt:'2026-11-15',id:'p'}),lotSize:1});
const run=(p,startKey,budget=6000)=>redistributeBudget(p,{startKey,budget,room:10000,base:100000,now:'2026-11-15'});
test('Anchor skips unfilled higher levels and splits the chosen remaining budget exactly',()=>{
 const p=make('anchor'),before=structuredClone(p),r=run(p,'s3',6000);assert.deepEqual(r.stages.map(s=>s.budget),[0,0,2000,2000,2000]);assert.equal(r.stages[0].skipped,true);assert.equal(r.stages[0].completed,false);assert.deepEqual(p,before);
 assert.deepEqual(run(p,'s2',6000).stages.map(s=>s.budget),[0,1500,1500,1500,1500]);
});
test('Core retains relative original weights across remaining stages and preserves partial/completed fills',()=>{
 const p=make('core');p.stages[0].spent=500;p.stages[0].completed=true;p.stages[1].spent=200;
 const r=run(p,'s4',5400);assert.equal(r.stages[0].spent,500);assert.equal(r.stages[0].completed,true);assert.equal(r.stages[1].budget,2000);assert.equal(r.stages[2].budget,3600);assert.equal(r.stages[1].spent,200);assert.equal(remainingRedistribution(r),5400);
 const reviewed=reviewPurchasePlan(r,make('core'));assert.equal(reviewed.redistribution.budget,5400);assert.equal(reviewed.stages[1].budget,2000);
});
test('Selective proposals remain independent but share one cumulative remaining budget',()=>{
 let r=run(make('selective'),'s4',3000);assert.deepEqual(r.stages.map(s=>s.budget),[3000,3000]);
 r=recordStageFill(r,r.stages[0].id,{spent:2000,date:'2026-11-15',completed:true});assert.equal(remainingRedistribution(r),1000);
 const f={base:100000,available:50000,confirmed:true,byCompany:{EXAMPLE:0}};
 const preview=previewPurchase(r,f,{close:79,iv:200,fx:1,category:'selective',today:'2026-11-15',lotSize:1});assert.equal(preview.amount,1000);
 const company={symbol:'EXAMPLE',category:'selective',levels,iv:200,currency:'USD',fx:1,quote:{close:79}};
 const draft=planDraft(company,r,f);assert.equal(entryDraft(draft,company,f,{stageKey:'s5',useStageAllowance:true}).capacity,1000);
});
test('redistribution requires positive capped budget, an eligible starting stage and no pending order',()=>{
 const p=make('anchor');for(const extra of [{hasPending:true},{budget:0},{budget:10001},{startKey:'s9'}])assert.throws(()=>redistributeBudget(p,{startKey:'s2',budget:6000,room:10000,base:100000,now:'2026-11-15',...extra}));
 p.stages[1].completed=true;assert.throws(()=>run(p,'s2'));
});
test('ordinary price changes and reviews do not reset the approved shared budget or create cash records',()=>{
 const p=run(make('anchor'),'s3',6000),r=recordStageFill(p,p.stages[2].id,{spent:1200,date:'2026-11-15',completed:false}),reviewed=reviewPurchasePlan(r,make('anchor'));
 assert.equal(remainingRedistribution(reviewed),4800);assert.equal(reviewed.stages[2].spent,1200);assert.equal(reviewed.cashUsage,undefined);assert.equal(reviewed.stages[0].budget,0);
});
