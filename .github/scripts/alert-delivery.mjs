// Immutable messages plus a durable provider key. Never retry an ambiguous send
// after the provider's 24-hour idempotency window has elapsed.
export const SAFE_RETRY_MS=23*3600000;
export function prepareDigestEmail(email,digestDay,now=Date.now()){
  const sendAt=Date.parse(digestDay+'T08:00:00+08:00');
  // Give the provider time to accept the request before its scheduled time.
  return sendAt-now>=60000?{...email,scheduled_at:new Date(sendAt).toISOString()}:email;
}
export function deliveryDecision(record,now=Date.now()){
  if(!['queued','retry','sending','blocked'].includes(record?.status))return 'skip';
  if(!record.firstAttemptAt&&now-Date.parse(record.createdAt)>24*3600000)return 'expire';
  if(record.status==='sending'&&record.leaseUntil>now)return 'skip';
  if(record.nextAttemptAt>now)return 'skip';
  if(record.firstAttemptAt&&now-record.firstAttemptAt>=SAFE_RETRY_MS)return 'review';
  if((record.attempts||0)>=4&&record.status!=='blocked')return 'review';
  return 'send';
}
export async function sendAlertEmail(email,key,apiKey,{fetch:fetchImpl=globalThis.fetch}={}){
  if(!apiKey||!email?.to?.length)throw Error('EMAIL_SETUP_NEEDED');
  let response;
  try{response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(email),signal:AbortSignal.timeout(20000),redirect:'error'});}
  catch{return {status:'retry',uncertain:true,code:'NETWORK_UNCONFIRMED'};}
  if(!response.ok)return response.status>=500||response.status===429||response.status===409?{status:'retry',uncertain:true,code:'EMAIL_HTTP_'+response.status}:{status:'blocked',uncertain:false,code:'EMAIL_HTTP_'+response.status};
  const body=await response.json().catch(()=>null);
  return body?.id?{status:'accepted',id:body.id}:{status:'retry',uncertain:true,code:'EMAIL_OUTCOME_UNCONFIRMED'};
}
