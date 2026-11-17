import {currentUniverse,resolvedCompany} from '../../assets/investment-command-centre.js';
import {marketContextFresh,marketSignature} from '../../assets/market-context.js';
export const ALERT_VERSION='cc-alerts-v1';
export const APPROACH_PERCENT=5;
export const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9][A-Z0-9.^=-]{0,29}$/.test(s)&&!['constructor','prototype','__proto__'].includes(s);
export function alertUniverse(data,strategy){
  const stored=Array.isArray(data.holdings)?data.holdings:Object.values(data.holdings||{});
  const holdings=stored.length?stored:Object.entries(data.classifications||{}).map(([ticker,fields])=>({...fields,ticker}));
  const state={...data,holdings},research={records:data.researchBySecurity||{}};
  return currentUniverse(state).filter(r=>validSymbol(r.symbol)).map(item=>{
    try{
      const plan=strategy.plans?.[item.symbol],company=resolvedCompany(state,research,item.symbol,plan);
      // Exactly the same overrides and listing/currency resolution as CC. No
      // portfolio sizing, cost, remarks, balances or quantities leave the worker.
      const levels=company.levels.filter(l=>l.price>0&&Number.isFinite(l.price));
      if(levels.some((l,i)=>i&&l.price>=levels[i-1].price))return {...item,currency:company.currency,levels:[],warning:'Support ladder is not descending'};
      return {...item,currency:company.currency,levels,planAction:plan?.action||null,
        completed:plan?.action==='buy'||!plan?.action?plan?.stages?.filter(s=>s.completed).map(s=>({key:s.key,price:s.price}))||[]:[]};
    }catch{return {...item,levels:[],currency:'',warning:'CC support inputs need review'};}
  });
}
export function quoteFresh(quote,now=Date.now()){
  return quote?.price>0&&Number.isFinite(quote.price)&&quote.previousClose>0&&Number.isFinite(quote.previousClose)&&
    /^\d{4}-\d{2}-\d{2}$/.test(quote.date)&&quote.time>0&&quote.time<=now+60000&&now-quote.time<4*86400000;
}
export const levelKey=(currency,price)=>`${currency}:${Number(price).toPrecision(14)}`;
export function evaluateTicker(item,quote,previous={},now=Date.now()){
  if(!quoteFresh(quote,now)||!item.currency||quote.currency!==item.currency)return {state:previous,events:[],skipped:'Quote missing, stale or currency differs'};
  const state={...previous,version:ALERT_VERSION,levels:{...previous.levels},lastQuote:{price:quote.price,date:quote.date,time:quote.time},updatedAt:new Date(now).toISOString()};
  const events=[],hits=[],near=[];
  const ladderSignature=JSON.stringify(item.levels.map(l=>l.price));
  if(quote.splitDate===quote.date)state.splitLadder=ladderSignature;
  if(state.splitLadder&&state.splitLadder!==ladderSignature)delete state.splitLadder;
  const levelOnlySkipped=!!state.splitLadder;
  for(const level of item.levels){
    const id=levelKey(item.currency,level.price),prior=state.levels[id];
    // First observation below a level is a baseline, never a fabricated crossing.
    if(!prior&&quote.price<=level.price){state.levels[id]={hit:true,approach:true,baseline:true};continue;}
    const row=state.levels[id]={hit:false,approach:false,...prior};
    if(levelOnlySkipped)continue;
    if(quote.price<=level.price&&!row.hit){hits.push({...level});row.hit=true;row.approach=true;}
    else if(quote.price>level.price&&quote.price<=level.price*(1+APPROACH_PERCENT/100)&&!row.hit&&!row.approach)near.push({...level});
  }
  if(hits.length)events.push({type:'support_hit',symbol:item.symbol,currency:item.currency,levels:hits,quote});
  // Nearest unbreached support only. Gap-through hits and a deeper approach can
  // share one email; there is no approach event for a support that was hit.
  const nearest=near.sort((a,b)=>b.price-a.price)[0];
  if(nearest){state.levels[levelKey(item.currency,nearest.price)].approach=true;events.push({type:'support_approach',symbol:item.symbol,currency:item.currency,levels:[nearest],distancePct:(quote.price/nearest.price-1)*100,quote});}
  const dropPct=(quote.price/quote.previousClose-1)*100;
  const previousDrop=state.drop?.date===quote.date?state.drop.tier:0;
  const tier=dropPct<-5-1e-9?5:dropPct<-3-1e-9?3:0;
  // Baseline daily-drop observations are still useful; emit today's largest tier
  // once. A later 5% escalation is a new event; recoveries never re-arm the day.
  if(tier>previousDrop&&quote.splitDate!==quote.date){events.push({type:'daily_drop',symbol:item.symbol,currency:item.currency,tier,dropPct,quote});state.drop={date:quote.date,tier};}
  return {state,events,skipped:levelOnlySkipped?'Support ladder needs review after a split':null};
}
export function evaluateMarket(context,previous={},now=Date.now()){
  if(!marketContextFresh(context,now))return {state:previous,events:[],skipped:true};
  const signature=marketSignature(context),events=[];
  if(previous.signature&&previous.version===context.version&&previous.signature!==signature)events.push({type:'market_trend',symbol:'SPX',before:previous.signature,context});
  return {state:{version:context.version,signature,date:context.date},events};
}
