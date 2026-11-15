export const totalRecordedSpend=plan=>[...(plan.stages||[]),...(plan.archivedStages||[])].reduce((n,s)=>n+Number(s.spent||0),0);
export function remainingRedistribution(plan){return plan.redistribution?Math.max(0,plan.redistribution.budget-(totalRecordedSpend(plan)-plan.redistribution.spentAtReview)):Infinity;}
export function redistributeBudget(plan,{startKey,budget,room,base,hasPending=false,now}){
 if(hasPending)throw Error('Resolve pending orders for this company before redistributing its budget.');
 budget=Number(budget);room=Number(room);
 if(!Number.isFinite(budget)||budget<=0||!Number.isFinite(room)||budget>room+.001)throw Error('Enter a positive remaining budget within current room below the company ceiling.');
 const index=plan.stages.findIndex(s=>s.key===startKey);
 if(index<0||plan.stages[index].completed)throw Error('Choose an uncompleted approved starting support.');
 const eligible=plan.stages.map((s,i)=>({s,i})).filter(({s,i})=>i>=index&&!s.completed);
 const weights=eligible.map(({s,i})=>plan.category==='core'?(s.portfolioPct??[1.5,1.5,3][i]):1),sum=weights.reduce((n,v)=>n+v,0);
 if(!['anchor','core','selective'].includes(plan.category)||!eligible.length)throw Error('Choose a valid buying category and remaining supports.');
 const allowances=new Map();let left=Math.floor(budget*100)/100;
 eligible.forEach(({s,i},j)=>{
  let value;
  if(plan.category==='selective'){
   const pct=Number(plan.selectivePercents?.[i]??4);if(pct<2||pct>4||!(base>0))throw Error('Selective needs a valid 2–4% entry choice and portfolio base.');
   value=Math.floor(Math.min(budget,base*pct/100)*100)/100;
  }else{value=j===eligible.length-1?left:Math.floor(budget*weights[j]/sum*100)/100;left-=value;}
  allowances.set(s.key,value);
 });
 return {...plan,plannedEntryKey:startKey,redistribution:{startKey,budget,spentAtReview:totalRecordedSpend(plan),reviewedAt:now},stages:plan.stages.map((s,i)=>{
  if(s.completed)return {...s};
  const {purchaseBudget,purchaseQuantity,...rest}=s;
  return {...rest,budget:Number(s.spent||0)+(allowances.get(s.key)||0),skipped:i<index};
 })};
}
