import {purchaseSchedule,RULE_VERSION} from './investment-strategy.js?v=entry-sizing-20261114';
const number=value=>value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))?null:Number(value);
const cents=n=>Math.floor((n+1e-9)*100)/100;
const choose=(overrides,key,fallback)=>Object.hasOwn(overrides,key)?overrides[key]:fallback;
export function planDraft(company,saved,funding,overrides={}){
 const category=company.category,anchor=category==='anchor',selective=category==='selective';
 const base=funding?.complete===false?null:number(funding?.base),holding=funding?(Object.hasOwn(funding.byCompany||{},company.symbol)?number(funding.byCompany[company.symbol]):0):null;
 const savedCeiling=number(saved?.ceilingPct);
 const ceiling=number(choose(overrides,'ceiling',savedCeiling!==null&&savedCeiling<=({anchor:10,core:6,selective:4}[category]??0)?savedCeiling:({anchor:10,core:6,selective:4}[category]??null)));
 const room=base!==null&&ceiling!==null&&holding!==null?cents(Math.max(0,base*ceiling/100-holding)):null;
 const savedBudget=anchor&&saved?.category==='anchor'?cents(saved.stages.reduce((n,s)=>n+s.budget,0)):null;
 const addBudget=number(choose(overrides,'addBudget',anchor?savedBudget??room:null));
 const selectivePercents=choose(overrides,'selectivePercents',saved?.category==='selective'&&saved.ruleVersion===RULE_VERSION?saved.selectivePercents:[4,4])?.map(number)||[null,null];
 const feeReserve=0;
 const metadataLot=number(company.lotSize);
 const usSingleShare=company.currency==='USD'&&/^[A-Z][A-Z0-9]*(?:[.-][A-Z])?$/.test(company.symbol);
 const lotSize=number(choose(overrides,'lotSize',saved?.lotSize??(metadataLot>0&&Number.isInteger(metadataLot)?metadataLot:usSingleShare?1:null)));
 const missing=[];
 if(!category)missing.push('Choose a Category in Holdings or Watchlist.');
 if(ceiling===null)missing.push('Choose a category to prefill its company ceiling.');
 if(anchor&&addBudget===null)missing.push('Sync holding prices to calculate a draft addition budget, or enter the amount you intend to add.');
 if(selective&&selectivePercents.some(p=>p===null||p<2||p>4))missing.push('Choose each Selective buy percentage within 2–4%; the game plan does not pick exact percentages.');

 if(!(lotSize>0)||!Number.isInteger(lotSize))missing.push('Confirm the tradable lot size for this listing.');
 if(!(company.iv>0))missing.push('A current IV is missing.');
 if(!company.currency)missing.push('The trading currency is missing.');
 let stages=[],scheduleError='';
 try{
  const schedule=purchaseSchedule(category,company.levels,selective&&selectivePercents.some(p=>p===null)?[2,2]:selectivePercents);
  const samePercents=!selective||JSON.stringify(selectivePercents)===JSON.stringify(saved?.selectivePercents);
  const frozen=saved?.category===category&&saved.ruleVersion===RULE_VERSION&&samePercents&&saved.stages.length===schedule.length&&saved.stages.every((s,i)=>s.key===schedule[i].key);
  stages=schedule.map((stage,i)=>({...stage,portfolioPct:selective?selectivePercents[i]:stage.portfolioPct??null,
   budget:frozen?saved.stages[i].budget:anchor?(addBudget!==null?cents(addBudget/schedule.length):null):base!==null&&(!selective||selectivePercents[i]!==null)?cents(base*(selective?selectivePercents[i]:stage.portfolioPct)/100):null,
   spent:saved?.stages?.find(s=>s.key===stage.key)?.spent??0,completed:saved?.stages?.find(s=>s.key===stage.key)?.completed??false,purchaseBudget:saved?.stages?.find(s=>s.key===stage.key)?.purchaseBudget??null,frozen:!!frozen}));
 }catch(e){scheduleError=e.message;if(category)missing.push('Review the support ladder: '+e.message);}
 return {category,base,holding,ceiling,room,addBudget,selectivePercents,feeReserve,lotSize,stages,missing,scheduleError,
  budgetSource:savedBudget!==null?'Saved approved budget — unchanged by ordinary reviews':anchor?'Draft maximum room below the company ceiling — editable, not a compulsory target':selective?'Dynamic 2–4% spending range per entry, capped at 4% per company; reassess cash and competing opportunities':'Category schedule from the game plan',
  lotSource:saved?.lotSize!=null?'Saved approved lot size':metadataLot>0?'Listing metadata':usSingleShare?'US listing: whole-share estimate; confirm before approving':'Not specified'};
}
export function preferredPlanSymbol(symbols,state,plans,previous=''){
 if(symbols.includes(previous))return previous;
 return symbols.find(s=>state.strategyCategories?.[s]==='anchor')||symbols.find(s=>plans?.[s])||symbols.find(s=>state.strategyCategories?.[s])||symbols[0]||'';
}
// A stage budget is an independent proposal, not a cash reservation.
export function entryDraft(draft,company,funding,{stageKey,budget,increment=draft.lotSize}={}){
 const remaining=s=>Math.max(0,s.budget-(s.spent||0));
 const unused=draft.stages.filter(s=>!s.completed&&s.budget!==null&&remaining(s)>0);
 const stage=draft.stages.find(s=>s.key===stageKey)||unused.filter(s=>company.quote?.close>0&&company.quote.close<=s.price).at(-1)||unused[0]||draft.stages[0];
 if(!stage)return {stage:null,capacity:null,requested:null,amount:null,units:null,lots:null,spend:null,entry:null,increment:null,issues:['No approved support is available.']};
 const capacity=stage.budget!==null&&draft.room!==null&&funding?.available!=null?cents(Math.max(0,Math.min(stage.completed?0:remaining(stage),draft.room,funding.available))):null;
 const saved=stage.purchaseBudget==null?capacity:Math.max(0,stage.purchaseBudget-(stage.spent||0));
 const requested=number(budget)==null?capacity!==null?Math.min(saved??capacity,capacity):null:number(budget);
 const amount=requested!==null&&capacity!==null?Math.min(Math.max(0,requested),capacity):null;
 const lot=number(increment),fx=company.currency==='SGD'?1:number(company.fx),entry=company.iv>0?Math.min(stage.price,company.iv):null;
 const issues=[];
 if(capacity===null)issues.push('Complete current portfolio values to calculate the purchase budget.');
 if(requested!==null&&(requested<0||requested>capacity))issues.push('Purchase budget exceeds the remaining stage allowance, company room or available cash.');
 if(!(lot>0)||!Number.isInteger(lot))issues.push('Confirm the share increment for this order. Use 1 for whole-share orders.');
 if(!(fx>0))issues.push('Trading-currency FX is missing.');
 const units=amount!==null&&lot>0&&Number.isInteger(lot)&&fx>0&&entry>0?Math.floor((amount+1e-9)/(entry*fx*lot))*lot:null;
 return {stage,capacity,requested,amount,increment:lot,entry,fx,units,lots:units!==null?units/lot:null,spend:units!==null?units*entry*fx:null,issues};
}
