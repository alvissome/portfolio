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
    groups.set(key,prev?{open:prev.open,high:Math.max(prev.high,b.high),low:Math.min(prev.low,b.low),close:b.close}:b);
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
  // Define candidates from chart data alone. Retain the actual level of the
  // first contributing family instead of averaging nearby prices.
  const families={
    weeklyResistance:distinct(resistance), weeklyMA:distinct(averages),
    monthlyResistance:distinct(former(candles(bars,'monthly').slice(-60))),
    dailyResistance:distinct(former(bars.slice(-252))), fibonacci:distinct(fib)
  };
  const candidates=Object.values(families).flat();
  const ranked=candidates.map(price=>({
    price, votes:Object.values(families).filter(list=>list.some(v=>Math.abs(v/price-1)<=.02)).length
  })).sort((a,b)=>b.votes-a.votes||b.price-a.price);
  const selected=[];
  for(const {price,votes} of ranked){
    if(selected.length>=5||(selected.length>=3&&votes<2))break;
    if(selected.every(v=>Math.abs(v/price-1)>.02))selected.push(price);
  }
  const mixed=selected.sort((a,b)=>b-a);
  return {...families,confluence:distinct(overlap),mixed,candidatePool:[...new Set(candidates)]};
}
function score(pred,ref){
  const a=[...pred].sort((x,y)=>x-y),b=[...ref].sort((x,y)=>x-y);
  let i=0,j=0,hits=0;
  while(i<a.length&&j<b.length){
    if(a[i]<.98*b[j])i++;else if(a[i]>1.02*b[j])j++;else{i++;j++;hits++;}
  }
  return {hits,full:hits===a.length&&hits===b.length};
}
function features(bars) {
  const levels=[];
  const add=(price,family,weight=1)=>{if(Number.isFinite(price)&&price>0)levels.push({price,family,weight});};
  const weekly=candles(bars,'weekly'),monthly=candles(bars,'monthly');
  for(const [frame,series,span] of [['day',bars,252],['week',weekly,156],['month',monthly,60]]){
    const recent=series.slice(-span),lows=[];
    for(let i=2;i<recent.length-2;i++){
      const b=recent[i],window=recent.slice(i-2,i+3);
      const trough=window.every(o=>b.low<=o.low),peak=window.every(o=>b.high>=o.high);
      const w=(.6+.4*i/recent.length)*(frame==='day'?.6:1);
      if(trough){add(b.low,frame+'-low',w);add(Math.min(b.open,b.close),frame+'-body',w);lows.push(i);}
      if(peak&&recent.slice(i+2).some(o=>o.close>b.high*1.015)){add(b.high,frame+'-flip',w);add(Math.max(b.open,b.close),frame+'-body',w);}
      if(i&&b.low>recent[i-1].high*1.015){add(b.low,'gap',w);add(recent[i-1].high,'gap',w);}
    }
    if(lows.length>=2){
      const [i,j]=lows.slice(-2);
      if(recent[j].low>recent[i].low)add(recent[j].low+(recent[j].low-recent[i].low)*(recent.length-1-j)/(j-i),'trendline');
    }
    for(const n of [20,50,100,150,200]){
      if(series.length<n)continue;
      const sma=series.slice(-n).reduce((s,b)=>s+b.close,0)/n;
      add(sma,frame+'-ma');
      const seed=series.slice(0,n).reduce((s,b)=>s+b.close,0)/n;
      add(series.slice(n).reduce((e,b)=>e+2*(b.close-e)/(n+1),seed),frame+'-ma');
    }
  }
  for(const n of [26,52,104,156]){
    const w=weekly.slice(-n),j=w.reduce((k,b,i)=>b.high>=w[k].high?i:k,0);
    if(j){const low=Math.min(...w.slice(0,j).map(b=>b.low));for(const r of [.236,.382,.5,.618,.786])add(w[j].high-r*(w[j].high-low),'fib');}
  }
  return levels;
}

function staggerRules(bars,iv) {
  const close=bars.at(-1).close,w=candles(bars,'weekly'),pool=features(bars);
  const atr=w.slice(-14).reduce((s,b,i)=>{const prev=w.at(-15+i).close;return s+Math.max(b.high-b.low,Math.abs(b.high-prev),Math.abs(b.low-prev));},0)/14/close;
  const spaced={};const all=[...new Set(pool.map(p=>p.price))];
  const candidates=all.map(price=>{
    const votes=new Map();
    for(const p of pool)if(Math.abs(p.price/price-1)<=.012)votes.set(p.family,Math.max(votes.get(p.family)||0,p.weight));
    return {price,strength:[...votes.values()].reduce((a,b)=>a+b,0)};
  });
  const anchors={close,monthHigh:Math.max(...w.slice(-4).map(b=>b.high)),quarterHigh:Math.max(...w.slice(-13).map(b=>b.high)),priorClose:w.at(-5).close};
  if(iv>0)anchors.sheetIV=iv;
  for(const [anchorName,anchor] of Object.entries(anchors)){
    for(const [gapName,gap] of Object.entries({tight:.06,medium:.09,wide:.12,atr:Math.min(.16,Math.max(.045,atr*1.5))})){
      for(const offset of [0,.5,1]){
        for(const rule of ['grid','nearest','confluence']){
          const picks=[],strength=[];
          for(let i=0;i<5;i++){
            const target=anchor*(1-gap)**(i+offset);
            if(rule==='grid'){picks.push(target);strength.push(0);continue;}
            const viable=candidates.filter(c=>Math.abs(c.price/target-1)<=gap*.5&&(!picks.length||c.price<picks.at(-1)*(1-gap*.4)));
            const metric=c=>Math.abs(c.price/target-1)/gap-(rule==='confluence'?Math.min(8,c.strength)*.06:0);
            viable.sort((a,b)=>metric(a)-metric(b));
            if(viable.length){picks.push(viable[0].price);strength.push(viable[0].strength);}
          }
          for(const count of [3,4,5,'adaptive']){
            const n=count==='adaptive'?(strength[4]>=5?5:strength[3]>=3?4:3):count;
            spaced[[anchorName,gapName,offset,rule,count].join('/')]=picks.slice(0,n);
          }
        }
      }
    }
  }
  const nearby=(target,width)=>{
    const choices=candidates.filter(c=>Math.abs(c.price/target-1)<=width);
    const merit=c=>Math.min(8,c.strength)*.004-Math.abs(c.price/target-1);
    return choices.sort((a,b)=>merit(b)-merit(a))[0]?.price??target;
  };
  for(const [anchorName,anchor] of Object.entries(anchors)){
    if(anchorName==='sheetIV')continue;
    for(const discount of [0,.06,.12]){
      const top=nearby(anchor*(1-discount),.04);
      for(const lookback of [13,26,52,104]){
        const recent=w.slice(-lookback),bottom=Math.min(...recent.map(b=>b.low));
        for(const count of [3,4,5,'adaptive']){
          const n=count==='adaptive'?Math.max(3,Math.min(5,1+Math.round(Math.log(bottom/top)/Math.log(.91)))):count;
          for(const shape of ['linear','geometric','linearSnap','geometricSnap']){
            const levels=[];
            if(bottom<top*.94){
              for(let rung=0;rung<n;rung++){
                const f=rung/(n-1);
                const target=shape.startsWith('linear')?top+(bottom-top)*f:top*(bottom/top)**f;
                const value=shape.endsWith('Snap')&&rung>0&&rung<n-1?nearby(target,Math.min(.025,(1-bottom/top)/(3*n))):target;
                levels.push(value);
              }
            }
            spaced[['endpoint',anchorName,discount,lookback,count,shape].join('/')]=levels;
          }
        }
      }
    }
  }
  return {spaced,all};
}
for(const user of await db.collection('users').listDocuments()){
  const data=(await user.collection('portfolio').doc('data').get()).data();
  const universe=new Set([...Object.values(data?.holdings||{}).filter(h=>!h.exited),...Object.values(data?.watchlist||{})].map(r=>r.ticker||r.symbol));
  const confidence={mid:0,low:0,high:0},results={},totals={};const counts={},paired={better:0,same:0,worse:0};let eligible=0,levels=0,bestHits=0,anyFull=0;
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
    const {spaced,all}=staggerRules(input.bars,ref.iv?.value);
    const scores={};
    for(const [key,pred] of Object.entries(spaced)){
      const {hits,full}=score(pred,ref.supports);
      scores[key]={hits,full,n:pred.length};
    }
    results[symbol]={scores,refCount:ref.supports.length,pool:score(all,ref.supports).hits,poolSize:all.length,
      above:ref.supports.filter(p=>p>input.bars.at(-1).close*1.02).length};
  }
  const rows=Object.values(results);
  if(!rows.length)continue;
  function choose(training,keys){
    const summed=key=>training.reduce(([full,hits,extra],r)=>{const s=r.scores[key];return [full+Number(s.full),hits+s.hits,extra+s.n-s.hits];},[0,0,0]);
    return keys.map(key=>({key,v:summed(key)})).sort((a,b)=>b.v[0]-a.v[0]||b.v[1]-a.v[1]||a.v[2]-b.v[2]||a.key.localeCompare(b.key))[0].key;
  }
  const common=Object.keys(rows[0].scores).filter(k=>rows.every(r=>r.scores[k]));
  const keys=common.filter(k=>!k.startsWith('sheetIV/'));
  const summary={eligible,evaluated:rows.length,levels,rules:keys.length,above:rows.reduce((s,r)=>s+r.above,0),pool:rows.reduce((s,r)=>s+r.pool,0),poolSize:rows.reduce((s,r)=>s+r.poolSize,0)};
  const privateFits={};
  for(const [mode,subset] of Object.entries({all:keys,grid:keys.filter(k=>k.includes('/grid/')),technical:keys.filter(k=>!k.includes('/grid/')&&!k.startsWith('endpoint/')),endpoints:keys.filter(k=>k.startsWith('endpoint/'))})){
    const key=choose(rows,subset),total={key,hits:0,full:0,pred:0,looHits:0,looFull:0,looPred:0,oracleFull:0};
    for(const [symbol,row] of Object.entries(results)){
      const held=choose(rows.filter(r=>r!==row),subset);
      const s=row.scores[key],v=row.scores[held];
      total.hits+=s.hits;total.full+=Number(s.full);total.pred+=s.n;
      total.looHits+=v.hits;total.looFull+=Number(v.full);total.looPred+=v.n;
      total.oracleFull+=Number(subset.some(k=>row.scores[k].full));
      if(mode==='all')privateFits[symbol]={heldOutRule:held,...v,referenceCount:row.refCount,
        confidence:v.hits/row.refCount>=.6?'mid':'low'};
    }
    summary[mode]=total;
  }
  summary.mid=Object.values(privateFits).filter(v=>v.confidence==='mid').length;
  const ivRows=rows.filter(r=>Object.keys(r.scores).some(k=>k.startsWith('sheetIV/')));
  if(ivRows.length>1){
    const ivKeys=Object.keys(ivRows[0].scores).filter(k=>k.startsWith('sheetIV/'));
    const total={evaluated:ivRows.length,hits:0,full:0,levels:0};
    for(const row of ivRows){
      const pick=choose(ivRows.filter(r=>r!==row),ivKeys),v=row.scores[pick];
      total.hits+=v.hits;total.full+=Number(v.full);total.levels+=row.refCount;
    }
    summary.conditionalSheetIV=total;
  }
  await user.collection('researchStudies').doc('november-2026-endpoints-v1').set({summary,privateFits});
  console.log('STAGGER',JSON.stringify(summary));
}
