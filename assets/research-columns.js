const BASE_COLUMNS=[
 ['symbol','Symbol / Name'],['avg','Avg Price'],['close','Close'],['iv','IV'],['iv-status','IV status'],
 ['sl1','SL1'],['sl2','SL2'],['sl3','SL3'],['sl4','SL4'],['sl5','SL5'],['sl-status','SL status'],['research','Research']
];
export function researchColumns(scope='holdings',fromAk=false){
 if(!['holdings','watchlist'].includes(scope))throw Error('Choose holdings or watchlist research.');
 const columns=BASE_COLUMNS.map(([key,label])=>({key,label:key==='iv'?(fromAk?'AK IV':'Independent IV'):key==='iv-status'&&fromAk?'IV source / date':label}));
 if(scope==='holdings')columns.push({key:'track',label:'Watchlist'});
 return columns;
}
export function normalizeResearchVisibility(value,scope){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid research column settings.');
 const known=new Set(researchColumns(scope).map(c=>c.key)),result={};
 for(const [key,shown]of Object.entries(value))if(known.has(key)&&key!=='symbol'){
  if(typeof shown!=='boolean')throw Error('Research column visibility must be true or false.');
  result[key]=shown;
 }
 return result;
}
export function normalizeResearchColumnSettings(value){
 if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw Error('Invalid saved research column settings.');
 return {holdings:normalizeResearchVisibility(value?.holdings,'holdings'),watchlist:normalizeResearchVisibility(value?.watchlist,'watchlist')};
}
export function visibleResearchColumns(scope,fromAk,visibility){
 const normalized=normalizeResearchVisibility(visibility,scope);
 return researchColumns(scope,fromAk).filter(c=>c.key==='symbol'||normalized[c.key]!==false);
}
