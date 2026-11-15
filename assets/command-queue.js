import {RULE_VERSION} from './investment-strategy.js?v=redistribution-20261115';
export function companyCeiling(plan,category){
 const cap={anchor:10,core:6,selective:4}[category];
 return Math.min(Number(plan?.ceilingPct)>0?Number(plan.ceilingPct):Infinity,cap??Infinity);
}
// Presentation queue only: this never changes purchase eligibility or cash limits.
export function commandQueueState(row,{today,now}){
 const {plan,action,quote,iv,levels=[],category}=row;
 const checks=[];
 const add=(key,label,kind='action')=>checks.push({key,label,kind});
 const close=Number(quote?.close),priceKnown=Number.isFinite(close)&&close>0;
 const fresh=priceKnown&&!quote?.priceStale&&Number(quote?.timestamp)>0&&now-Number(quote.timestamp)<=4*86400000;
 const ceiling=companyCeiling(plan,category);
 const concentration=Number.isFinite(row.currentWeight)&&ceiling>0&&row.currentWeight>ceiling;
 const overIV=fresh&&iv>0&&close>iv;
 if(concentration)add('ceiling','Allocation above company ceiling');
 if(overIV)add('above-iv','Price above IV');
 if(!category)add('category','Category missing','data');
 if(!fresh)add('quote',priceKnown?'Quote needs refreshing':'Current price missing','data');
 if(!(iv>0))add('iv','IV unavailable','data');
 if(!levels.length)add('supports','Support ladder unavailable','data');
 if(!row.currency||!(row.fx>0))add('currency','Trading currency / FX unavailable','data');
 if(plan&&action==='hold'&&(!plan.revisitOn||plan.revisitOn<=today))add('hold-due','Hold review is due');
 if(plan&&action==='sell'&&row.result.status==='review')add('sale-review',row.result.reasons.join(' '));
 let planChanged=false;
 if(plan&&action==='buy'){
  const expected=category==='core'?levels.slice(-3):category==='selective'?levels.slice(-2):levels;
  planChanged=plan.category!==category||plan.ruleVersion!==RULE_VERSION||plan.iv!==iv||plan.currency!==row.currency||expected.length!==plan.stages.length||plan.stages.some((s,i)=>s.key!==expected[i]?.key||s.price!==expected[i]?.price);
  if(planChanged)add('plan-changed','Plan inputs changed: review category, IV or supports');
  const age=(Date.parse(today)-Date.parse(plan.reviewedAt))/86400000;
  if(!Number.isFinite(age)||age<0||age>31)add('plan-due','Thesis / IV review overdue');
  const selected=plan.stages.find(s=>s.key===plan.plannedEntryKey);
  const reached=plan.stages.filter(s=>!s.completed&&s.spent<s.budget&&fresh&&close<=Math.min(s.price,s.entryPrice??s.price)).at(-1);
  if(selected&&reached&&plan.stages.indexOf(reached)>plan.stages.indexOf(selected))add('next-stage','A deeper unused purchase stage is reached');
 }
 const reviewReasons=checks.filter(c=>c.kind==='action');
 const dataReasons=checks.filter(c=>c.kind==='data');
 const planSet=!!plan&&!reviewReasons.some(c=>!['ceiling','above-iv'].includes(c.key));
 const buyTrigger=fresh&&row.priceMet&&(!action||action==='buy');
 const saleTrigger=fresh&&action==='sell'&&row.sale&&close>=row.sale.price;
 const priceTriggered=!!(buyTrigger||saleTrigger);
 const suppressed=['deferred','dismissed'].includes(row.status);
 const openOpportunity=priceTriggered&&!planSet&&!suppressed&&!overIV&&!concentration&&(!(iv>0)||close<iv);
 const weights={ceiling:100,'above-iv':80,'hold-due':60,'next-stage':50,'plan-changed':40,'plan-due':30,'sale-review':60};
 const reviewPriority=Math.max(0,...reviewReasons.map(c=>weights[c.key]||0));
 const entry=action==='sell'?plan?.sale?.price:plan?.stages?.find(s=>s.key===plan.plannedEntryKey)?.entryPrice??row.support?.price;
 const distanceToEntry=fresh&&entry>0?(close-entry)/entry*100:null;
 return {reviewPriority,checks,reviewReasons,dataReasons,concentration,overIV,planChanged,planSet,priceTriggered,openOpportunity,distanceToEntry,ceiling,quoteFresh:fresh};
}
