import {marketText,MARKET_LABELS,marketContextFresh} from '../../assets/market-context.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Number(n).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=t=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(t))+' SGT';
const labels={market_trend:'SPX trend changed',support_approach:'Approaching support',support_hit:'New support reached',daily_drop:'Large daily drop'};
const appURL='https://alvissome.github.io/portfolio/#/';
const levels=e=>(e.levels||[]).map(l=>l.key.toUpperCase()+' '+e.currency+' '+number(l.price)).join(' · ');
function eventText(e){
  if(e.type==='market_trend')return 'SPX trend changed. '+marketText(e.context,Date.parse(e.context.checkedAt));
  if(e.type==='daily_drop')return `${e.symbol}: ${e.dropPct.toFixed(2)}% today, crossing the ${e.tier}% drop threshold. ${e.currency} ${number(e.quote.price)} vs previous close ${number(e.quote.previousClose)}.`;
  return `${e.symbol}: ${labels[e.type]}. ${levels(e)}. Price ${e.currency} ${number(e.quote.price)}${e.type==='support_approach'?`, ${e.distancePct.toFixed(2)}% above support`:''}.`;
}
export function renderAlertEmail({events,context,createdAt,demo=false}){
  if(!Array.isArray(events)||!events.length)throw Error('INVALID_ALERT_EMAIL');
  const now=Date.parse(createdAt),fresh=marketContextFresh(context,now);
  const sectionOrder=['market_trend','support_hit','support_approach','daily_drop'];
  const marketRank=e=>/\.HK$/i.test(e.symbol)?1:/\.SI$/i.test(e.symbol)?2:/^[A-Z]+(?:[-.][A-Z])?$/i.test(e.symbol)&&e.currency==='USD'?0:3;
  const depth=e=>Math.max(0,...(e.levels||[]).map(l=>Number(String(l.key).match(/\d+$/)?.[0])||0));
  const compare=(a,b)=>{
    const importance=a.type==='daily_drop'?a.dropPct-b.dropPct:depth(b)-depth(a)||(a.type==='support_approach'?a.distancePct-b.distancePct:0);
    return importance||marketRank(a)-marketRank(b)||a.symbol.localeCompare(b.symbol);
  };
  const sections=sectionOrder.map(type=>{
    const groups=new Map();
    for(const event of events.filter(e=>e.type===type).sort(compare)){
      if(!groups.has(event.symbol))groups.set(event.symbol,[]);
      groups.get(event.symbol).push(event);
    }
    return {type,groups};
  }).filter(section=>section.groups.size);
  const tickers=[...new Set(sections.flatMap(({type,groups})=>type==='market_trend'?[]:[...groups.keys()]))];
  const title=demo?'Your investment alerts, at a glance':'Your daily investment alerts';
  const preview=sections.flatMap(({groups})=>[...groups.values()].flat()).map(eventText).join(' · ').slice(0,180);
  const heading=type=>type==='daily_drop'?'Large daily drops':labels[type];
  const cards=sections.map(({type,groups})=>`<tr><td style="padding:4px 28px 10px;"><h2 style="margin:0;font-size:18px;color:#172b4d;">${esc(heading(type))}</h2></td></tr>`+[...groups].map(([symbol,group])=>{
    const observed=group.find(e=>e.quote),quote=observed?.quote,currency=observed?.currency;
    const metric=quote?`${currency} ${number(quote.price)}`:fresh?MARKET_LABELS[context.medium]:'Context unavailable';
    const lines=group.map(e=>{
      const color=['daily_drop','support_hit'].includes(e.type)?'#b42318':'#175c4b';
      const detail=e.type==='daily_drop'?`${e.dropPct.toFixed(2)}% today · crossed −${e.tier}%`:e.type==='support_approach'?`${e.distancePct.toFixed(2)}% above ${levels(e)}`:e.type==='support_hit'?levels(e):'Alignment, slope confirmation or position against the 200 SMA changed.';
      return `<li style="margin:5px 0;color:#576174;"><strong style="color:${color};">${esc(labels[e.type])}</strong> · ${esc(detail)}</li>`;
    }).join('');
    const e=group.find(event=>event.news);
    const news=e?.news?`<p style="margin:18px 0 8px;font-size:12px;line-height:18px;color:#576174;">${esc(e.news.status)}</p>${(e.news.items||[]).map(n=>`<p style="margin:8px 0;font-size:13px;line-height:20px;"><a href="${esc(n.url)}" style="color:#235f94;text-decoration:underline;">${esc(n.title)}</a><br><span style="font-size:11px;color:#576174;">${esc(stamp(n.publishedAt))} · ${esc(n.source)}</span></p>`).join('')}`:'';
    return `<tr><td style="padding:0 28px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dde3e8;border-radius:12px;background:#ffffff;"><tr><td style="padding:20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td><h2 style="margin:0;font-size:24px;line-height:30px;color:#172b4d;">${esc(symbol)}</h2></td><td align="right" style="padding-left:12px;font-size:17px;font-weight:700;color:#172b4d;">${esc(metric)}</td></tr></table><ul style="margin:10px 0 0;padding-left:20px;font-size:13px;line-height:21px;">${lines}</ul>${quote?`<p style="margin:12px 0 0;color:#576174;font-size:12px;line-height:19px;">Previous close ${esc(currency)} ${number(quote.previousClose)} · Quote ${esc(stamp(quote.time))}<br>${esc(quote.session)} · prices may be delayed</p>`:''}${news}</td></tr></table></td></tr>`;
  }).join('')).join('');
  const html=`<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;color:#172b4d;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;"><tr><td align="center" style="padding:28px 8px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#f8fafb;border:1px solid #dbe1e8;border-radius:16px;"><tr><td style="padding:30px 28px;background:#172b4d;border-radius:16px 16px 0 0;"><p style="margin:0 0 16px;font-size:11px;letter-spacing:2px;line-height:18px;color:#c8dfec;font-weight:700;">PERSONAL INVESTMENT · COMMAND CENTRE</p><h1 style="margin:0;font-size:28px;line-height:36px;color:#ffffff;">${esc(title)}</h1><p style="margin:12px 0 0;font-size:12px;line-height:20px;color:#d2e0ec;">${esc(stamp(createdAt))}${demo?' · DESIGN PREVIEW — ILLUSTRATIVE DATA':''}</p></td></tr><tr><td style="padding:24px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9eff5;border-left:4px solid #527694;border-radius:6px;"><tr><td style="padding:16px;"><p style="margin:0 0 8px;font-size:11px;letter-spacing:1px;line-height:18px;font-weight:700;color:#34536c;">THE MARKET AROUND YOUR TICKERS</p><p style="margin:0;font-size:16px;line-height:24px;font-weight:700;color:#172b4d;">${fresh?`SPX ${number(context.close)} · ${esc(MARKET_LABELS[context.medium])}`:'SPX context unavailable or stale'}</p><p style="margin:8px 0 0;font-size:12px;line-height:21px;color:#34536c;">${fresh?`20/40 EMA: ${esc(MARKET_LABELS[context.short])}<br>200 SMA: ${esc(context.priceVs200)} · ${context.slopes.sma200>0?'rising':context.slopes.sma200<0?'falling':'flat'}<br><strong>${context.drawdownPct.toFixed(1)}% below the 52-week closing peak</strong> of ${number(context.peak.price)} (${esc(context.peak.date)})<br>SPX data: ${esc(context.date)} completed close`:'Ticker observations are shown independently; no market trend is inferred.'}</p></td></tr></table></td></tr>${cards}<tr><td align="center" style="padding:8px 28px 28px;"><a href="${appURL}" style="display:inline-block;box-sizing:border-box;padding:14px 24px;background:#172b4d;border:1px solid #172b4d;border-radius:8px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Open investment command centre</a></td></tr><tr><td style="padding:22px 28px;border-top:1px solid #dbe1e8;font-size:11px;line-height:19px;color:#576174;">Daily condition checks · regular-session ticker quotes · SPX uses completed daily closes and five-session slopes. 20/40 confirmation is our stricter filter. These are market observations for your review.<br>Support notices are sent once per ticker, currency and price. Daily drops can escalate from 3% to 5% once per trading day. Recent headlines provide context, not a verified explanation.<br>Pause emails in Command Centre → Email alerts.</td></tr></table></td></tr></table></body></html>`;
  const groupsText=sections.map(({type,groups})=>heading(type)+'\n'+[...groups].map(([symbol,group])=>{
    const news=group.find(event=>event.news)?.news;
    return symbol+'\n'+group.map(e=>'- '+eventText(e)).join('\n')+(news?'\n'+news.status+'\n'+news.items.map(n=>n.title+'\n'+n.url).join('\n'):'');
  }).join('\n\n')).join('\n\n');
  const text=(demo?'DESIGN PREVIEW — ILLUSTRATIVE DATA\n\n':'')+title+'\n'+stamp(createdAt)+'\n\n'+marketText(context,now)+'\n\n'+groupsText+'\n\nOpen command centre: '+appURL+'\nPause in Command Centre → Email alerts.';
  const listed=tickers.slice(0,5).join(', ')+(tickers.length>5?' +'+(tickers.length-5):'');
  const subject=(demo?'[Preview] ':'[Command Centre] ')+'Daily digest · '+events.length+(events.length===1?' alert':' alerts')+(listed?' · '+listed:'')+(sections.some(section=>section.type==='market_trend')?' · SPX':'');
  return {subject,...(new TextEncoder().encode(html).length<=95000?{html}:{}),text};
}
