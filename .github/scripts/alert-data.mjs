import {parseYahooChart} from './research-data.mjs';
import {calculateMarketContext} from '../../assets/market-context.js';
import {validSymbol} from './command-alerts.mjs';
const localDate=(time,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
async function requestJSON(url,fetchImpl){
  const r=await fetchImpl(url,{headers:{'User-Agent':'PersonalPortfolioAlerts https://github.com/alvissome/portfolio'},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok)throw Error('MARKET_DATA_UNAVAILABLE');
  return r.json();
}
export function parseAlertQuote(payload,symbol,{now=new Date()}={}){
  const result=payload?.chart?.result?.[0],meta=result?.meta;
  if(!meta||meta.symbol?.toUpperCase()!==symbol||meta.dataGranularity!=='1d'||!meta.exchangeTimezoneName||!meta.currency)throw Error('QUOTE_IDENTITY_UNVERIFIED');
  const time=Number(meta.regularMarketTime)*1000,price=meta.regularMarketPrice,date=localDate(time,meta.exchangeTimezoneName);
  if(!(time>0)||time>+now+60000||+now-time>=4*86400000||!(price>0)||!Number.isFinite(price))throw Error('QUOTE_NOT_CURRENT');
  const history=parseYahooChart(payload,symbol,{now});
  const previous=history.bars.filter(b=>b.date<date).at(-1);
  if(!previous)throw Error('PREVIOUS_CLOSE_MISSING');
  const splitDate=history.history.splitEvents.find(s=>s.date===date)?.date||null;
  return {symbol,currency:meta.currency,price,previousClose:previous.close,date,time,splitDate,
    session:time>=meta.currentTradingPeriod?.regular?.start*1000&&+now<meta.currentTradingPeriod?.regular?.end*1000?'regular session':'regular-session close',source:'Yahoo Finance regular-session quote; may be delayed'};
}
export async function fetchAlertQuote(symbol,{fetch:fetchImpl=globalThis.fetch,now=new Date()}={}){
  if(!validSymbol(symbol))throw Error('INVALID_ALERT_SYMBOL');
  return parseAlertQuote(await requestJSON('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=1mo&events=splits',fetchImpl),symbol,{now});
}
export async function fetchSPX({fetch:fetchImpl=globalThis.fetch,now=new Date()}={}){
  const payload=await requestJSON('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5y',fetchImpl);
  const history=parseYahooChart(payload,'^GSPC',{now});
  if(history.instrument.currency!=='USD'||history.instrument.type!=='INDEX')throw Error('SPX_IDENTITY_UNVERIFIED');
  return calculateMarketContext(history.bars,{checkedAt:now.toISOString()});
}
const decode=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>=0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|quot|apos|lt|gt);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[n]));
export function parseNews(xml,{now=new Date()}={}){
  if(typeof xml!=='string'||xml.length>1000000)throw Error('NEWS_UNAVAILABLE');
  if(!/<rss[\s>]/i.test(xml)||!/<channel[\s>]/i.test(xml))throw Error('NEWS_UNAVAILABLE');
  const seen=new Set(),items=[];
  for(const match of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)){
    const item=match[1],get=tag=>decode(item.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i'))?.[1]).trim();
    const title=get('title').replace(/<[^>]*>/g,'').slice(0,240),url=get('link'),published=get('pubDate'),time=Date.parse(published);
    let valid=false;try{const link=new URL(url);valid=link.protocol==='https:'&&!link.username&&!link.password;}catch{}
    if(!title||!valid||!Number.isFinite(time)||time>+now||+now-time>36*3600000||seen.has(url))continue;
    seen.add(url);items.push({title,url,publishedAt:new Date(time).toISOString(),source:'Yahoo Finance ticker news feed'});
  }
  return items.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,3);
}
export async function fetchAlertNews(symbol,{fetch:fetchImpl=globalThis.fetch,now=new Date()}={}){
  if(!validSymbol(symbol))throw Error('INVALID_ALERT_SYMBOL');
  try{
    const r=await fetchImpl('https://feeds.finance.yahoo.com/rss/2.0/headline?s='+encodeURIComponent(symbol)+'&region=US&lang=en-US',{signal:AbortSignal.timeout(12000),redirect:'error'});
    if(!r.ok)throw Error('NEWS_UNAVAILABLE');
    const items=parseNews(await r.text(),{now});
    return {items,status:items.length?'Recent ticker-related headlines; a cause for the price move has not been confirmed.':'No recent ticker-related headlines returned by the news feed; no cause confirmed.'};
  }catch{return {items:[],status:'News feed unavailable; no cause confirmed.'};}
}
