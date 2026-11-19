import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {alertUniverse,evaluateTicker,evaluateMarket} from './command-alerts.mjs';
import {fetchSPX,fetchAlertQuote,fetchAlertNews} from './alert-data.mjs';
import {renderAlertEmail} from './alert-email.mjs';
import {sendAlertEmail,deliveryDecision,prepareDigestEmail} from './alert-delivery.mjs';
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
export function singaporeDigestDay(date){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
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
  const mail=portfolio.doc('ccAlerts').collection('mail');
  const digestDay=singaporeDigestDay(now),mailRef=mail.doc('digest-'+digestDay);
  const observations=[];
  if(context&&marketContextFresh(context,+now)){
    observations.push({ref:portfolio.doc('ccAlertMarketState'),evaluate:prior=>evaluateMarket(context,prior,+now)});
  }
  for(const item of universe){
    let quote;
    try{quote=await fetchAlertQuote(item.symbol,{now});counts.quoted++;}
    catch{counts.unavailable++;warnings.push({symbol:item.symbol,reason:'Quote unavailable or not current'});continue;}
    observations.push({symbol:item.symbol,ref:portfolio.doc('ccAlertState-'+item.symbol),evaluate:prior=>evaluateTicker(item,quote,prior,+now)});
  }
  const observed=await Promise.all(observations.map(async observation=>{
    const result=observation.evaluate((await observation.ref.get()).data());
    if(observation.symbol&&result.skipped){counts.unavailable++;warnings.push({symbol:observation.symbol,reason:result.skipped});}
    return result;
  }));
  counts.events=observed.reduce((total,result)=>total+result.events.length,0);
  if(!dryRun){
    const news=await Promise.all(observations.map((observation,index)=>
      enabled&&observed[index].events.some(event=>event.type==='daily_drop')?fetchAlertNews(observation.symbol,{now}):null));
    // Reserve a single digest for the Singapore calendar day and commit its
    // alert baselines atomically. A rerun can retry the same immutable message.
    counts.queued=await db.runTransaction(async tx=>{
      const [freshData,freshStrategy,existing,...prior]=await Promise.all([
        tx.get(dataRef),tx.get(strategyRef),tx.get(mailRef),...observations.map(o=>tx.get(o.ref)),
      ]);
      const latest=strategyOf(freshStrategy);
      const stillCurrent=latest.alerts?.enabled===strategy.alerts?.enabled&&JSON.stringify(alertUniverse(freshData.data()||{},latest))===signature;
      if(!stillCurrent||(enabled&&existing.exists))return 0;
      const events=[];
      observations.forEach((observation,index)=>{
        const result=observation.evaluate(prior[index].data());
        if(Buffer.byteLength(JSON.stringify(result.state))>300000)throw Error('ALERT_HISTORY_REQUIRES_REVIEW');
        tx.set(observation.ref,result.state);
        for(const event of result.events){
          events.push(event.type==='daily_drop'&&news[index]?{...event,news:news[index]}:event);
        }
      });
      if(!enabled||!events.length)return 0;
      const createdAt=now.toISOString(),rendered=renderAlertEmail({events,context,createdAt});
      tx.create(mailRef,{status:'queued',digestDay,createdAt,attempts:0,firstAttemptAt:null,
        scope:events.map(e=>({symbol:e.symbol,type:e.type,currency:e.currency||null,prices:(e.levels||[]).map(l=>l.price)})),
        idempotencyKey:'cc-digest/'+hash(settings.uid+'/'+digestDay),email:{from:settings.from,to:[settings.to],...rendered}});
      return 1;
    });
  }
  let lastAcceptedAt=null,lastError='';
  if(!dryRun){
    const [currentDigest,pending]=await Promise.all([mailRef.get(),mail.where('status','in',['queued','retry','sending','blocked']).limit(100).get()]);
    for(const doc of [currentDigest,...pending.docs.filter(doc=>doc.id!==mailRef.id)]){
      const token=randomUUID();
      const record=await db.runTransaction(async tx=>{
        const [mail,currentStrategy,currentData]=await Promise.all([tx.get(doc.ref),tx.get(strategyRef),tx.get(dataRef)]),current=mail.data();
        if(!['queued','retry','sending','blocked'].includes(current?.status))return null;
        if(current.digestDay!==digestDay){
          if(current.status==='sending'&&current.leaseUntil>Date.now())return null;
          tx.update(doc.ref,current.deliveryUncertain||current.status==='sending'
            ?{status:'needs_review',code:'PREVIOUS_DIGEST_OUTCOME_UNCONFIRMED'}
            :{status:'cancelled',reason:'Superseded by daily digest schedule'});
          return null;
        }
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
        // Freeze the exact Resend payload before the first attempt. Retries must
        // reuse the scheduled time even if they cross 8 am.
        if(!current.firstAttemptAt&&!current.emailPrepared){
          claimed.email=prepareDigestEmail(current.email,digestDay,Date.now());
          claimed.emailPrepared=true;
        }
        tx.set(doc.ref,claimed);return claimed;
      });
      if(!record)continue;
      let sent;
      for(let attempt=0;attempt<3;attempt++){
        sent=await sendAlertEmail(record.email,record.idempotencyKey,env.PORTFOLIO_ALERT_RESEND_KEY);
        if(sent.status!=='retry')break;
        if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
      }
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
      ...(lastAcceptedAt?{lastAcceptedAt}:{}),lastError,source:'Daily personal GitHub worker; scheduling and quotes may be delayed'}, {merge:true});
  }
  // Public Actions logs contain counts only. No tickers, emails, quotes, payloads,
  // holdings, notes, credentials, news URLs, balances or user IDs.
  console.log(JSON.stringify({mode:dryRun?'dry-run':enabled?'active':'context-only',...counts,marketAvailable}));
  if(counts.deliveryIssues||counts.unavailable||!marketAvailable)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Personal CC alert check could not complete. Verify personal repository settings and private dashboard status. No private data logged.');process.exitCode=1;});
