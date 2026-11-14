import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {money,amount} from '../assets/investment-format.js';
import {planDraft,entryDraft} from '../assets/investment-plan-defaults.js';
import {createPurchasePlan,previewPurchase,reviewPurchasePlan} from '../assets/investment-strategy.js';
import {renderPublicCommandCentre,renderCommandCentre} from '../assets/investment-command-view.js';
const levels=[120,110,100,90,80].map((price,i)=>({key:'s'+(i+1),price}));
const company={symbol:'XYZ',category:'core',currency:'USD',fx:1.3,iv:150,levels,quote:{close:95}};
const f={base:100000,available:50000,byCompany:{XYZ:0},confirmed:true};
const create=()=>createPurchasePlan({symbol:'XYZ',category:'core',levels,base:100000,ceilingPct:6,iv:150,currency:'USD',reviewedAt:'2026-11-14',id:'plan'});
test('prices and editable inputs use grouped currency values',()=>{
 assert.equal(money(12345.6,'USD'),'US$12,345.60');assert.equal(money(1234,'HKD'),'HK$1,234.00');assert.equal(money(1234,'SGD'),'S$1,234.00');
 for(const value of ['US$12,345.60','$12,345.60','12,345.60'])assert.equal(amount(value),12345.6);
 for(const value of ['-50','NaN','Infinity','abc',''])assert.equal(amount(value),null);
});
test('entry price drives quantity and an editable quantity drives market-currency and SGD spend',()=>{
 const draft=planDraft(company,null,f);
 const auto=entryDraft(draft,company,f,{stageKey:'s3',entryPrice:96});assert.equal(auto.units,12);assert.equal(auto.spend,12*96*1.3);
 const custom=entryDraft(draft,company,f,{stageKey:'s3',entryPrice:96,quantity:5});assert.equal(custom.units,5);assert.equal(custom.spend,624);
 assert.ok(entryDraft(draft,company,f,{stageKey:'s3',entryPrice:101}).issues.some(s=>s.includes('Entry price')));
 assert.ok(entryDraft(draft,company,f,{stageKey:'s3',entryPrice:96,quantity:99}).issues.some(s=>s.includes('Quantity')));
 const rounded=entryDraft(draft,company,f,{stageKey:'s3',entryPrice:96,quantity:7,increment:5});assert.equal(rounded.units,5);
});
test('saved custom entries control price eligibility and quantities without reopening fills on review',()=>{
 const p=create();p.stages[0]={...p.stages[0],entryPrice:96,purchaseQuantity:5,purchaseBudget:624};
 const preview=close=>previewPurchase(p,f,{close,fx:1.3,iv:150,category:'core',today:'2026-11-14',lotSize:1});
 assert.equal(preview(97).status,'hold');const ready=preview(95);assert.equal(ready.stage.key,'s3');assert.equal(ready.maxEntry,96);assert.equal(ready.units,5);assert.equal(ready.estimatedSpend,624);
 const reviewed=reviewPurchasePlan(p,create());assert.equal(reviewed.stages[0].entryPrice,96);assert.equal(reviewed.stages[0].purchaseQuantity,5);
});
test('privacy renders only public research and omits private values, notes, plans and decision controls',()=>{
 const row={symbol:'XYZ',name:'Example',category:'core',currency:'USD',levels,quote:{close:95},iv:150,shares:876543,currentHolding:123456.78,currentWeight:42,portfolioBase:9876543,plan:{remarks:'PRIVATE NOTE'},orders:[{reserved:334455}],result:{amount:776655}};
 const html=renderPublicCommandCentre({rows:[row]});assert.match(html,/US\$95.00/);assert.match(html,/US\$150.00/);assert.match(html,/US\$100.00/);
 for(const hidden of ['876543','123456.78','9876543','PRIVATE NOTE','334455','776655','data-plan','data-decision-form','Allocation / ceiling'])assert.ok(!html.includes(hidden),hidden);
 assert.match(html,/data-public-opportunity="XYZ"/);
});
test('Plan/data checks explain their scope instead of implying a moat alert',()=>{
 const html=renderCommandCentre({rows:[],visible:[],history:[],archivedPlans:[],stats:{},funding:null},{show:String,today:'2026-11-14',filter:'attention'});
 assert.match(html,/Plan\/data checks/);assert.match(html,/do not detect business deterioration or moat changes/);assert.doesNotMatch(html,/Needs attention/);
});
test('desktop form has six columns, two default control rows and optional settings',async()=>{
 const [css,source]=await Promise.all(['investment-panel.css','investment-panel.js'].map(p=>readFile(new URL('../assets/'+p,import.meta.url),'utf8')));
 assert.match(css,/form\.ic-compact-plan\{grid-template-columns:repeat\(6/);assert.match(css,/ic-plan-remarks-field textarea\{min-height:36px;height:36px/);
 assert.match(source,/rows="1"/);assert.match(source,/field\('quantity'/);assert.match(source,/data-native-estimate/);assert.match(source,/data-sgd-estimate/);assert.match(source,/class="ic-plan-settings"/);
 assert.doesNotMatch(source,/Calculated lots|Purchase budget for this SL/);
});

test('revising a price-led plan can resize within its game-plan allowance and retain precise FX quantities',()=>{
 const p=create();p.stages[0]={...p.stages[0],entryPrice:96,purchaseQuantity:5,purchaseBudget:624};
 const draft=planDraft(company,p,f);
 const saved=entryDraft(draft,company,f,{stageKey:'s3',entryPrice:96,useStageAllowance:true});assert.equal(saved.units,5);
 const resized=entryDraft(draft,company,f,{stageKey:'s3',entryPrice:96,quantity:8,useStageAllowance:true});assert.equal(resized.units,8);assert.deepEqual(resized.issues,[]);
 const fx=1.312345,spend=5*96*fx;p.stages[0].purchaseBudget=Math.ceil((spend-1e-9)*100)/100;
 const ready=previewPurchase(p,f,{close:95,fx,iv:150,category:'core',today:'2026-11-14',lotSize:1});assert.equal(ready.units,5);assert.ok(ready.estimatedSpend<=ready.amount);
});
