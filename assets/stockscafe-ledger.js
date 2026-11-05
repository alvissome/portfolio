import {ACCOUNTS,accountForLabel,dateKey,flowValue,makeFlow,number,parseDelimited,stableId,todaySG} from './performance-core.js?v=ytd-20261105';

export async function readCashLedger(text) {
  const rows=parseDelimited(text);
  const header=rows.shift()?.map(value=>value.trim());
  const columns=['Type','Date (YYYY-MM-DD)','Currency','Amount','Details','Portfolio'];
  if(!columns.every(name=>header?.includes(name)))throw Error('Choose the StocksCafe cash transaction export.');
  const indexes=columns.map(name=>header.indexOf(name));
  const entries=[],counts=new Map();
  let excluded=0;
  const today=todaySG();
  for(const cells of rows){
    if(cells.every(cell=>!cell.trim()))continue;
    const [type,date,currency,rawAmount,note,portfolio]=indexes.map(index=>cells[index]?.trim()||'');
    const account=accountForLabel(portfolio);
    if(!account||!['DEPOSIT','WITHDRAW'].includes(type)){excluded++;continue;}
    if(dateKey(date)>today||!(/^[A-Z]{3}$/.test(currency)))throw Error('Invalid date or currency in the cash ledger.');
    const amount=Math.abs(number(rawAmount.replace(/,/g,'')));
    if(!amount){excluded++;continue;}
    const kind=type==='DEPOSIT'?'contribution':'withdrawal';
    const key=JSON.stringify([type,date,currency,amount,portfolio]);
    const occurrence=counts.get(key)||0;
    counts.set(key,occurrence+1);
    entries.push({id:await stableId('stockscafe-cash:'+key+'#'+occurrence),account,date,currency,amount,note,portfolio,kind});
  }
  return {entries,excluded};
}

function movementKey(account,date,signedAmount){
  return JSON.stringify([account,date,Math.round(signedAmount*100)]);
}

function latestReview(history,account){
  return Object.keys(history.settings?.cashLedgerReviewed?.[account]||{}).sort().at(-1);
}

export function ledgerReviewWindow(entries,history,from='') {
  if(from){dateKey(from);return entries.filter(entry=>entry.date>=from);}
  const yearStart=todaySG().slice(0,4)+'-01-01';
  const checkpoints=Object.fromEntries(ACCOUNTS.map(account=>[account,latestReview(history,account)]));
  return entries.filter(entry=>{
    const {account,date,id}=entry,checkpoint=checkpoints[account];
    if(checkpoint)return date>checkpoint||(date===checkpoint&&!history.settings.cashLedgerReviewed[account][date][id]);
    const coverage=history.coverage?.[account];
    const confirmed=coverage?.broker||(account==='cash'?null:coverage?.total);
    return confirmed?date>confirmed.end:date>=yearStart;
  });
}

export function reconcileLedgerEntries(entries,flows={}) {
  const manual=new Map();
  for(const flow of Object.values(flows)){
    if(flow.voided||flow.source==='stockscafe-cash')continue;
    const value=flowValue(flow,flow.account,'broker');
    if(!value)continue;
    const key=movementKey(flow.account,flow.date,value);
    manual.set(key,(manual.get(key)||0)+1);
  }
  const candidates=[];
  let existing=0;
  for(const entry of entries){
    if(Object.hasOwn(flows,entry.id)){existing++;continue;}
    const sgd=entry.sgd??(entry.currency==='SGD'?entry.amount:null);
    if(sgd!==null){
      const signed=entry.kind==='withdrawal'?-sgd:sgd;
      const key=movementKey(entry.account,entry.date,signed);
      const count=manual.get(key)||0;
      if(count){manual.set(key,count-1);existing++;continue;}
    }
    candidates.push(entry);
  }
  return {candidates,existing};
}

export function ledgerPatch(entries,selectedIds,history) {
  const {candidates,existing}=reconcileLedgerEntries(entries,history.flows);
  const flows={},capture={},cashLedgerReviewed={};
  for(const entry of candidates){
    if(!selectedIds.has(entry.id))continue;
    const amount=number(entry.sgd??(entry.currency==='SGD'?entry.amount:null));
    const flow=makeFlow({...entry,amount});
    flows[flow.id]={...flow,source:'stockscafe-cash'};
    if(history.settings?.capture?.[flow.account])capture[flow.account]={needsReconciliation:true};
  }
  const added=Object.keys(flows).length;
  const patch=added?{flows}:{};
  if(Object.keys(capture).length)patch.settings={capture};
  for(const account of ACCOUNTS){
    const accountEntries=entries.filter(entry=>entry.account===account);
    const date=accountEntries.map(entry=>entry.date).sort().at(-1);
    const previous=latestReview(history,account);
    if(!date||(previous&&date<previous))continue;
    const known=history.settings?.cashLedgerReviewed?.[account]?.[date];
    const seen=Object.fromEntries(accountEntries.filter(entry=>entry.date===date&&!known?.[entry.id]).map(entry=>[entry.id,true]));
    // Separate fields let overlapping reviews on the same day retain both sets of IDs.
    if(Object.keys(seen).length)cashLedgerReviewed[account]={[date]:seen};
  }
  const reviewed=Object.keys(cashLedgerReviewed).length>0;
  if(reviewed)patch.settings={...patch.settings,cashLedgerReviewed};
  return {patch,existing,added,reviewed};
}
