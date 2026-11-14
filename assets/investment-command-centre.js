import {categoryFor,normalizeStrategyCategories} from './strategy-categories.js?v=entry-sizing-20261114';
import {resolveWatchlistLevels} from './watchlist-levels.js';
import {RULE_VERSION,fundingSignature,strategyFunding,previewPurchase,recordStageFill} from './investment-strategy.js?v=compact-price-20261114';
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value));
const positive=n=>Number.isFinite(Number(n))&&Number(n)>0;
export function resolvedCompany(state,research,symbol){
  const rows=(state.watchlist||[]).filter(r=>r.symbol===symbol);
  if(rows.length>1)throw Error('Resolve duplicate watchlist rows for '+symbol+'.');
  const record=research?.records?.[symbol];
  const holding=(state.holdings||[]).find(h=>h.ticker===symbol&&h.accountType==='Cash'&&!h.exited);
  const row=rows[0]||{symbol};
  const resolved=resolveWatchlistLevels(row,record).row;
  return {symbol,shares:(state.holdings||[]).filter(h=>h.ticker===symbol&&h.accountType==='Cash'&&!h.exited).reduce((n,h)=>n+Number(h.shares||0),0),name:row.name||holding?.name||record?.instrument?.name||symbol,category:categoryFor(state.strategyCategories,symbol),
    currency:row.priceCurrency||holding?.currency||record?.instrument?.currency||'',lotSize:row.lotSize??holding?.lotSize??record?.instrument?.lotSize??null,iv:Number(resolved.iv),
    levels:['s1','s2','s3','s4','s5'].filter(k=>Number(resolved[k])>0).map(key=>({key,price:Number(resolved[key])})),fx:(row.priceCurrency||holding?.currency||record?.instrument?.currency)==='SGD'?1:state.fxRates?.[row.priceCurrency||holding?.currency||record?.instrument?.currency],quote:state.priceCache?.[symbol]};
}
export function currentUniverse(state){
  const map=new Map();
  for(const h of state.holdings||[])if(h.accountType==='Cash'&&!h.exited)map.set(h.ticker,{symbol:h.ticker,held:true,watchlisted:false});
  for(const w of state.watchlist||[])if(w.symbol){const row=map.get(w.symbol)||{symbol:w.symbol,held:false,watchlisted:false};row.watchlisted=true;map.set(w.symbol,row);}
  return [...map.values()];
}
export function reservedCash(config){
  return Object.values(config.decisions||{}).filter(d=>d.status==='ordered').reduce((sum,d)=>{
    if(!positive(d.reserved))throw Error('A pending order has an invalid cash reservation. Review its record.');
    return sum+Number(d.reserved);
  },0);
}
function expectedLevels(company){
  return company.category==='anchor'?company.levels:company.category==='core'?company.levels.slice(-3):company.category==='selective'?company.levels.slice(-2):[];
}
export function buildCommandCentre(state,research,config,{today,now=Date.now()}={}){
  if(!date(today))throw Error('A valid Singapore date is required.');
  const universe=currentUniverse(state),active=new Set(universe.map(r=>r.symbol)),decisions=Object.values(config.decisions||{});
  let funding=null,displayFunding=null,fundingError='',reserved=0;
  try{displayFunding=strategyFunding(state,{...config.funding,pending:Number(config.funding?.pending||0)+reservedCash(config)},{displayOnly:true});}catch(e){fundingError=e.message;}
  try{
    reserved=reservedCash(config);
    for(const h of state.holdings||[])if(h.accountType==='Cash'&&!h.exited){const timestamp=Number(state.priceCache?.[h.ticker]?.timestamp);if(!(timestamp>0)||now-timestamp>4*86400000)throw Error('Sync current holding prices for '+h.ticker+' before sizing the portfolio.');}
    funding=strategyFunding(state,{...config.funding,pending:Number(config.funding?.pending||0)+reserved});
  }catch(e){fundingError=e.message;}
  const rows=universe.map(item=>{
    const plan=config.plans?.[item.symbol];let company={symbol:item.symbol,name:item.symbol,levels:[]},result;
    const orders=decisions.filter(d=>d.symbol===item.symbol&&d.status==='ordered');
    try{
      company=resolvedCompany(state,research,item.symbol);
      const stale=company.quote?.priceStale||!company.quote?.timestamp||!Number.isFinite(Number(company.quote.timestamp))||now-Number(company.quote.timestamp)>4*86400000;
      const levels=expectedLevels(company);
      const levelsChanged=!!plan&&(levels.length!==plan.stages.length||plan.stages.some((s,i)=>levels[i]?.key!==s.key||levels[i]?.price!==s.price)||company.currency!==plan.currency);
      result=!plan?{status:'review',amount:null,reasons:[company.category?'Approve this company’s purchase plan.':'Choose Anchor, Core or Selective in Holdings or Watchlist.']}
        :!funding?{status:'review',amount:null,reasons:[fundingError]}
        :previewPurchase(plan,funding,{close:company.quote?.close,priceStale:stale,fx:company.currency==='SGD'?1:state.fxRates?.[company.currency],iv:company.iv,category:company.category,today,lotSize:plan.lotSize,oddLots:plan.oddLots,rounding:plan.rounding,levelsChanged});
      if(result.status==='eligible'&&(!(result.amount>0)||!(result.units>0)))result={...result,status:'review',amount:null,reasons:[result.amount>0?'The budget cannot fund one order increment. Review the budget and share increment.':'No purchase capacity remains under the company ceiling or available cash.']};
    }catch(e){result={status:'review',amount:null,reasons:[e.message]};}
    const levels=expectedLevels(company),eligible=levels.filter(l=>company.quote?.close>0&&company.quote.close<=Math.min(l.price,plan?.stages?.find(s=>s.key===l.key)?.entryPrice??l.price)).at(-1);
    const next=plan?.stages?.find(s=>!s.completed&&s.spent<s.budget);
    const support=result.stage||result.next||eligible||next||levels[0];
    const supportIndex=levels.findIndex(l=>l.key===support?.key),followingSupport=supportIndex>=0?levels[supportIndex+1]??null:null;
    // Ordinary price ticks do not erase a decision. Holdings, plan/IV/SL/category
    // changes and a different eligible stage do; all earlier records remain.
    const context=JSON.stringify({symbol:item.symbol,category:company.category,levels:company.levels,iv:company.iv,currency:company.currency,
      funding:{source:fundingSignature(state),liabilities:config.funding?.liabilities||0,externalPending:config.funding?.pending||0},rule:RULE_VERSION,plan:plan||null,stage:result.stage?.id||null});
    const history=decisions.filter(d=>d.symbol===item.symbol).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||(b.sequence||0)-(a.sequence||0));
    const decision=history.find(d=>d.context===context&&['deferred','dismissed','reviewed'].includes(d.status));
    let status=orders.length?'ordered':result.status;
    if(!orders.length&&decision?.status==='dismissed')status='dismissed';
    if(!orders.length&&decision?.status==='deferred'&&decision.until>today)status='deferred';
    const holdings=(state.holdings||[]).filter(h=>!h.exited&&h.accountType==='Cash'&&h.ticker===item.symbol);
    const shares=holdings.reduce((n,h)=>n+Number(h.shares||0),0);
    const currentHolding=displayFunding?(Object.hasOwn(displayFunding.byCompany,item.symbol)?displayFunding.byCompany[item.symbol]:0):null;
    const currentWeight=displayFunding?.complete&&currentHolding!==null?currentHolding/displayFunding.base*100:null;
    const concentration=!!plan&&currentWeight!==null&&currentWeight>plan.ceilingPct;
    return {...item,...company,fx:company.currency==='SGD'?1:state.fxRates?.[company.currency],plan,result,context,decision,orders,status,support,followingSupport,currentWeight,valuationPending:!!fundingError,currentHolding,shares,portfolioBase:displayFunding?.complete?displayFunding.base:null,concentration,priceMet:!!eligible,history,
      changedDecision:history.some(d=>d.context!==context&&['deferred','dismissed','reviewed'].includes(d.status))};
  });
  const archivedPlans=Object.values(config.plans||{}).filter(p=>!active.has(p.symbol));
  const history=decisions.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||(b.sequence||0)-(a.sequence||0)).map(d=>({...d,active:active.has(d.symbol),contextCurrent:rows.some(r=>r.symbol===d.symbol&&r.context===d.context)}));
  const visible=rows.filter(r=>!['dismissed','deferred'].includes(r.status));
  const inactiveCategories=Object.entries(normalizeStrategyCategories(state.strategyCategories)).filter(([symbol])=>!active.has(symbol)).map(([symbol])=>({symbol,category:'selective'}));
  return {rows,visible,history,archivedPlans,inactiveCategories,funding,displayFunding,fundingError,reserved,
    stats:{attention:visible.filter(r=>r.status==='review'||r.concentration).length,opportunities:visible.filter(r=>r.status==='eligible').length,
      pendingOrders:decisions.filter(d=>d.status==='ordered').length,decisions:decisions.length},
    totalSuggested:visible.filter(r=>r.status==='eligible').reduce((n,r)=>n+r.result.amount,0)};
}
export function addDecision(config,row,{kind,id,now,until,amount,note='',today=String(now||'').slice(0,10)}={}){
  if(!validId(id))throw Error('Invalid decision identity.');
  if(config.decisions?.[id])throw Error('This decision already exists.');
  if(!row?.symbol||!row.context||!['reviewed','deferred','dismissed','ordered'].includes(kind))throw Error('Invalid decision action.');
  if(row.orders?.length)throw Error('Reconcile the pending order before recording another action for this company.');
  if(!date(today))throw Error('Invalid decision date.');
  if(kind==='deferred'&&(!date(until)||until<=today))throw Error('Choose a defer date after today.');
  const sequence=(config.decisionSequence||0)+1;
  const record={id,sequence,symbol:row.symbol,planId:row.plan?.id||null,stageId:row.result.stage?.id||null,context:row.context,status:kind,updatedAt:now,note:String(note).slice(0,1000),
    category:row.category||'',stageKey:row.result.stage?.key||null,suggested:row.result.amount??null};
  if(kind==='deferred')record.until=until;
  if(kind==='ordered'){
    if(row.status!=='eligible'||!positive(amount)||Number(amount)>row.result.amount)throw Error('The pending order must fit the currently eligible purchase amount.');
    record.reserved=Number(amount);record.originalReserved=Number(amount);
    record.unitEstimate=Math.floor(Number(amount)/(row.result.maxEntry*(row.currency==='SGD'?1:row.fx)*row.result.lot)+1e-10)*row.result.lot;record.entryLimit=row.result.maxEntry;record.currency=row.currency;
  }
  return {...config,decisionSequence:sequence,decisions:{...config.decisions,[id]:record}};
}
export function settleOrder(config,id,{kind,spent,completed=false,date:fillDate,now,today=String(now||'').slice(0,10)}={}){
  const order=config.decisions?.[id];if(!order||order.status!=='ordered')throw Error('This pending order has already been reconciled.');
  if(!['cancelled','filled'].includes(kind))throw Error('Choose cancel or record final fill.');
  const next={...order,status:kind,reserved:0,updatedAt:now};
  let plans=config.plans,funding=config.funding;
  if(kind==='filled'){
    if(!positive(spent)||!date(fillDate)||fillDate>today)throw Error('Enter positive actual spend and a valid fill date.');
    const plan=plans?.[order.symbol];if(!plan||plan.id!==order.planId)throw Error('The original purchase plan must be recovered before recording this fill.');
    const active=plan.stages.find(s=>s.id===order.stageId),archived=plan.archivedStages?.find(s=>s.id===order.stageId),stage=active||archived;
    if(!stage)throw Error('The original purchase stage must be recovered before recording this fill.');
    const updated=recordStageFill({...plan,stages:[stage]},stage.id,{spent:stage.spent+Number(spent),completed:stage.completed||completed,date:fillDate}).stages[0];
    const changed={...plan,...(active?{stages:plan.stages.map(s=>s.id===stage.id?updated:s)}:{archivedStages:plan.archivedStages.map(s=>s.id===stage.id?updated:s)})};
    plans={...plans,[order.symbol]:changed};funding={...funding,confirmed:false};
    next.actualSpend=Number(spent);next.fillDate=fillDate;next.stageCompleted=updated.completed;
  }
  return {...config,plans,funding,decisions:{...config.decisions,[id]:next}};
}
