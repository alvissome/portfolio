import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planDraft,preferredPlanSymbol} from '../assets/investment-plan-defaults.js';
import {createPurchasePlan} from '../assets/investment-strategy.js';
const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
const company={symbol:'EXAMPLE',category:'anchor',currency:'USD',iv:150,levels};
const funding={base:500000,byCompany:{EXAMPLE:43000}};
test('Anchor draft prefills rule ceiling and editable maximum room, without inventing fee reserves',()=>{
 const draft=planDraft(company,null,funding);
 assert.equal(draft.ceiling,10);assert.equal(draft.room,7000);assert.equal(draft.addBudget,7000);
 assert.deepEqual(draft.stages.map(s=>s.budget),[1400,1400,1400,1400,1400]);
 assert.equal(draft.feeReserve,null);assert.equal(draft.lotSize,1);assert.match(draft.budgetSource,/not a compulsory target/);
});
test('Anchor ceiling room cannot become a purchase budget above the current ceiling',()=>{
 const draft=planDraft(company,null,{...funding,byCompany:{EXAMPLE:60000}});assert.equal(draft.room,0);assert.equal(draft.addBudget,0);
});
test('saved Anchor budgets and execution values prefill exactly, including explicit zero fees',()=>{
 const saved={...createPurchasePlan({...company,base:500000,ceilingPct:10,addBudget:4000,reviewedAt:'2026-11-14',id:'plan'}),feeReserve:0,lotSize:1};
 const draft=planDraft(company,saved,{base:1000000,byCompany:{EXAMPLE:43000}});
 assert.equal(draft.addBudget,4000);assert.equal(draft.ceiling,10);assert.equal(draft.feeReserve,0);
 assert.deepEqual(draft.stages.map(s=>s.budget),[800,800,800,800,800]);assert.ok(draft.stages.every(s=>s.frozen));
});
test('Core schedule prefills from game plan but requires a company-specific ceiling',()=>{
 const draft=planDraft({...company,category:'core'},null,funding);
 assert.equal(draft.ceiling,null);assert.deepEqual(draft.stages.map(s=>s.portfolioPct),[2.5,2.5,5]);assert.deepEqual(draft.stages.map(s=>s.budget),[12500,12500,25000]);
 assert.ok(draft.missing.some(s=>s.includes('company-specific')));
});
test('Selective shows the two deepest levels and the genuine 2–4% choice without selecting a percentage',()=>{
 const draft=planDraft({...company,category:'selective'},null,funding);
 assert.deepEqual(draft.stages.map(s=>s.key),['s4','s5']);assert.deepEqual(draft.selectivePercents,[null,null]);assert.deepEqual(draft.stages.map(s=>s.budget),[null,null]);
 const chosen=planDraft({...company,category:'selective'},null,funding,{ceiling:6,selectivePercents:[2,4],feeReserve:50});
 assert.deepEqual(chosen.stages.map(s=>s.budget),[10000,20000]);assert.ok(!chosen.missing.some(s=>s.includes('percentage')));
});
test('unknown non-US lot sizes stay blank; saved or listing-specific sizes are reused',()=>{
 const hk={...company,symbol:'9988.HK',currency:'HKD'};
 assert.equal(planDraft(hk,null,funding).lotSize,null);assert.equal(planDraft({...hk,lotSize:100},null,funding).lotSize,100);
 assert.equal(planDraft(hk,{lotSize:500,ceilingPct:10,category:'core',stages:[]},funding).lotSize,500);
});
test('missing market data does not appear as zero current holdings or invented stage budgets',()=>{
 const draft=planDraft(company,null,null);assert.equal(draft.base,null);assert.equal(draft.holding,null);assert.equal(draft.addBudget,null);assert.ok(draft.stages.every(s=>s.budget===null));
});
test('setup selects an Anchor by default and preserves an explicit company selection',()=>{
 const symbols=['SGX.SI','EXAMPLE','SECOND'],state={strategyCategories:{EXAMPLE:'anchor',SECOND:'core'}};
 assert.equal(preferredPlanSymbol(symbols,state,{}),'EXAMPLE');assert.equal(preferredPlanSymbol(symbols,state,{},'SECOND'),'SECOND');
 assert.equal(preferredPlanSymbol(symbols,state,{},'REMOVED'),'EXAMPLE');
});
test('desktop cards use three columns and holdings tools stay centred as one group',async()=>{
 const [cards,research,bundle]=await Promise.all(['assets/investment-panel.css','assets/research-panel.css','assets/index-CUEh86Kk.js'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')));
 assert.match(cards,/\.ic-card-list\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(cards,/@media\(max-width:1100px\).*grid-template-columns:repeat\(2/);
 assert.match(cards,/@media\(max-width:700px\).*\.ic-card-list\{grid-template-columns:1fr/);
 assert.match(research,/\.holdings-table-tools\{[^}]*margin-left:auto;margin-right:auto/);
 assert.match(bundle,/className:"holdings-table-tools",children:\[m.jsx\(ResearchViewSwitch/);
});
