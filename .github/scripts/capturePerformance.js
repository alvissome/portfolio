// Personal portfolio only. No email/webhook delivery and no public data output.
import {initializeApp,cert} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {ACCOUNTS,todaySG,sourceSignature,capturePositions} from '../../assets/performance-core.js';

const serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
if(serviceAccount.project_id!=='alvissome-portfolio'||(process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_PROJECT_ID!=='alvissome-portfolio'))throw Error('Unexpected project; snapshot stopped.');
initializeApp({credential:cert(serviceAccount),projectId:'alvissome-portfolio'});
const db=getFirestore(),dryRun=process.argv.includes('--dry-run');
const date=todaySG();
async function json(url){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Price source unavailable.');return r.json();}
async function quote(symbol,currency){
  const data=await json('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=1mo');
  const result=data?.chart?.result?.[0],meta=result?.meta,now=Date.now()/1000;
  if(data?.chart?.error||meta?.symbol!==symbol||meta?.currency!==currency)throw Error('Quote validation failed.');
  const session=meta.currentTradingPeriod?.regular;
  const rows=(result.timestamp||[]).map((t,i)=>({time:t,price:result.indicators?.quote?.[0]?.close?.[i]})).filter(r=>r.time<=now&&r.time>=now-7*86400&&Number.isFinite(r.price)&&r.price>0&&!(session&&now<session.end&&r.time>=session.start)).sort((a,b)=>a.time-b.time);
  if(!rows.length)throw Error('No recent completed closing price.');return rows.at(-1);
}
let recorded=0,skipped=0,failures=0;
// listDocuments also discovers portfolios whose parent user document is absent.
for(const user of await db.collection('users').listDocuments()){
  const portfolio=user.collection('portfolio'),dataRef=portfolio.doc('data'),historyRef=portfolio.doc('performance');
  const [dataSnap,historySnap]=await Promise.all([dataRef.get(),historyRef.get()]);
  if(!dataSnap.exists||!historySnap.exists)continue;
  const data=dataSnap.data(),history=historySnap.data();if(!history.settings?.dailyEnabled)continue;
  let positions;try{positions=capturePositions(history,data);}catch{skipped++;continue;}
  const accounts={};
  for(const account of ACCOUNTS){
    const config=history.settings.capture?.[account];if(!config)continue;
    if(config.needsReconciliation){skipped++;continue;}
    if(!Array.isArray(config.holdings)||JSON.stringify(positions[account])!==config.positionSignature){skipped++;continue;}
    if(config.sourceSignature!==sourceSignature(data,account)||!Number.isFinite(config.cash)){skipped++;continue;}
    // A newly recorded movement means cash needs reconciliation before resuming.
    if(Object.values(history.flows||{}).some(f=>!f.voided&&f.account===account&&f.date>config.reconciledOn)){skipped++;continue;}
    try{
      const holdings=config.holdings;
      let invested=0,oldest=null;const needsFx=holdings.some(h=>h.currency!=='SGD');
      let rates={SGD:1};
      if(needsFx){const fx=await json('https://open.er-api.com/v6/latest/SGD');const age=Date.now()/1000-fx.time_last_update_unix;if(fx.result!=='success'||age<0||age>3*86400)throw Error('FX validation failed.');rates=fx.rates;}
      for(const h of holdings){
        if(!Number.isFinite(h.shares)||h.shares<0||!h.ticker||!h.currency)throw Error('Invalid holding.');
        const q=await quote(h.ticker,h.currency),rate=rates[h.currency];if(!(rate>0))throw Error('Missing FX rate.');
        invested+=h.shares*q.price/rate;oldest=oldest===null?q.time:Math.min(oldest,q.time);
      }
      if(!Number.isFinite(invested))throw Error('Invalid valuation.');
      accounts[account]={invested,cash:config.cash,verified:true,source:'daily closing prices',cashReconciledOn:config.reconciledOn,oldestQuoteAt:oldest?new Date(oldest*1000).toISOString():null};
    }catch{failures++;}
  }
  if(!Object.keys(accounts).length)continue;
  if(dryRun){recorded+=Object.keys(accounts).length;continue;}
  await db.runTransaction(async tx=>{
    const [latestData,latestHistory]=await Promise.all([tx.get(dataRef),tx.get(historyRef)]);
    const latest=latestHistory.data()||{},valid={};
    for(const [a,v]of Object.entries(accounts)){
      const config=latest.settings?.capture?.[a];
      const positionUnchanged=JSON.stringify(capturePositions(latest,latestData.data()||{})[a])===config?.positionSignature;
      if(latest.settings?.dailyEnabled && positionUnchanged && JSON.stringify(config)===JSON.stringify(history.settings.capture[a])&&sourceSignature(latestData.data()||{},a)===config.sourceSignature&&!Object.values(latest.flows||{}).some(f=>!f.voided&&f.account===a&&f.date>config.reconciledOn)){
        // Never overwrite a manually verified valuation for the same day.
        const prior=latest.snapshots?.[date]?.accounts?.[a];
        if(!prior||prior.source==='daily closing prices')valid[a]=v;
      }
    }
    if(!Object.keys(valid).length)return;
    const patch={snapshots:{[date]:{accounts:valid,recordedAt:new Date().toISOString()}}};
    const size=new TextEncoder().encode(JSON.stringify({...latest,snapshots:{...latest.snapshots,[date]:patch.snapshots[date]}})).length;
    if(size>700000)throw Error('Snapshot storage limit approaching.');
    tx.set(historyRef,patch,{merge:true});recorded+=Object.keys(valid).length;
  });
}
console.log((dryRun?'Dry run: ':'Capture: ')+recorded+' account valuations; '+skipped+' need reconciliation; '+failures+' price failures.');
if(failures)process.exitCode=1;
