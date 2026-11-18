import {isCashHolding} from './active-watchlist.js';
import {chooseStrategyCategory,categoryFor} from './strategy-categories.js?v=entry-sizing-20261114';
export const planAction=plan=>plan?.action??'buy';
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s));
export function planWatchlistAddition(state,{symbol,category,id}){
 symbol=String(symbol||'').trim().toUpperCase();
 if(!/^[A-Z0-9^][A-Z0-9.^=_-]{0,39}$/.test(symbol)||['CONSTRUCTOR','PROTOTYPE'].includes(symbol))throw Error('Enter a valid ticker.');
 if((state.holdings||[]).some(row=>isCashHolding(row)&&row.ticker===symbol))throw Error('This ticker is already in Cash Holdings. Set its category there.');
 if((state.watchlist||[]).some(w=>w.symbol===symbol))throw Error('This ticker is already in Watchlist.');
 // Preserve an existing category when tracking a ticker again.
 const selected=categoryFor(state.strategyCategories,symbol)||category;
 if(!['anchor','core','selective'].includes(selected))throw Error('Choose Anchor, Core or Selective.');
 const strategyCategories=chooseStrategyCategory(state.strategyCategories,symbol,selected);
 return {strategyCategories,watchlist:[...(state.watchlist||[]),{id,symbol,order:state.watchlist?.length||0,name:'',levelSource:'ak',iv:'',s1:'',s2:'',s3:'',s4:'',s5:'',refCost:'',notes:''}]};
}
export function validateResearchOverrides(values){
 const allowed=['iv','s1','s2','s3','s4','s5','refCost','priceCurrency','levelSource'];
 for(const [key,value]of Object.entries(values||{})){
  if(!allowed.includes(key))throw Error('Unknown plan research override.');
  if(value==='')continue;
  if(key==='levelSource'){if(!['ak','independent'].includes(value))throw Error('Choose AK sheets or independent reconstruction.');continue;}
  if(key==='priceCurrency'){if(!/^[A-Z]{3}$/.test(value))throw Error('Use a three-letter trading currency.');}
  else if(!(Number(value)>0)||!Number.isFinite(Number(value)))throw Error('Enter a positive '+key+' override, or clear it to follow research.');
 }
 return values;
}
export function nextHoldSupport(levels=[],skipKey){
 const index=levels.findIndex(level=>level.key===skipKey);
 if(index<0||levels.some((level,i)=>!Number.isFinite(level.price)||level.price<=0||(i>0&&level.price>=levels[i-1].price)))return null;
 return levels[index+1]??null;
}
export function saveActionPlan(previous,fields,company,{today,id}){
 validateResearchOverrides(fields.researchOverrides);
 const action=fields.action;
 if(!['sell','hold'].includes(action))throw Error('Choose Buy, Sell or Hold.');
 if(!date(fields.reviewedAt)||fields.reviewedAt>today)throw Error('Enter a valid review date, no later than today.');
 const plan={...previous,id:previous?.id||id,symbol:company.symbol,action,category:company.category||'',currency:company.currency||'',iv:company.iv>0?company.iv:null,reviewedAt:fields.reviewedAt,remarks:String(fields.remarks||'').slice(0,2000),stages:previous?.stages||[],archivedStages:previous?.archivedStages||[],researchOverrides:fields.researchOverrides||{}};
 delete plan.skipSupportKey;
 if(action==='hold'){
  if(!date(fields.revisitOn)||fields.revisitOn<=today)throw Error('Choose a Hold review date after today.');
  plan.revisitOn=fields.revisitOn;
  if(fields.skipSupportKey){
   if(!/^s[1-5]$/.test(fields.skipSupportKey)||!company.levels?.some(level=>level.key===fields.skipSupportKey))throw Error('Choose a support level available for this ticker.');
   plan.skipSupportKey=fields.skipSupportKey;
  }
 }else{
  const price=Number(fields.entry),quantity=Number(fields.quantity);
  if(!(price>0)||!Number.isFinite(price)||!Number.isInteger(quantity)||quantity<=0||quantity>company.shares)throw Error('Enter a positive sale price and a whole-share quantity within your current Cash holding.');
  if(!company.currency)throw Error('Confirm the trading currency for this sale.');
  plan.sale={price,quantity,completed:fields.saleCompleted===true};
 }
 return plan;
}
export function previewActionPlan(plan,company,{today,quoteFresh=false}){
 const action=planAction(plan);
 if(action==='hold'){
  const due=!date(plan.revisitOn)||plan.revisitOn<=today;
  const skipped=plan.skipSupportKey;
  const support=skipped&&company.currency&&plan.currency===company.currency?nextHoldSupport(company.levels,skipped):null;
  const close=Number(company.quote?.close);
  const distance=quoteFresh&&support&&close>0?(close-support.price)/support.price*100:null;
  const trigger=!skipped?null:due?'date':distance===null?null:distance<=0?'reached':distance<=5?'approaching':null;
  const reason=due?'Hold review is due. Reopen the plan and review the decision.'
   :trigger?'Review your Hold plan. '+support.key.toUpperCase()+(trigger==='reached'?' has been reached.':' is within 5% of the current price.')
   :support?'Watching '+support.key.toUpperCase()+' or the revisit date '+plan.revisitOn+', whichever comes first.'
   :'Hold until '+plan.revisitOn+'; no purchase or cash reservation.';
  return {status:due||trigger?'review':'hold',amount:0,reasons:[reason],holdSupport:support,holdTrigger:trigger,holdDistance:distance};
 }
 if(action==='sell'){
  if(plan.currency&&plan.currency!==company.currency)return {status:'review',amount:null,reasons:['Trading currency changed. Re-enter the sale price in the current listing currency and save the plan.']};
  const sale=plan.sale;
  if(sale?.completed)return {status:'hold',amount:0,reasons:['Sale marked completed. Import StocksCafe to update official holdings and cash.']};
  if(!(sale?.price>0)||!Number.isInteger(sale?.quantity)||sale.quantity<=0||sale.quantity>company.shares)return {status:'review',amount:null,reasons:['Review the sale quantity against the current imported Cash holding.']};
  return {status:'sell',amount:0,reasons:[company.quote?.close>=sale.price?'Sale price reached; review before selling.':'Monitor the planned sale price. Proceeds are conditional until the sale is executed and imported.']};
 }
 return {status:'review',amount:null,reasons:['Choose a valid Buy, Sell or Hold plan action.']};
}
export function potentialSale(plan,company){
 if(planAction(plan)!=='sell'||plan.sale?.completed||plan.currency&&plan.currency!==company.currency)return null;
 const {price,quantity}=plan.sale||{};
 if(!(price>0)||!Number.isFinite(price)||!Number.isInteger(quantity)||quantity<=0||quantity>company.shares)return null;
 const native=price*quantity,sgd=company.fx>0?native*company.fx:null;
 return {native,sgd,quantity,price};
}
