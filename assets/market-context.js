// Daily SPX context. Slope is a five-completed-session change, not a crossover.
export const MARKET_RULE_VERSION='spx-daily-slope5-v1';
export const SLOPE_SESSIONS=5;
export const MARKET_LABELS={bullish:'Bullish',bearish:'Bearish',bullish_pending:'Bullish alignment · awaiting slope',bearish_pending:'Bearish alignment · awaiting slope',mixed:'Mixed'};
export function sma(values,period){return values.map((_,i)=>i<period-1?null:values.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period);}
export function ema(values,period){
  let previous=null;
  return values.map((value,i)=>{if(i<period-1)return null;if(previous===null)previous=values.slice(0,period).reduce((a,b)=>a+b,0)/period;else previous=value*2/(period+1)+previous*(1-2/(period+1));return previous;});
}
function slope(series){const latest=series.at(-1),prior=series.at(-1-SLOPE_SESSIONS);return latest!=null&&prior>0?(latest/prior-1)*100:null;}
function alignment(fast,slow,fastSlope,slowSlope){
  if(fast>slow)return fastSlope>0&&slowSlope>0?'bullish':'bullish_pending';
  if(fast<slow)return fastSlope<0&&slowSlope<0?'bearish':'bearish_pending';
  return 'mixed';
}
export function calculateMarketContext(bars,{checkedAt=new Date().toISOString(),source='Yahoo Finance · SPX (^GSPC)'}={}){
  if(!Array.isArray(bars)||bars.length<260||bars.some((b,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!(b.close>0)||!Number.isFinite(b.close)||(i&&b.date<=bars[i-1].date)))throw Error('SPX_HISTORY_INCOMPLETE');
  const values=bars.map(b=>b.close),e20=ema(values,20),e40=ema(values,40),s50=sma(values,50),s150=sma(values,150),s200=sma(values,200);
  const average={ema20:e20.at(-1),ema40:e40.at(-1),sma50:s50.at(-1),sma150:s150.at(-1),sma200:s200.at(-1)};
  const slopes={ema20:slope(e20),ema40:slope(e40),sma50:slope(s50),sma150:slope(s150),sma200:slope(s200)};
  const close=values.at(-1),date=bars.at(-1).date;
  // Calendar 52 weeks, closing peaks; never silently describe this as intraday ATH.
  const cutoff=Date.parse(date)-364*86400000,window=bars.filter(b=>Date.parse(b.date)>=cutoff);
  const peak=window.reduce((a,b)=>b.close>=a.close?b:a);
  const long=close>average.sma200?(slopes.sma200>0?'bullish':'bullish_pending'):close<average.sma200?(slopes.sma200<0?'bearish':'bearish_pending'):'mixed';
  return {version:MARKET_RULE_VERSION,symbol:'^GSPC',name:'SPX',currency:'USD',date,checkedAt,source,close,average,slopes,
    short:alignment(average.ema20,average.ema40,slopes.ema20,slopes.ema40),
    medium:alignment(average.sma50,average.sma150,slopes.sma50,slopes.sma150),long,
    priceVs200:close>average.sma200?'above':close<average.sma200?'below':'equal',
    peak:{price:peak.close,date:peak.date,lookback:'52-week closing peak'},drawdownPct:Math.max(0,(1-close/peak.close)*100)};
}
export function marketContextFresh(context,now=Date.now()){
  return context?.version===MARKET_RULE_VERSION&&context.symbol==='^GSPC'&&Number.isFinite(context.close)&&context.close>0&&Number.isFinite(context.drawdownPct)&&context.peak?.price>0&&context.slopes&&MARKET_LABELS[context.short]&&MARKET_LABELS[context.medium]&&MARKET_LABELS[context.long]&&['above','below','equal'].includes(context.priceVs200)&&Date.parse(context.checkedAt)<=now+60000&&now-Date.parse(context.checkedAt)<30*3600000&&Date.parse(context.date)<=now&&now-Date.parse(context.date)<5*86400000;
}
export const marketSignature=c=>[c.short,c.medium,c.long,c.priceVs200].join('|');
export function marketText(context,now=Date.now()){
  if(!marketContextFresh(context,now))return 'SPX context unavailable or stale';
  return `SPX ${MARKET_LABELS[context.medium]} · short ${MARKET_LABELS[context.short].toLowerCase()} · 200 SMA: ${context.priceVs200}, ${context.slopes.sma200>0?'rising':context.slopes.sma200<0?'falling':'flat'} · ${context.drawdownPct.toFixed(1)}% below 52-week closing peak · ${context.date} close`;
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderMarketCallout(context,{now=Date.now()}={}){
  const fresh=marketContextFresh(context,now);
  return `<div class="ic-market-context ic-market-${fresh?context.medium:'unavailable'}" role="status" title="Daily completed SPX sessions. 20/40 EMA and 50/150 SMA need both slopes to confirm over five sessions. 200 SMA combines price position and its slope. Peak is the highest close over 52 weeks. These slope settings are implementation choices, not an exact reproduction of AK's discretionary judgment."><strong>Market context</strong><span>${esc(marketText(context,now))}</span></div>`;
}
