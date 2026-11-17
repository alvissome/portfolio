import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {alertUniverse,evaluateTicker,evaluateMarket} from './command-alerts.mjs';
import {fetchSPX,fetchAlertQuote,fetchAlertNews} from './alert-data.mjs';
import {renderAlertEmail} from './alert-email.mjs';
import {sendAlertEmail,deliveryDecision} from './alert-delivery.mjs';
import {marketContextFresh} from '../../assets/market-context.js';
export const PERSONAL_PROJECT='alvissome-portfolio';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function validateAlertEnvironment(env){
  let serviceAccount;try{serviceAccount=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT||'');}catch{throw Error('PERSONAL_FIREBASE_SETUP_NEEDED');}
  if(serviceAccount.project_id!==PERSONAL_PROJECT||(env.FIREBASE_PROJECT_ID&&env.FIREBASE_PROJECT_ID!==PERSONAL_PROJECT))throw Error('PERSONAL_PROJECT_MISMATCH');
  const uid=env.PORTFOLIO_ALERT_UID?.trim(),to=env.PORTFOLIO_ALERT_TO?.trim(),from=env.PORTFOLIO_ALERT_FROM?.trim(),ownerEmail=env.PORTFOLIO_ALERT_OWNER_EMAIL?.trim()||to;
  if(!uid||uid.includes('/')||uid.length>128)throw Error('PERSONAL_ALERT_UID_NEEDED');
  const enabled=env.PORTFOLIO_ALERTS_ENABLED==='true';
  if(enabled&&(!to||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to)||!from||/[\r\n]/.test(from)||!env.PORTFOLIO_ALERT_RESEND_KEY))throw Error('PERSONAL_EMAIL_SETUP_NEEDED');
  return {serviceAccount,uid,to,from,ownerEmail,enabled};
}
export function eventIdentity(event){
  return event.type==='daily_drop'?[event.type,event.symbol,event.quote.date,event.tier]:event.type==='market_trend'?[event.type,event.context.date,event.before,event.context.short,event.context.medium,event.context.long,event.context.priceVs200]:[event.type,event.symbol,event.currency,event.levels.map(l=>l.price).sort((a,b)=>b-a)];
}
const strategyOf=snap=>snap.data()?.settings?.investmentStrategy||{};
export function alertRunMode(argv){
  if(argv.includes('--dry-run')&&argv.includes('--run'))throw Error('SELECT_ONE_ALERT_MODE');
  if(argv.includes('--dry-run'))return 'dry-run';
  if(argv.includes('--run'))return 'run';
  throw Error('EXPLICIT_ALERT_MODE_REQUIRED');
}
export function outstandingDelivery(records){
  const blocked=records.filter(r=>r.status==='blocked').length,review=records.filter(r=>r.status==='needs_review').length;
  return {count:blocked+review,message:review?'An email outcome needs review; automatic retries stopped to prevent duplicates.':blocked?'Email sending is blocked; verify the personal sender and credentials.':''};
}
export async function main(env=process.env){
  const dryRun=alertRunMode(process.argv)==='dry-run',settings=validateAlertEnvironment(env),now=new Date();
  const [{initializeApp,cert},{getFirestore},{getAuth}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/firestore'),import('firebase-admin/auth')]);
  initializeApp({credential:cert(settings.serviceAccount),projectId:PERSONAL_PROJECT});
  const db=getFirestore(),portfolio=db.collection('users').doc(settings.uid).collection('portfolio');
  const dataRef=portfolio.doc('data'),strategyRef=portfolio.doc('performance'),statusRef=portfolio.doc('ccAlertStatus'),marketRef=portfolio.doc('ccMarketContext');
  const [dataSnap,strategySnap,cachedMarket]=await Promise.all([dataRef.get(),strategyRef.get(),marketRef.get()]);
  if(!dataSnap.exists||!strategySnap.exists)throw Error('PERSONAL_PORTFOLIO_NOT_FOUND');
  if(settings.enabled){const owner=await getAuth().getUser(settings.uid);if(owner.disabled||owner.email?.toLowerCase()!==settings.ownerEmail.toLowerCase())throw Error('PERSONAL_ALERT_OWNER_NOT_VERIFIED');}
  const data=dataSnap.data(),strategy=strategyOf(strategySnap),universe=alertUniverse(data,strategy),signature=JSON.stringify(universe);
  const enabled=settings.enabled&&strategy.alerts?.enabled!==false;
  let context=cachedMarket.data()||null,marketAvailable=true;
  const counts={tickers:universe.length,quoted:0,unavailable:0,events:0,queued:0,accepted:0,deliveryIssues:0};
  const warnings=[];
  try{context=await fetchSPX({now});if(!dryRun)await marketRef.set(context);}
  catch{marketAvailable=false;if(!marketContextFresh(context,+now))context=null;}
  const queue=async(tx,stateRef,result)=>{
    if(!enabled||!result.events.length){tx.set(stateRef,result.state);return;}
    const events=result.events,createdAt=now.toISOString();
    const id=hash(JSON.stringify(events.map(eventIdentity))),mailRef=portfolio.doc('ccAlerts').collection('mail').doc(id);
    const existing=await tx.get(mailRef);
    tx.set(stateRef,result.state);
    if(existing.exists)return;
    const rendered=renderAlertEmail({events,context,createdAt});
    tx.create(mailRef,{status:'queued',createdAt,attempts:0,firstAttemptAt:null,
      scope:events.map(e=>({symbol:e.symbol,type:e.type,currency:e.currency||null,prices:(e.levels||[]).map(l=>l.price)})),
      idempotencyKey:'cc-alert/'+hash(settings.uid+'/'+id),email:{from:settings.from,to:[settings.to],...rendered}});
  };
  // All state/outbox changes check current plans and membership in the same
  // transaction. Editing or removing a ticker while a quote loads discards work.
  const stillCurrent=async tx=>{
    const [freshData,freshStrategy]=await Promise.all([tx.get(dataRef),tx.get(strategyRef)]);
    const latest=strategyOf(freshStrategy);
    return latest.alerts?.enabled===strategy.alerts?.enabled&&JSON.stringify(alertUniverse(freshData.data()||{},latest))===signature;
  };
  if(context&&marketContextFresh(context,+now)){
    const ref=portfolio.doc('ccAlertMarketState');
    const observed=evaluateMarket(context,(await ref.get()).data(),+now);counts.events+=observed.events.length;
    if(!dryRun)await db.runTransaction(async tx=>{
      const prior=await tx.get(ref);if(!await stillCurrent(tx))return;
      const result=evaluateMarket(context,prior.data(),+now);await queue(tx,ref,result);if(enabled&&result.events.length)counts.queued++;
    });
  }
  for(const item of universe){
    let quote;try{quote=await fetchAlertQuote(item.symbol,{now});counts.quoted++;}catch{counts.unavailable++;warnings.push({symbol:item.symbol,reason:'Quote unavailable or not current'});continue;}
    const ref=portfolio.doc('ccAlertState-'+item.symbol),observed=evaluateTicker(item,quote,(await ref.get()).data(),+now);
    if(observed.skipped){counts.unavailable++;warnings.push({symbol:item.symbol,reason:observed.skipped});}
    counts.events+=observed.events.length;
    const news=observed.events.some(e=>e.type==='daily_drop')?await fetchAlertNews(item.symbol,{now}):null;
    if(!dryRun)await db.runTransaction(async tx=>{
      const prior=await tx.get(ref);if(!await stillCurrent(tx))return;
      const result=evaluateTicker(item,quote,prior.data(),+now);
      result.events=result.events.map(e=>e.type==='daily_drop'?{...e,news:news||{items:[],status:'News unavailable; no cause confirmed.'}}:e);
      if(Buffer.byteLength(JSON.stringify(result.state))>300000)throw Error('ALERT_HISTORY_REQUIRES_REVIEW');
      await queue(tx,ref,result);if(enabled&&result.events.length)counts.queued++;
    });
  }
  let lastAcceptedAt=null,lastError='';
  if(!dryRun){
    const pending=await portfolio.doc('ccAlerts').collection('mail').where('status','in',['queued','retry','sending','blocked']).limit(100).get();
    for(const doc of pending.docs){
      const token=randomUUID();
      const record=await db.runTransaction(async tx=>{
        const [mail,currentStrategy,currentData]=await Promise.all([tx.get(doc.ref),tx.get(strategyRef),tx.get(dataRef)]),current=mail.data();
        if(!settings.enabled||strategyOf(currentStrategy).alerts?.enabled===false){tx.update(doc.ref,{status:'cancelled',reason:'Alerts paused'});return null;}
        const active=alertUniverse(currentData.data()||{},strategyOf(currentStrategy));
        if(current.scope?.some(s=>s.symbol!=='SPX'&&!active.some(a=>a.symbol===s.symbol&&(!s.prices.length||a.currency===s.currency&&s.prices.every(p=>a.levels.some(l=>l.price===p)))))){
          tx.update(doc.ref,{status:'cancelled',reason:'Ticker or support changed'});return null;
        }
        const decision=deliveryDecision(current,Date.now());
        if(decision==='skip')return null;
        if(decision==='expire'){tx.update(doc.ref,{status:'cancelled',reason:'Observation expired before sending'});return null;}
        if(decision==='review'){tx.update(doc.ref,{status:'needs_review',code:'RETRY_WINDOW_EXPIRED_OR_ATTEMPT_LIMIT'});counts.deliveryIssues++;lastError='An email outcome needs review; automatic retries stopped to prevent duplicates.';return null;}
        const claimed={...current,status:'sending',leaseToken:token,leaseUntil:Date.now()+10*60000,firstAttemptAt:current.firstAttemptAt||Date.now(),attempts:(current.attempts||0)+1};
        tx.set(doc.ref,claimed);return claimed;
      });
      if(!record)continue;
      const sent=await sendAlertEmail(record.email,record.idempotencyKey,env.PORTFOLIO_ALERT_RESEND_KEY);
      await db.runTransaction(async tx=>{
        const latest=await tx.get(doc.ref);if(latest.get('leaseToken')!==token)return;
        tx.update(doc.ref,{status:sent.status,leaseUntil:0,leaseToken:null,
          ...(sent.id?{providerId:sent.id,acceptedAt:new Date().toISOString()}:{code:sent.code,nextAttemptAt:Date.now()+(sent.status==='blocked'?6*3600000:60000)}),
          deliveryUncertain:!!record.deliveryUncertain||!!sent.uncertain,
          ...(sent.uncertain===false&&!record.deliveryUncertain?{firstAttemptAt:null}:{}),
          ...(sent.status==='blocked'?{attempts:0}:{})});
      });
      if(sent.status==='accepted'){counts.accepted++;lastAcceptedAt=new Date().toISOString();}
      else{counts.deliveryIssues++;lastError=sent.code;}
    }
    const unresolved=await portfolio.doc('ccAlerts').collection('mail').where('status','in',['blocked','needs_review']).limit(100).get();
    const outstanding=outstandingDelivery(unresolved.docs.map(d=>d.data()));
    counts.deliveryIssues=Math.max(counts.deliveryIssues,outstanding.count);lastError=lastError||outstanding.message;
    await statusRef.set({checkedAt:now.toISOString(),enabled,mode:!settings.enabled?'Setup needed':!enabled?'Paused':counts.deliveryIssues?'Delivery issue':counts.unavailable||!marketAvailable?'Active · data gaps':'Active',...counts,marketAvailable,warnings,
      ...(lastAcceptedAt?{lastAcceptedAt}:{}),lastError,source:'Hourly personal GitHub worker; scheduling and quotes may be delayed'}, {merge:true});
  }
  // Public Actions logs contain counts only. No tickers, emails, quotes, payloads,
  // holdings, notes, credentials, news URLs, balances or user IDs.
  console.log(JSON.stringify({mode:dryRun?'dry-run':enabled?'active':'context-only',...counts,marketAvailable}));
  if(counts.deliveryIssues||counts.unavailable||!marketAvailable)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Personal CC alert check could not complete. Verify personal repository settings and private dashboard status. No private data logged.');process.exitCode=1;});
