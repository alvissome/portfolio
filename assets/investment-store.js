// Firebase Auth credentials stay in memory. All writes use the existing user's
// security rules and a version precondition: a stale tab cannot overwrite orders.
// https://firebase.google.com/docs/firestore/reference/rest/v1/Write
function encode(value){
  if(value===null)return {nullValue:null};
  if(typeof value==='string')return {stringValue:value};
  if(typeof value==='boolean')return {booleanValue:value};
  if(typeof value==='number'&&Number.isFinite(value))return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
  if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
  if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,child])=>{
    if(['__proto__','prototype','constructor'].includes(key))throw Error('Invalid saved field.');
    return [key,encode(child)];
  }))}};
  throw Error('Invalid value in investment settings.');
}
function decode(value){
  if(!value)return undefined;
  if('nullValue'in value)return null;
  if('stringValue'in value)return value.stringValue;
  if('booleanValue'in value)return value.booleanValue;
  if('integerValue'in value)return Number(value.integerValue);
  if('doubleValue'in value)return value.doubleValue;
  if(value.arrayValue)return (value.arrayValue.values||[]).map(decode);
  if(value.mapValue)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decode(v)]));
  throw Error('Unsupported value in saved investment settings.');
}
export function createInvestmentStore({projectId,uid,getToken,fetch:request=globalThis.fetch}){
  if(!/^[a-z0-9-]+$/.test(projectId)||!uid||uid.includes('/'))throw Error('Invalid personal portfolio identity.');
  const name=`projects/${projectId}/databases/(default)/documents/users/${uid}/portfolio/performance`;
  const endpoint='https://firestore.googleapis.com/v1/'+name;
  let loaded=false,version=null,busy=false;
  const headers=async()=>({'Authorization':'Bearer '+await getToken(),'Content-Type':'application/json'});
  return {
    async load(){
      if(busy)throw Error('Wait for the current save.');
      const response=await request(endpoint,{headers:await headers(),cache:'no-store'});
      if(response.status===404){version=null;loaded=true;return {};}
      if(!response.ok)throw Error('Could not load investment settings ('+response.status+').');
      const doc=await response.json();version=doc.updateTime;loaded=true;
      if(!version)throw Error('The cloud document has no version.');
      return decode(doc.fields?.settings?.mapValue?.fields?.investmentStrategy)||{};
    },
    async save(strategy){
      if(!loaded)throw Error('Load cloud investment settings before saving.');
      if(busy)throw Error('Wait for the current save.');
      if(new TextEncoder().encode(JSON.stringify(strategy)).length>300000)throw Error('Investment history is approaching its storage limit. Export a backup before adding more records.');
      busy=true;
      try{
        const write={update:{name,fields:{settings:encode({investmentStrategy:strategy})}},updateMask:{fieldPaths:['settings.investmentStrategy']},currentDocument:version?{updateTime:version}:{exists:false}};
        let response;
        try{response=await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`,{method:'POST',headers:await headers(),body:JSON.stringify({writes:[write]})});}catch(e){loaded=false;throw Error('Save outcome is unconfirmed. Reload saved decisions before another action.');}
        if(!response.ok){
          if([409,412].includes(response.status)||response.status===400){const error=await response.json().catch(()=>({}));if([409,412].includes(response.status)||error.error?.status==='FAILED_PRECONDITION'){
            loaded=false;throw Error('Cloud data changed in another tab or device. Reload the Command Centre, review the latest cash and retry. No changes were saved.');
          }}
          throw Error('Investment settings were not saved ('+response.status+').');
        }
        const result=await response.json();version=result.writeResults?.[0]?.updateTime;
        if(!version){loaded=false;throw Error('Save outcome requires confirmation. Reload before another action.');}
      }finally{busy=false;}
    }
  };
}
