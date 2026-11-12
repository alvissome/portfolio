import {initializeApp,cert} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {fetchResearchData} from './research-data.mjs';
import {buildSecUserAgent} from './research-http.mjs';
import {resolveReference} from './research-engine.mjs';

const secUserAgent=buildSecUserAgent(process.env.SEC_CONTACT_EMAIL);
if(!process.env.SEC_CONTACT_EMAIL) throw Error('SEC contact missing');
const urls={catalog:'https://www.sec.gov/files/company_tickers.json',submissions:'https://data.sec.gov/submissions/CIK0000789019.json',facts:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000789019.json'};
for(const [endpoint,url] of Object.entries(urls)){
  try {
    const response=await fetch(url,{headers:{'User-Agent':secUserAgent},redirect:'error',signal:AbortSignal.timeout(20000)});
    const body=response.ok?await response.json():{};
    const valid=endpoint==='catalog'?Boolean(body[0]?.ticker):endpoint==='facts'?Boolean(body.facts?.['us-gaap']):Boolean(body.filings?.recent);
    console.log('SEC',endpoint,response.status,valid);
  }catch{ console.log('SEC',endpoint,'request or JSON failed'); }
}
const account=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if(account.project_id!=='alvissome-portfolio')throw Error('Unexpected project');
initializeApp({credential:cert(account)});
const db=getFirestore();
function candles(bars,frame){
  const groups=new Map();
  for(const b of bars){
    const d=new Date(b.date+'T00:00:00Z');
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    const key=frame==='weekly'?d.toISOString().slice(0,10):b.date.slice(0,7);
    const prev=groups.get(key);
    groups.set(key,prev?{high:Math.max(prev.high,b.high),low:Math.min(prev.low,b.low),close:b.close}:b);
  }
  return [...groups.values()];
}
function ladders(bars){
  const w=candles(bars,'weekly'),close=bars.at(-1).close;
  const distinct=levels=>{
    const out=[];
    for(const p of levels)if(p>0&&p<=close&&out.every(v=>Math.abs(v/p-1)>.02))out.push(p);
    return out.slice(0,4).sort((a,b)=>b-a);
  };
  const averages=[];
  for(const n of [20,50,150,200]){
    if(w.length<n)continue;
    const mean=a=>a.reduce((s,b)=>s+b.close,0)/n;
    averages.push(n===20?w.slice(n).reduce((e,b)=>e+(b.close-e)*2/(n+1),mean(w.slice(0,n))):mean(w.slice(-n)));
  }
  function former(series){
    const prices=[];
    for(let i=2;i<series.length-2;i++){
      const p=series[i].high;
      if(series.slice(i-2,i+3).every(b=>b.high<=p)&&series.slice(i+2).some(b=>b.close>p*1.02))prices.unshift(p);
    }
    return prices;
  }
  const resistance=former(w.slice(-156));
  const overlap=resistance.filter(p=>averages.some(v=>Math.abs(v/p-1)<=.02));
  const year=w.slice(-52),peak=year.reduce((i,b,j)=>b.high>=year[i].high?j:i,0);
  const high=year[peak].high,low=Math.min(...year.slice(0,peak).map(b=>b.low));
  const fib=peak?[.382,.5,.618,.786].map(r=>high-r*(high-low)):[];
  return {weeklyMA:distinct(averages),weeklyResistance:distinct(resistance),dailyResistance:distinct(former(bars.slice(-252))),monthlyResistance:distinct(former(candles(bars,'monthly').slice(-60))),fibonacci:distinct(fib),confluence:distinct(overlap)};
}
function score(pred,ref){
  const a=[...pred].sort((x,y)=>x-y),b=[...ref].sort((x,y)=>x-y);
  let i=0,j=0,hits=0;
  while(i<a.length&&j<b.length){
    if(a[i]<.98*b[j])i++;else if(a[i]>1.02*b[j])j++;else{i++;j++;hits++;}
  }
  return {hits,full:hits===a.length&&hits===b.length};
}
for(const user of await db.collection('users').listDocuments()){
  const data=(await user.collection('portfolio').doc('data').get()).data();
  const universe=new Set([...Object.values(data?.holdings||{}).filter(h=>!h.exited),...Object.values(data?.watchlist||{})].map(r=>r.ticker||r.symbol));
  const confidence={mid:0,low:0,high:0},results={},totals={};let eligible=0,levels=0,bestHits=0,anyFull=0;
  for(const [symbol,record] of Object.entries(data?.researchBySecurity||{})){
    const ref=resolveReference(record,data.researchReferenceSnapshotMeta)||record.reference;
    if(!universe.has(symbol)||symbol==='NKE'||!['2026-11-03','2026-11-04'].includes(ref?.asOf)||!ref.supports?.length)continue;
    eligible++;
    const input=await fetchResearchData(symbol,{asOf:ref.asOf,secUserAgent,twelveDataKey:process.env.TWELVE_DATA_KEY});
    if(input.bars.length<252||input.history?.asOf!==ref.asOf||!input.history.adjustmentVintageVerified||input.instrument.currency!==ref.currency)continue;
    levels+=ref.supports.length;
    const fits={};
    for(const [name,pred] of Object.entries(ladders(input.bars))){
      const {hits,full}=score(pred,ref.supports);
      fits[name]={pred,hits,full};
      const t=totals[name]??={hits:0,full:0,predictions:0};
      t.hits+=hits;t.full+=Number(full);t.predictions+=pred.length;
    }
    const best=Math.max(...Object.values(fits).map(s=>s.hits));
    bestHits+=best;
    if(Object.values(fits).some(s=>s.full))anyFull++;
    const rating=best/ref.supports.length>=.6?'mid':'low';
    confidence[rating]++;
    results[symbol]={asOf:ref.asOf,fits,bestNovemberFit:rating};
  }
  if(eligible)await user.collection('researchStudies').doc('november-2026-personal-v1').set({results,totals,eligible,levels});
  console.log('STUDY',JSON.stringify({eligible,evaluated:Object.keys(results).length,levels,totals,bestHits,anyFull,confidence}));
}
