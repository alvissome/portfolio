import {recordStageFill} from './investment-strategy.js?v=cc-cash-budget-20261114';
// CC planning deductions only. Never changes portfolio balances, holdings or cash flows.
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id);
export function cashImportBasis(state){
 const info=state.cashImportInfo?.brokers;
 return JSON.stringify({account:'Cash',importedAt:info?.importedAt??state.lastImportDate??null,brokerCash:Number(state.cash?.brokers??0)});
}
export function cashAllowance(config,state){
 const basis=cashImportBasis(state),entries=Object.values(config.cashUsage||{}).filter(e=>e.status==='unreconciled');
 const byCompany={};let spent=0;
 for(const e of entries){if(!(Number(e.amount)>0)||!Number.isFinite(Number(e.amount))||!e.symbol||!e.basis)throw Error('Review an invalid CC cash-use record before sizing.');spent+=Number(e.amount);byCompany[e.symbol]=(byCompany[e.symbol]||0)+Number(e.amount);}
 const all=Object.values(config.cashUsage||{});
 const legacyReviewRequired=config.cashTrackingVersion!==1&&(Object.values(config.decisions||{}).some(d=>d.status==='filled'&&!all.some(e=>e.orderId===d.id))||Object.values(config.plans||{}).some(p=>[...(p.archivedStages||[]),...(p.stages||[])].some(stage=>stage.spent-all.filter(e=>e.stageId===stage.id).reduce((n,e)=>n+Number(e.amount||0),0)>.009)));
 return {basis,entries,spent,byCompany,legacyReviewRequired,needsReconciliation:entries.some(e=>e.basis!==basis)};
}
export function recordCashUse(config,{id,symbol,amount,date,now,basis,stageId=null,orderId=null}){
 if(!validId(id)||config.cashUsage?.[id])throw Error('A unique cash-use identity is required.');
 if(!(Number(amount)>0)||!Number.isFinite(Number(amount))||!symbol||!basis)throw Error('Enter positive cash used and its current import basis.');
 const entry={id,symbol,amount:Number(amount),date,recordedAt:now,basis,stageId,orderId,status:'unreconciled',account:'Cash'};
 return {...config,cashUsage:{...config.cashUsage,[id]:entry}};
}
export function cashUseCanBeIncluded(entry,state){
 const importedAt=state.cashImportInfo?.brokers?.importedAt??state.lastImportDate;
 if(!importedAt||!Number.isFinite(Date.parse(importedAt))||state.cashImportInfo?.brokers?.source==='manual correction')return false;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(importedAt));
 return entry.date<=date;
}
export function recordStageCashFill(config,symbol,stageId,fill,{id,now,state}){
 const previous=config.plans[symbol],stage=previous?.stages.find(s=>s.id===stageId);
 if(!stage)throw Error('Purchase stage is missing.');
 const plan=recordStageFill(previous,stageId,fill),delta=Number(fill.spent)-stage.spent;
 const next={...config,plans:{...config.plans,[symbol]:plan}};
 return delta>0?recordCashUse(next,{id,symbol,amount:delta,date:fill.date,now,basis:cashImportBasis(state),stageId}):next;
}
export function reconcileCashUse(config,state,{includedIds=[],confirmed=false,now}){
 if(!confirmed)throw Error('Confirm which cash uses are reflected in the imported StocksCafe balance.');
 const current=cashAllowance(config,state),stale=current.entries.filter(e=>e.basis!==current.basis),allowed=new Set(current.entries.filter(e=>cashUseCanBeIncluded(e,state)).map(e=>e.id));
 if(!stale.length&&!includedIds.length)throw Error('Import a new StocksCafe cash balance before reconciling CC cash use.');
 if(includedIds.some(id=>!allowed.has(id)))throw Error('Only spending confirmed in a StocksCafe import dated on or after the fill can be cleared.');
 const included=new Set(includedIds),cashUsage={...config.cashUsage};
 for(const entry of current.entries.filter(e=>e.basis!==current.basis||included.has(e.id)))cashUsage[entry.id]={...entry,basis:current.basis,...(included.has(entry.id)?{status:'reflected',reconciledAt:now}:{carriedForwardAt:now})};
 return {...config,cashUsage};
}
