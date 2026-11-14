import {normalizeResearchColumnSettings} from './research-columns.js';
import {normalizeStrategyCategories} from './strategy-categories.js';
import {ACCOUNTS,dateKey,todaySG} from './performance-core.js?v=ytd-20261105';
import {normalizeAkSourceSettings} from './ak-sheet-sources.js';

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
const isSensitiveField = key => /(?:apiKey|dataKey|secret|token|password|credential|privateKey|publicKey|authorization|accessKey)/i.test(key);
export function withoutCredentials(value) {
  if(Array.isArray(value))return value.map(withoutCredentials);
  if(value===null||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!isSensitiveField(key))
    .map(([key,child])=>[key,withoutCredentials(child)]));
}
function validateResearch(research) {
  if(!isRecord(research)||!isRecord(research.records)||
    research.referenceMeta!=null&&!isRecord(research.referenceMeta))throw Error('Research data is missing or invalid.');
  if(Object.hasOwn(research,'sourceSettings')){
    if(!isRecord(research.sourceSettings))throw Error('Invalid sheet-source settings in backup.');
    normalizeAkSourceSettings(research.sourceSettings);
  }
  if(Object.hasOwn(research,'syncStatus')&&research.syncStatus!==null&&!isRecord(research.syncStatus))throw Error('Invalid sheet sync status in backup.');
  for(const [symbol,record] of Object.entries(research.records)){
    if(!/^[A-Za-z0-9^][A-Za-z0-9.^=:_-]{0,39}$/.test(symbol)||!isRecord(record)||
      record.symbol!==symbol||record.securityId!==symbol)throw Error('Invalid research security in backup.');
    for(const part of ['iv','supports']){
      if(record[part]!=null&&!isRecord(record[part]))throw Error('Invalid research result in backup.');
      for(const key of ['result','previousResult'])if(record[part]?.[key]!=null&&!isRecord(record[part][key])){
        throw Error('Invalid research result in backup.');
      }
    }
    if(record.reference!=null&&!isRecord(record.reference))throw Error('Invalid research reference in backup.');
  }
  return research;
}

export function createDashboardBackup(state,performance,research) {
  // Keep the existing v6 shape for callers and older files without research.
  const backup={_version:research===undefined?6:7,_exportDate:new Date().toISOString(),
    state:withoutCredentials(state),performance:withoutCredentials(performance)};
  if(research!==undefined)backup.research=withoutCredentials(validateResearch(research));
  return JSON.stringify(backup,null,2);
}

/** Completed findings stay available. An old execution lease is never resumed
 * from a portable file: fresh request identities invalidate already-running
 * workers, and unfinished parts pause until the user recalculates them.
 */
export function prepareResearchRestore(research,{requestId=()=>crypto.randomUUID(),
  restoredAt=new Date().toISOString()}={}) {
  const restored=withoutCredentials(validateResearch(research));
  const records={};
  for(const [symbol,saved] of Object.entries(restored.records)){
    const record={...saved};
    if(record.requestId){
      record.requestId=`restore-${requestId()}`;
      record.workerAcknowledged=false;
      record.acknowledgedAt=null;
      record.startedAt=null;
      record.leaseToken=null;
      record.leaseUntil=null;
      record.restoredAt=restoredAt;
      const unfinished=['iv','supports'].filter(part=>['not_started','queued','processing'].includes(record[part]?.processing));
      for(const part of unfinished)record[part]={...record[part],processing:'blocked',
        reason:'Paused after backup restore. Recalculate to request fresh research.'};
      if(unfinished.length){record.phase='restored';record.finishedAt=null;record.completedAt=null;}
    }
    records[symbol]=record;
  }
  return {records,referenceMeta:restored.referenceMeta??null,
    ...(Object.hasOwn(restored,'sourceSettings')?{sourceSettings:restored.sourceSettings}:{}),
    ...(Object.hasOwn(restored,'syncStatus')?{syncStatus:restored.syncStatus}:{})};
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
  if(Object.hasOwn(state,'researchColumnVisibility'))normalizeResearchColumnSettings(state.researchColumnVisibility);
  if(Object.hasOwn(state,'strategyCategories'))normalizeStrategyCategories(state.strategyCategories);
  if(backup._version===6)return {kind:'dashboard',state,performance:validateHistory(backup.performance)};
  if(backup._version===7)return {kind:'dashboard',state,performance:validateHistory(backup.performance),research:validateResearch(backup.research)};
  if(backup._version>7)throw Error('This backup requires a newer dashboard version.');
  return {kind:'portfolio',state};
}
