import {upsert} from './notion-ticker.mjs';
import {initializeApp,cert} from 'firebase-admin/app';
import {getFirestore,FieldPath} from 'firebase-admin/firestore';

const uid=process.env.NOTION_PORTFOLIO_UID;
if(!uid||uid.includes('/'))throw Error('Configure the personal portfolio UID.');
const account=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if(account.project_id!=='alvissome-portfolio')throw Error('Unexpected Firebase project.');
initializeApp({credential:cert(account)});
const db=getFirestore(),ref=db.doc('users/'+uid+'/portfolio/performance');
const requests=(await ref.get()).get('settings.investmentStrategy.notionExports')||{};
for(const [symbol,request] of Object.entries(requests)){
  if(!['queued','Setup needed'].includes(request.status))continue;
  let status='Synced';
  try{
    if(!process.env.NOTION_PORTFOLIO_TOKEN)status='Setup needed';
    else await upsert(symbol,request);
  }catch(e){status=/^(Notion HTTP \d{3}|Duplicate ticker rows|Review exceeds Notion limit)$/.test(e.message)?e.message:'Sync failed';}
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
