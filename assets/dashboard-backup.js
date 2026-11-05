import {ACCOUNTS,dateKey,todaySG} from './performance-core.js?v=ytd-20261105';

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function validateKeys(value) {
  if(value===null||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(['__proto__','constructor','prototype'].includes(key))throw Error('Invalid field in backup.');
    validateKeys(child);
  }
}

function validateHistory(history) {
  if(!isRecord(history))throw Error('Performance history is missing or invalid.');
  for(const key of ['snapshots','flows','trades','coverage','settings']){
    if(Object.hasOwn(history,key)&&!isRecord(history[key]))throw Error('Invalid performance '+key+' in backup.');
  }
  const today=todaySG();
  const checkDate=date=>{if(dateKey(date)>today)throw Error('Future date in performance backup.');};
  for(const [date,snapshot] of Object.entries(history.snapshots||{})){
    checkDate(date);
    if(!isRecord(snapshot?.accounts)||Object.entries(snapshot.accounts).some(([account,row])=>
      !ACCOUNTS.includes(account)||!isRecord(row)||!Number.isFinite(row.invested)||row.invested<0||
      ['cash','brokerCash','bankCash'].some(key=>row[key]!=null&&!Number.isFinite(row[key]))
    ))throw Error('Invalid snapshot in backup.');
  }
  for(const flow of Object.values(history.flows||{})){
    if(!isRecord(flow)||!ACCOUNTS.includes(flow.account)||typeof flow.kind!=='string'||
      !Number.isFinite(flow.total)||!Number.isFinite(flow.invested))throw Error('Invalid cash movement in backup.');
    checkDate(flow.date);
  }
  for(const periods of Object.values(history.coverage||{})){
    if(!isRecord(periods))throw Error('Invalid reconciliation coverage in backup.');
    for(const coverage of Object.values(periods)){
      checkDate(coverage?.start);
      checkDate(coverage?.end);
      if(coverage.start>coverage.end)throw Error('Invalid reconciliation coverage in backup.');
    }
  }
  return history;
}

// Keep recovery data, but never place third-party credentials in portable backups.
const isSensitiveField = key => /(?:apiKey|secret|token|password|credential|privateKey|publicKey|authorization|accessKey)/i.test(key);
export function withoutCredentials(value) {
  if(Array.isArray(value))return value.map(withoutCredentials);
  if(value===null||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!isSensitiveField(key))
    .map(([key,child])=>[key,withoutCredentials(child)]));
}
export function createDashboardBackup(state,performance) {
  return JSON.stringify({_version:6,_exportDate:new Date().toISOString(),state:withoutCredentials(state),performance:withoutCredentials(performance)},null,2);
}

export function readDashboardBackup(text) {
  const backup=JSON.parse(text);
  if(!isRecord(backup))throw Error('Choose a dashboard backup JSON file.');
  validateKeys(backup);
  if(backup.schema===1&&Object.hasOwn(backup,'history')){
    const history=validateHistory(backup.history);
    // A history-only file may come from a different set of current holdings.
    return {kind:'performance',performance:{...history,settings:{checks:history.settings?.checks||{},dailyEnabled:false}}};
  }
  const state=backup._version?backup.state:backup;
  if(!isRecord(state)||!Array.isArray(state.holdings)||!Array.isArray(state.watchlist)||!isRecord(state.cash)){
    throw Error('The backup is missing holdings, watchlist, or cash data.');
  }
  if(backup._version===6)return {kind:'dashboard',state,performance:validateHistory(backup.performance)};
  if(backup._version>6)throw Error('This backup requires a newer dashboard version.');
  return {kind:'portfolio',state};
}
