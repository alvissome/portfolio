import {money} from './investment-format.js?v=compact-price-20261114';
export const NOTION_REVIEW_URL='https://app.notion.com/p/4188e1e2ba7f8072ae4fe3a29564a3ed';
export function recordPlanReview(config,plan,{id,now,holding=null,base=null,shares=0}){
 if(!id||config.decisions?.[id])throw Error('A unique review identity is required.');
 const sequence=(config.decisionSequence||0)+1;
 const record={id,sequence,symbol:plan.symbol,planId:plan.id,status:'plan-reviewed',updatedAt:now,
  redistribution:plan.redistribution??null,action:plan.action||'buy',revisitOn:plan.revisitOn||null,sale:plan.sale||null,note:String(plan.remarks||'').slice(0,2000),category:plan.category,ceilingPct:plan.ceilingPct??null,ruleVersion:plan.ruleVersion??null,
  reviewedAt:plan.reviewedAt,iv:plan.iv,currency:plan.currency,holding,base,shares,
  stages:plan.stages.map(s=>({skipped:s.skipped===true,key:s.key,price:s.price,budget:s.budget,purchaseBudget:s.purchaseBudget??s.budget,entryPrice:s.entryPrice??null,quantity:s.purchaseQuantity??null})),context:''};
 return {...config,decisionSequence:sequence,plans:{...config.plans,[plan.symbol]:plan},decisions:{...config.decisions,[id]:record}};
}
export function reviewText(review){
 if(review.action&&review.action!=='buy')return `${review.reviewedAt} — ${review.symbol} — ${review.action.toUpperCase()}\n${review.action==='hold'?'Revisit: '+review.revisitOn:'Sale: '+review.sale?.quantity+' shares at '+money(review.sale?.price,review.currency)+(review.sale?.completed?' (completed)':' (planned)')}\nDecision / remarks: ${review.note||'No remarks recorded.'}\nSaved: ${review.updatedAt}\nReview ID: ${review.id}`;
 const amount=n=>n==null?'Unavailable':money(n,'SGD');
 return `${review.reviewedAt} — ${review.symbol} — ${review.category}\nCompany ceiling: ${review.ceilingPct}%\nCurrent holding: ${review.shares} shares / ${amount(review.holding)}\nPortfolio base: ${amount(review.base)}\nReviewed IV: ${money(review.iv,review.currency)}\nEntry plan: ${review.stages.map(s=>`${s.key.toUpperCase()} ${money(s.entryPrice??s.price,review.currency)}${s.quantity!=null?`, ${s.quantity.toLocaleString('en-SG')} shares`:''}, planned ${amount(s.purchaseBudget??s.budget)} (stage maximum ${amount(s.budget)})`).join('; ')}\nDecision / remarks: ${review.note||'No remarks recorded.'}\nSaved: ${review.updatedAt}\nReview ID: ${review.id}`;
}

// A clipboard export only: copying never writes to Notion or changes portfolio data.
export function companyDecisionText(row,history=[]){
 const records=history.filter(d=>d.symbol===row.symbol).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||(b.sequence||0)-(a.sequence||0));
 const plan=row.plan;
 if(!plan)throw Error('No saved company plan to copy.');
 const reviewed=records.find(d=>d.status==='plan-reviewed');
 const snapshot=reviewed||{...plan,action:plan.action||'buy',note:plan.remarks||'',shares:row.shares,holding:row.currentHolding,base:row.portfolioBase,updatedAt:'Not recorded (legacy plan)',id:'Not recorded (legacy plan '+(plan.id||row.symbol)+')',stages:(plan.stages||[]).map(s=>({...s,quantity:s.purchaseQuantity}))};
 const sections=[reviewText(snapshot)];
 if((plan.stages||[]).length||(plan.archivedStages||[]).length){
  sections.push('Purchase stages and actual fills\n'+[...(plan.stages||[]).map(s=>({...s,archived:false})),...(plan.archivedStages||[]).map(s=>({...s,archived:true}))].map(s=>`${s.key.toUpperCase()}${s.archived?' (archived)':''}: ${s.completed?'Completed':s.skipped?'Skipped':'Open'}; stage budget ${money(s.budget,'SGD')}; cumulative actual spend ${money(s.spent||0,'SGD')}; actual fill date ${s.fillDate||'Not recorded'}`).join('\n'));
 }
 if(records.length)sections.push('Decision history and orders\n'+records.map(d=>`${d.updatedAt||d.reviewedAt||'Date unavailable'} — ${d.status}${d.action?' · '+d.action.toUpperCase():''}${d.stageKey?' · '+d.stageKey.toUpperCase():''}${d.reserved!=null?' · reserved '+money(d.reserved,'SGD'):''}${d.actualSpend!=null?' · actual spend '+money(d.actualSpend,'SGD'):''}${d.until?' · revisit '+d.until:''}${d.note?'\nRemarks: '+d.note:''}\nRecord ID: ${d.id}`).join('\n\n'));
 return sections.join('\n\n');
}
