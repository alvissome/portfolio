// Share purchase previews only. No orders, notifications or brokerage access.
import {STRATEGY_CATEGORIES} from './strategy-categories.js';
export const RULE_VERSION = '2026-11-14-ceilings-dynamic-selective';
const value = (n, label) => {
  if(n === null || n === undefined || String(n).trim() === '' || !Number.isFinite(Number(n))) throw Error('Missing or invalid '+label+'.');
  return Number(n);
};
const nonnegative = (n,label) => {n=value(n,label);if(n<0)throw Error(label+' cannot be negative.');return n;};
const positive = (n,label) => {n=value(n,label);if(n<=0)throw Error(label+' must be positive.');return n;};
const cents = n => Math.floor((n+1e-9)*100)/100;
export function fundingSignature(state) {
  return JSON.stringify({cash:state.cash,holdings:(state.holdings||[]).filter(h=>h.accountType==='Cash'&&!h.exited).map(h=>[h.ticker,h.shares,h.currency]).sort((a,b)=>a[0].localeCompare(b[0]))});
}
export function strategyFunding(state,settings={}, {displayOnly=false}={}) {
  let invested=0;
  const byCompany={},issues=[];
  for(const h of state.holdings||[]) {
    if(h.exited||h.accountType!=='Cash')continue;
    const quote=state.priceCache?.[h.ticker];
    try{
      if(quote?.priceStale){if(!displayOnly)throw Error('Sync stale prices for '+h.ticker+'.');issues.push('Stale price: '+h.ticker);}
      const close=positive(quote?.close??h.lastClose,h.ticker+' close');
      const fx=h.currency==='SGD'?1:positive(state.fxRates?.[h.currency],h.currency+' FX');
      const amount=nonnegative(h.shares,h.ticker+' quantity')*close*fx;
      if(byCompany[h.ticker]!==null)byCompany[h.ticker]=(byCompany[h.ticker]||0)+amount;
      invested+=amount;
    }catch(e){if(!displayOnly)throw e;issues.push(e.message);byCompany[h.ticker]=null;}

  }
  const broker=nonnegative(state.cash?.brokers,'broker cash');
  const bank=nonnegative(state.cash?.growth,'bank growth cash')+nonnegative(state.cash?.dividend,'bank dividend cash');
  const liabilities=nonnegative(settings.liabilities??0,'strategy liabilities');
  const pending=nonnegative(settings.pending??0,'pending orders');
  const committed=broker+bank;
  const base=invested+committed-liabilities;
  if(base<=0)throw Error('The strategy portfolio base must be positive.');
  return {issues,complete:!Object.values(byCompany).some(v=>v===null),invested,broker,bank,committed,liabilities,pending,base,available:Math.max(0,committed-liabilities-pending),byCompany,confirmed:settings.confirmed===true&&settings.basisSignature===fundingSignature(state)};
}
export function purchaseSchedule(category,levels,selectivePercents) {
  if(!Object.hasOwn(STRATEGY_CATEGORIES,category))throw Error('Choose a buying category in Holdings or Watchlist first.');
  if(!Array.isArray(levels)||!levels.length||levels.length>5)throw Error('Approve one to five support levels.');
  const sorted=levels.map(l=>({key:l.key,price:positive(l.price,'support')}));
  if(new Set(sorted.map(l=>l.key)).size!==sorted.length||sorted.some((l,i)=>!/^s[1-5]$/.test(l.key)||(i>0&&l.price>=sorted[i-1].price)))throw Error('Supports must have unique S1–S5 keys and descend in price.');
  if(category==='anchor')return sorted.map(l=>({...l,fraction:1/sorted.length}));
  const count=category==='core'?3:2;
  if(sorted.length<count)throw Error(category+' needs at least '+count+' approved supports.');
  let percents=[1.5,1.5,3];
  if(category==='selective'){
    if(selectivePercents===undefined)selectivePercents=[4,4];
    if(!Array.isArray(selectivePercents)||selectivePercents.length!==2)throw Error('Choose 2–4% for each Selective buy.');
    percents=selectivePercents.map(p=>positive(p,'Selective buy percentage'));
    if(percents.some(p=>p<2||p>4))throw Error('Each Selective buy must be 2–4%.');
  }
  return sorted.slice(-count).map((l,i)=>({...l,portfolioPct:percents[i]}));
}
export function createPurchasePlan({symbol,category,selectivePercents,levels,base,ceilingPct,addBudget,iv,currency,reviewedAt,id}) {
  if(!/^[A-Za-z0-9^][A-Za-z0-9.^=_-]{0,39}$/.test(symbol))throw Error('Invalid ticker.');
  if(!id)throw Error('A permanent plan ID is required.');
  if(/^CSPX(?:\.L)?$/.test(symbol))throw Error('CSPX remains review-only until its entry trigger and amount are defined.');
  const anchor=category==='anchor',cap={anchor:10,core:6,selective:4}[category],ceiling=positive(ceilingPct,'company ceiling');
  if(!cap||ceiling>cap)throw Error('Company ceiling cannot exceed the game plan: Anchor 10%, Core 6%, Selective 4%.');
  const budgetBase=positive(base,'portfolio base');
  const schedule=purchaseSchedule(category,levels,selectivePercents);
  const budget=anchor?nonnegative(addBudget,'intended addition budget'):null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)||!Number.isFinite(Date.parse(reviewedAt)))throw Error('Enter the thesis and IV review date.');
  if(!currency)throw Error('Confirm the trading currency.');
  return {id,symbol,ruleVersion:RULE_VERSION,category,...(category==='selective'?{selectivePercents:(selectivePercents??[4,4]).map(Number)}:{}),ceilingPct:ceiling,baseAtApproval:budgetBase,currency,iv:positive(iv,'IV'),reviewedAt,
    stages:schedule.map((l,i)=>({id:id+'-'+l.key,key:l.key,price:l.price,budget:cents(anchor?budget*l.fraction:budgetBase*l.portfolioPct/100),spent:0,completed:false,final:i===schedule.length-1}))};
}
export function reviewPurchasePlan(previous,fresh) {
  if(!previous)return fresh;
  if(previous.symbol!==fresh.symbol||previous.id!==fresh.id)throw Error('Plan identity cannot change during review.');
  const oldByKey=new Map([...(previous.archivedStages||[]),...previous.stages].map(s=>[s.key,s]));
  const sameSchedule=previous.category===fresh.category&&previous.ruleVersion===fresh.ruleVersion&&previous.stages.length===fresh.stages.length&&previous.stages.every((s,i)=>s.key===fresh.stages[i].key)&&JSON.stringify(previous.selectivePercents)===JSON.stringify(fresh.selectivePercents);
  const stages=fresh.stages.map(s=>{
    const old=oldByKey.get(s.key);
    if(!old)return s;
    return {...s,id:old.id,spent:old.spent,completed:old.completed,...(old.fillDate?{fillDate:old.fillDate}:{}),...(sameSchedule?{budget:old.budget}:{})};
  });
  const activeKeys=new Set(stages.map(s=>s.key));
  return {...fresh,...(sameSchedule?{baseAtApproval:previous.baseAtApproval}:{}),stages,
    archivedStages:[...oldByKey.values()].filter(s=>!activeKeys.has(s.key))};
}
export function recordStageFill(plan,stageId,{spent,completed,date}) {
  const stage=plan.stages.find(s=>s.id===stageId);
  if(!stage)throw Error('The purchase stage no longer exists.');
  const amount=nonnegative(spent,'cumulative actual spend');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('Enter the fill date.');
  if(amount<stage.spent||stage.completed&&!completed)throw Error('Recorded spend and completed stages cannot be reset.');
  return {...plan,stages:plan.stages.map(s=>s.id===stageId?{...s,spent:amount,completed:completed===true,fillDate:date}:s)};
}
export function previewPurchase(plan,funding,{close,fx,iv,reviewDate,today,lotSize=1,oddLots=false,rounding='down',priceStale=false,levelsChanged=false,category}={}) {
  const pending=reasons=>({status:'review',amount:null,reasons});
  const reasons=[];
  if(!Object.hasOwn(STRATEGY_CATEGORIES,category)||plan.category!==category||plan.ruleVersion!==RULE_VERSION)reasons.push('Buying category changed or is unassigned; review this plan.');
  if(!funding.confirmed)reasons.push('Confirm committed cash, liabilities and pending orders.');
  if(priceStale)reasons.push('Sync the current quote.');
  if(levelsChanged)reasons.push('Support levels changed; review this saved plan.');
  if(!(close>0))reasons.push('Current closing price is missing.');
  if(!(fx>0))reasons.push('Trading-currency FX is missing.');
  if(!(iv>0)||iv!==plan.iv)reasons.push('Review the current IV.');
  const age=(Date.parse(today)-Date.parse(reviewDate||plan.reviewedAt))/86400000;
  if(!Number.isFinite(age)||age<0||age>31)reasons.push('Thesis and IV review is overdue or invalid.');
  if(reasons.length)return pending(reasons);
  if(close>=iv)return {status:'paused',amount:0,reasons:['Price is at or above reviewed IV.']};
  const unused=plan.stages.filter(s=>!s.completed&&s.spent<s.budget);
  const stage=unused.filter(s=>close<=s.price).at(-1);
  if(!stage)return {status:'hold',amount:0,next:unused[0],reasons:['No unused support is currently eligible.']};
  const holding=funding.byCompany[plan.symbol]||0;
  const limits={stage:Math.max(0,stage.budget-stage.spent),ceiling:Math.max(0,funding.base*plan.ceilingPct/100-holding),cash:funding.available};
  const amount=cents(Math.min(...Object.values(limits)));
  const lot=positive(oddLots?1:lotSize,'lot size');
  if(!Number.isInteger(lot))throw Error('Lot size must be a whole number.');
  // The IV comparison is strict: an executable limit may not equal IV.
  const maxEntry=Math.min(stage.price,iv);
  const rawUnits=amount/(maxEntry*fx);
  // Round up only within all approved budgets and shared cash. Never breach a cap.
  const nearest=rounding==='nearest'?Math.round(rawUnits/lot)*lot:Math.floor(rawUnits/lot)*lot;
  const units=nearest*maxEntry*fx<=amount+1e-9?nearest:Math.floor(rawUnits/lot)*lot;
  const minimumAmount=plan.category==='selective'?Math.min(amount,Math.max(0,funding.base*.02-stage.spent)):amount;
  return {status:'eligible',stage,amount,minimumAmount,rawUnits,lot,portfolioPct:amount/funding.base*100,limits,limitedBy:Object.keys(limits).filter(k=>Math.abs(limits[k]-amount)<.011),maxEntry,strictIV:maxEntry===iv,units,
    estimatedSpend:units*maxEntry*fx,projectedWeight:(holding+units*maxEntry*fx)/funding.base*100,
    reasons:[...(plan.category==='selective'?['Reassess spending against uncommitted cash and competing opportunities. Choose a smaller amount or skip; the 4% company ceiling applies.']:[]),'At or below '+stage.key.toUpperCase()+'. Review before placing an order.',...(stage.final?['Recheck the thesis and IV before the final buy.']:[])]};
}
