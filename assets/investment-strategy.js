// Share purchase previews only. No orders, notifications or brokerage access.
export const CORE_COMPANIES = Object.freeze(['GOOGL','META','AMZN','MSFT','NVDA','SPGI']);
export const RULE_VERSION = '2026-11-13';
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
export function strategyFunding(state,settings={}) {
  let invested=0;
  const byCompany={};
  for(const h of state.holdings||[]) {
    if(h.exited||h.accountType!=='Cash')continue;
    const quote=state.priceCache?.[h.ticker];
    if(quote?.priceStale)throw Error('Sync stale prices for '+h.ticker+'.');
    const close=positive(quote?.close,h.ticker+' close');
    const fx=h.currency==='SGD'?1:positive(state.fxRates?.[h.currency],h.currency+' FX');
    const amount=nonnegative(h.shares,h.ticker+' quantity')*close*fx;
    byCompany[h.ticker]=(byCompany[h.ticker]||0)+amount;invested+=amount;
  }
  const broker=nonnegative(state.cash?.brokers,'broker cash');
  const bank=nonnegative(state.cash?.growth,'bank growth cash')+nonnegative(state.cash?.dividend,'bank dividend cash');
  const liabilities=nonnegative(settings.liabilities??0,'strategy liabilities');
  const pending=nonnegative(settings.pending??0,'pending orders');
  const committed=broker+bank;
  const base=invested+committed-liabilities;
  if(base<=0)throw Error('The strategy portfolio base must be positive.');
  return {invested,broker,bank,committed,liabilities,pending,base,available:Math.max(0,committed-liabilities-pending),byCompany,confirmed:settings.confirmed===true&&settings.basisSignature===fundingSignature(state)};
}
export function purchaseSchedule(symbol,levels) {
  if(!Array.isArray(levels)||!levels.length||levels.length>5)throw Error('Approve one to five support levels.');
  const sorted=levels.map(l=>({key:l.key,price:positive(l.price,'support')}));
  if(new Set(sorted.map(l=>l.key)).size!==sorted.length||sorted.some((l,i)=>!/^s[1-5]$/.test(l.key)||(i>0&&l.price>=sorted[i-1].price)))throw Error('Supports must have unique S1–S5 keys and descend in price.');
  if(CORE_COMPANIES.includes(symbol))return sorted.map(l=>({...l,fraction:1/sorted.length}));
  if(sorted.length<3)throw Error('Other companies need at least three approved supports.');
  return sorted.slice(-3).map((l,i)=>({...l,portfolioPct:[2.5,2.5,5][i]}));
}
export function createPurchasePlan({symbol,levels,base,ceilingPct,addBudget,iv,currency,reviewedAt,id}) {
  if(!/^[A-Za-z0-9^][A-Za-z0-9.^=_-]{0,39}$/.test(symbol))throw Error('Invalid ticker.');
  if(!id)throw Error('A permanent plan ID is required.');
  if(/^CSPX(?:\.L)?$/.test(symbol))throw Error('CSPX remains review-only until its entry trigger and amount are defined.');
  const core=CORE_COMPANIES.includes(symbol),ceiling=positive(ceilingPct,'company ceiling');
  if(ceiling>100||(core&&ceiling>10))throw Error('Core ceilings cannot exceed 10%; other ceilings cannot exceed 100%.');
  const budgetBase=positive(base,'portfolio base');
  const schedule=purchaseSchedule(symbol,levels);
  const budget=core?nonnegative(addBudget,'intended addition budget'):null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)||!Number.isFinite(Date.parse(reviewedAt)))throw Error('Enter the thesis and IV review date.');
  if(!currency)throw Error('Confirm the trading currency.');
  return {id,symbol,ruleVersion:RULE_VERSION,bucket:core?'core':'other',ceilingPct:ceiling,baseAtApproval:budgetBase,currency,iv:positive(iv,'IV'),reviewedAt,
    stages:schedule.map((l,i)=>({id:id+'-'+l.key,key:l.key,price:l.price,budget:cents(core?budget*l.fraction:budgetBase*l.portfolioPct/100),spent:0,completed:false,final:i===schedule.length-1}))};
}
export function recordStageFill(plan,stageId,{spent,completed,date}) {
  const stage=plan.stages.find(s=>s.id===stageId);
  if(!stage)throw Error('The purchase stage no longer exists.');
  const amount=nonnegative(spent,'cumulative actual spend');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('Enter the fill date.');
  if(amount<stage.spent||stage.completed&&!completed)throw Error('Recorded spend and completed stages cannot be reset.');
  return {...plan,stages:plan.stages.map(s=>s.id===stageId?{...s,spent:amount,completed:completed===true,fillDate:date}:s)};
}
export function previewPurchase(plan,funding,{close,fx,iv,reviewDate,today,feeReserve=0,lotSize=1,priceStale=false,levelsChanged=false}={}) {
  const pending=reasons=>({status:'review',amount:null,reasons});
  const reasons=[];
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
  const reserve=nonnegative(feeReserve,'fees and FX reserve'),lot=positive(lotSize,'lot size');
  if(!Number.isInteger(lot))throw Error('Lot size must be a whole number.');
  // The IV comparison is strict: an executable limit may not equal IV.
  const maxEntry=Math.min(stage.price,iv);
  const units=Math.floor(Math.max(0,amount-reserve)/(maxEntry*fx*lot))*lot;
  return {status:'eligible',stage,amount,portfolioPct:amount/funding.base*100,limits,limitedBy:Object.keys(limits).filter(k=>Math.abs(limits[k]-amount)<.011),maxEntry,strictIV:maxEntry===iv,units,
    estimatedSpend:units*maxEntry*fx,projectedWeight:(holding+units*maxEntry*fx)/funding.base*100,
    reasons:['At or below '+stage.key.toUpperCase()+'. Review before placing an order.',...(stage.final?['Recheck the thesis and IV before the final buy.']:[])]};
}
