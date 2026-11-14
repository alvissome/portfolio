export const NOTION_REVIEW_URL='https://app.notion.com/p/4188e1e2ba7f8072ae4fe3a29564a3ed';
export function recordPlanReview(config,plan,{id,now,holding=null,base=null,shares=0}){
 if(!id||config.decisions?.[id])throw Error('A unique review identity is required.');
 const sequence=(config.decisionSequence||0)+1;
 const record={id,sequence,symbol:plan.symbol,planId:plan.id,status:'plan-reviewed',updatedAt:now,
  note:String(plan.remarks||'').slice(0,2000),category:plan.category,ceilingPct:plan.ceilingPct,ruleVersion:plan.ruleVersion,
  reviewedAt:plan.reviewedAt,iv:plan.iv,currency:plan.currency,holding,base,shares,
  stages:plan.stages.map(s=>({key:s.key,price:s.price,budget:s.budget})),context:''};
 return {...config,decisionSequence:sequence,plans:{...config.plans,[plan.symbol]:plan},decisions:{...config.decisions,[id]:record}};
}
export function reviewText(review){
 const amount=n=>n==null?'Unavailable':'SGD '+n.toLocaleString('en-SG',{maximumFractionDigits:2});
 return `${review.reviewedAt} — ${review.symbol} — ${review.category}\nCompany ceiling: ${review.ceilingPct}%\nCurrent holding: ${review.shares} shares / ${amount(review.holding)}\nPortfolio base: ${amount(review.base)}\nReviewed IV: ${review.currency} ${review.iv}\nEntry plan: ${review.stages.map(s=>`${s.key.toUpperCase()} ${review.currency} ${s.price}, maximum ${amount(s.budget)}`).join('; ')}\nDecision / remarks: ${review.note||'No remarks recorded.'}\nSaved: ${review.updatedAt}\nReview ID: ${review.id}`;
}
