// Boost Code module. Inputs h1..h7 are Yahoo daily chart responses;
// instruments is the private Boost instrument configuration. No sheet dependency.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now = new Date(input.asOf || Date.now());
const y=now.getUTCFullYear(), m=now.getUTCMonth();
const target=new Date(Date.UTC(y,m,9)), previous=new Date(Date.UTC(y,m-1,9));
const day=d=>d.toISOString().slice(0,10);
const targetDate=day(target), previousDate=day(previous);
const instruments=typeof input.instruments==='string'?JSON.parse(input.instruments):input.instruments;
if(!Array.isArray(instruments)||instruments.length!==7)throw Error('Expected exactly seven configured instruments');
const failures=[],rows=[];
for(let i=0;i<instruments.length;i++){
 const config=instruments[i];
 try{
  const raw=typeof input['h'+(i+1)]==='string'?JSON.parse(input['h'+(i+1)]):input['h'+(i+1)];
  const r=raw?.chart?.result?.[0];
  if(!r||raw.chart.error)throw Error('price history unavailable');
  if(r.meta.symbol!==config.symbol||r.meta.currency!==config.currency||r.meta.dataGranularity!=='1d')throw Error('source identity, currency or interval mismatch');
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:r.meta.exchangeTimezoneName||'UTC',year:'numeric',month:'2-digit',day:'2-digit'});
  const history=(r.timestamp||[]).map((t,j)=>({date:format.format(new Date(t*1000)),close:r.indicators?.quote?.[0]?.close?.[j]}))
    .filter(p=>Number.isFinite(p.close)&&p.close>0&&p.date<=targetDate).sort((a,b)=>a.date.localeCompare(b.date));
  const snapshot=(date)=>{
   const start=new Date(date+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-365);
   const series=history.filter(p=>p.date<=date&&p.date>=day(start));
   if(series.length<180)throw Error('insufficient daily observations');
   const latest=series.at(-1), age=(Date.parse(date)-Date.parse(latest.date))/86400000;
   if(age>(config.symbol.startsWith('0P')?7:5))throw Error('stale close at reporting date');
   for(let j=1;j<series.length;j++)if(Math.abs(series[j].close/series[j-1].close-1)>.4)throw Error('unexplained price discontinuity; review source or corporate action');
   const peak=series.reduce((a,b)=>b.close>a.close?b:a);
   return {close:latest.close,date:latest.date,peak:peak.close,peakDate:peak.date,drop:100*(1-latest.close/peak.close)};
  };
  const current=snapshot(targetDate);let prior=null;
  try{prior=snapshot(previousDate);}catch{}
  rows.push({...config,...current,change:prior?100*(current.close/prior.close-1):null});
 }catch(e){failures.push(config.name+': '+e.message);}
}
const test=input.test===true||input.test==='true';
const month=target.toLocaleDateString('en-SG',{month:'long',year:'numeric',timeZone:'UTC'});
const ok=failures.length===0&&rows.length===7;
const subject=(test?'[TEST] ':'')+(ok?'[Portfolio] Monthly 9th Close Report — '+month:'[Portfolio failure] Monthly report incomplete — '+month);
const cell=(v)=>'<td style="padding:14px 10px;border-bottom:1px solid #e5eaf0">'+v+'</td>';
const format=v=>v.toLocaleString('en-SG',{minimumFractionDigits:4,maximumFractionDigits:4});
const html='<!doctype html><html><head><meta charset="UTF-8"></head><body style="margin:0;background:#f3f6fa;font-family:Arial,sans-serif;color:#17324d"><div style="max-width:820px;margin:28px auto;background:white;border-radius:14px;overflow:hidden"><div style="padding:28px;background:#17324d;color:white"><p style="margin:0 0 10px;color:#bcd6ef">INVESTMENT PORTFOLIO'+(test?' &middot; TEST':'')+'</p><h1 style="margin:0;font-size:26px">'+(ok?'Your monthly market snapshot':'Monthly report needs attention')+'</h1><p style="margin-bottom:0">Closes on or before 9 '+esc(month)+'</p></div><div style="padding:24px">'+(test?'<p><strong>Test delivery using the reporting cutoff. No trading or alert state changes.</strong></p>':'')+
 (ok?'<table role="table" style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="text-align:left;background:#eef4f9">'+['Instrument','Close','Since prior 9th','Below 365-day peak','Price date'].map(v=>'<th style="padding:12px 10px">'+v+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cell(esc(r.name))+cell(esc(r.currency)+' '+format(r.close))+cell(r.change===null?'Unavailable':(r.change>=0?'+':'')+r.change.toFixed(1)+'%')+cell(r.drop.toFixed(1)+'%')+cell(r.date)+'</tr>').join('')+'</tbody></table>':'<p>A complete, validated seven-instrument report could not be produced. No unverified comparison is presented.</p><ul>'+failures.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>')+
 '<p style="font-size:12px;color:#5c6d80;line-height:1.6">Peak = highest validated daily close in the 365 calendar days through the reporting date. The change column compares closes on/before the current and previous month's 9th; it excludes dividends, fees and FX changes. Historical prices come from Yahoo Finance; currencies are shown per instrument. Unit trust NAVs can lag market prices.</p><p style="font-size:12px;color:#5c6d80">Generated '+esc(now.toLocaleString('en-SG',{timeZone:'Asia/Singapore'}))+' SGT &middot; Managed by Boost.space</p></div></div></body></html>';
const field=(k,v)=>({customFieldInputName:k+'_Ngy3zmgf',value:String(v)});
const summary=ok?'Monthly report '+targetDate+'; '+rows.map(r=>r.name+' '+r.currency+' '+format(r.close)+'; drop '+r.drop.toFixed(1)+'%; data '+r.date).join(' | '):failures.join(' | ');
return {ok,subject,html,rows,failures,targetDate,summary,
 sentBody:JSON.stringify({spaceId:21,statusSystemId:94,customFieldsValues:[field('data_status',(test?'TEST delivered: ':'Delivered: ')+summary),field('last_successful_check',now.toISOString()),field('last_alert_sent',now.toISOString()),field('alert_state',ok?(test?'test_verified':'sent:'+targetDate.slice(0,7)):'failed')]})};
