import {upsert} from './notion-ticker.mjs';
import {initializeApp,cert} from 'firebase-admin/app';
import {getFirestore,FieldPath} from 'firebase-admin/firestore';

const uid=process.env.NOTION_PORTFOLIO_UID?.trim();
if(!uid||uid.includes('/'))throw Error('Configure the personal portfolio UID.');
const account=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if(account.project_id!=='alvissome-portfolio')throw Error('Unexpected Firebase project.');
initializeApp({credential:cert(account)});
const db=getFirestore(),ref=db.doc('users/'+uid+'/portfolio/performance');
const portfolio=await ref.get();
if(!portfolio.exists)throw Error('No portfolio found for the configured owner UID.');
const requests=portfolio.get('settings.investmentStrategy.notionExports')||{};
let attempted=0,synced=0;
for(const [symbol,request] of Object.entries(requests)){
  if(!['queued','Setup needed','Notion HTTP 404','Notion HTTP 403','Notion HTTP 401','Notion HTTP 429','Sync failed'].includes(request.status)&&!/^Notion HTTP 5\d\d$/.test(request.status))continue;
  attempted++;
  let status='Synced';
  try{
    if(!process.env.NOTION_PORTFOLIO_TOKEN)status='Setup needed';
    else await upsert(symbol,request);
  }catch(e){status=/^(Notion HTTP \d{3}|Duplicate ticker rows|Review exceeds Notion limit)$/.test(e.message)?e.message:'Sync failed';}
  if(status==='Synced')synced++;
  const path=new FieldPath('settings','investmentStrategy','notionExports',symbol);
  await db.runTransaction(async tx=>{
    const latest=(await tx.get(ref)).get(path);
    if(latest?.id===request.id&&latest.status!==status){
      const updated={...latest,status};
      if(status==='Synced')delete updated.record;
      tx.update(ref,path,updated);
    }
  });
}
console.log('Notion exports attempted: '+attempted+', confirmed: '+synced);
if(synced<attempted)throw Error('Notion exports still pending. Check the ticker status in My decisions.');
