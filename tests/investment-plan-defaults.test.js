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
 assert.equal(draft.feeReserve,0);assert.equal(draft.lotSize,1);assert.match(draft.budgetSource,/not a compulsory target/);
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
test('Core ceiling and 1.5/1.5/3 schedule prefill from the revised game plan',()=>{
 const draft=planDraft({...company,category:'core'},null,funding);
 assert.equal(draft.ceiling,6);assert.deepEqual(draft.stages.map(s=>s.portfolioPct),[1.5,1.5,3]);assert.deepEqual(draft.stages.map(s=>s.budget),[7500,7500,15000]);
 assert.ok(!draft.missing.some(s=>s.includes('company-specific')));
});
test('Selective shows the two deepest levels and the genuine 2–4% choice without selecting a percentage',()=>{
 const draft=planDraft({...company,category:'selective'},null,funding);
 assert.deepEqual(draft.stages.map(s=>s.key),['s4','s5']);assert.deepEqual(draft.selectivePercents,[4,4]);assert.deepEqual(draft.stages.map(s=>s.budget),[20000,20000]);
 const chosen=planDraft({...company,category:'selective'},null,funding,{ceiling:4,selectivePercents:[2,4]});
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

test('each category has an editable selected-SL budget with calculated shares and lots',async()=>{
 const {entryDraft}=await import('../assets/investment-plan-defaults.js');
 const current={...company,fx:1.3,quote:{close:95}};
 const f={base:500000,available:100000,byCompany:{EXAMPLE:0}};
 for(const category of ['anchor','core','selective']){
  const draft=planDraft({...current,category},null,f);
  const entry=entryDraft(draft,{...current,category},f);
  assert.ok(entry.requested>0);assert.ok(entry.units>0);assert.equal(entry.lots,entry.units);assert.ok(entry.spend<=entry.amount);assert.deepEqual(entry.issues,[]);
 }
 const core={...current,category:'core'},draft=planDraft(core,null,f);
 const sized=entryDraft(draft,core,f,{stageKey:'s4',budget:2400,increment:10});
 assert.equal(sized.units,20);assert.equal(sized.lots,2);assert.equal(sized.spend,2340);assert.equal(sized.entry,90);
 const whole=entryDraft(draft,core,f,{stageKey:'s4',budget:2400,increment:1});assert.equal(whole.units,20);
 assert.ok(entryDraft(draft,core,f,{stageKey:'s3',budget:9000}).issues.some(s=>s.includes('exceeds')));
 assert.equal(entryDraft(draft,core,f,{stageKey:'s3',budget:2000,increment:null}).units,null);
});
test('selected-SL sizing subtracts actual fills, keeps completed stages closed and respects company/cash limits',async()=>{
 const {entryDraft}=await import('../assets/investment-plan-defaults.js');
 const core={...company,category:'core',fx:1,quote:{close:95}},f={base:500000,available:1000,byCompany:{EXAMPLE:29500}};
 const draft=planDraft(core,null,f);draft.stages[0].spent=7000;
 let e=entryDraft(draft,core,f,{stageKey:'s3'});assert.equal(e.capacity,500);assert.equal(e.units,5);
 draft.stages[0].completed=true;e=entryDraft(draft,core,f,{stageKey:'s3'});assert.equal(e.capacity,0);assert.equal(e.units,0);
 const missing=entryDraft(planDraft(core,null,null),core,null);assert.equal(missing.amount,null);assert.equal(missing.units,null);
});
