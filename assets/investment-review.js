import {money} from './investment-format.js?v=compact-price-20261114';
export const NOTION_REVIEW_URL='https://app.notion.com/p/4188e1e2ba7f8072ae4fe3a29564a3ed';
export function recordPlanReview(config,plan,{id,now,holding=null,base=null,shares=0}){
 if(!id||config.decisions?.[id])throw Error('A unique review identity is required.');
 const sequence=(config.decisionSequence||0)+1;
 const record={id,sequence,symbol:plan.symbol,planId:plan.id,status:'plan-reviewed',updatedAt:now,
  action:plan.action||'buy',revisitOn:plan.revisitOn||null,sale:plan.sale||null,note:String(plan.remarks||'').slice(0,2000),category:plan.category,ceilingPct:plan.ceilingPct??null,ruleVersion:plan.ruleVersion??null,
  reviewedAt:plan.reviewedAt,iv:plan.iv,currency:plan.currency,holding,base,shares,
  stages:plan.stages.map(s=>({key:s.key,price:s.price,budget:s.budget,purchaseBudget:s.purchaseBudget??s.budget,entryPrice:s.entryPrice??null,quantity:s.purchaseQuantity??null})),context:''};
 return {...config,decisionSequence:sequence,plans:{...config.plans,[plan.symbol]:plan},decisions:{...config.decisions,[id]:record}};
}
export function reviewText(review){
 if(review.action&&review.action!=='buy')return `${review.reviewedAt} — ${review.symbol} — ${review.action.toUpperCase()}\n${review.action==='hold'?'Revisit: '+review.revisitOn:'Sale: '+review.sale?.quantity+' shares at '+money(review.sale?.price,review.currency)+(review.sale?.completed?' (completed)':' (planned)')}\nDecision / remarks: ${review.note||'No remarks recorded.'}\nSaved: ${review.updatedAt}\nReview ID: ${review.id}`;
 const amount=n=>n==null?'Unavailable':money(n,'SGD');
 return `${review.reviewedAt} — ${review.symbol} — ${review.category}\nCompany ceiling: ${review.ceilingPct}%\nCurrent holding: ${review.shares} shares / ${amount(review.holding)}\nPortfolio base: ${amount(review.base)}\nReviewed IV: ${money(review.iv,review.currency)}\nEntry plan: ${review.stages.map(s=>`${s.key.toUpperCase()} ${money(s.entryPrice??s.price,review.currency)}${s.quantity!=null?`, ${s.quantity.toLocaleString('en-SG')} shares`:''}, planned ${amount(s.purchaseBudget??s.budget)} (stage maximum ${amount(s.budget)})`).join('; ')}\nDecision / remarks: ${review.note||'No remarks recorded.'}\nSaved: ${review.updatedAt}\nReview ID: ${review.id}`;
}
