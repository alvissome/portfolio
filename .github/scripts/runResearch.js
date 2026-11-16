import {refreshCharts} from './research-price-charts.mjs';
import {processPublishedTables} from './research-ak-published.mjs';
import {IV_POLICY_VERSION} from '../../assets/valuation-settings.js';
/** Personal-only research queue consumer. No alerts, email or trading actions. */
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchChartHistory,fetchResearchData} from './research-data.mjs';
import {buildSecUserAgent, secContactConfigurationMessage} from './research-http.mjs';
import {processResearchRequest, compareResearch, needsProcessing, sameRequest, resolveReference, prioritizeRequests} from './research-engine.mjs';

export const PERSONAL_PROJECT = 'alvissome-portfolio';
export const LEASE_MS = 8 * 60 * 1000;
export const MAX_RESEARCH_JOBS = 24;
export const RESEARCH_CLAIM_WINDOW_MS = 10 * 60 * 1000;

export function canClaimResearchJob(claimed, startedAt, now = Date.now()) {
  return Number.isInteger(claimed) && claimed >= 0 && claimed < MAX_RESEARCH_JOBS &&
    Number.isFinite(startedAt) && Number.isFinite(now) && now >= startedAt &&
    now - startedAt < RESEARCH_CLAIM_WINDOW_MS;
}

// Recover old terminal SEC access failures once after contact setup.
// The marker prevents repeated retries if SEC still rejects this runner.
export function prepareSecRecovery(record, contactConfigured) {
  if (!contactConfigured || record?.secContactRecovery === 'contact-v1' ||
      record?.phase !== 'finished' || record?.iv?.result) return record;
  const diagnostics = [record.iv?.reason, ...(record.dataWarnings || [])].join(' ');
  if (!/SEC_(?:SUBMISSIONS|TICKERS|FACTS)_HTTP_403/.test(diagnostics)) return record;
  return {...record, secContactRecovery:'contact-v1', phase:'requested',
    workerAcknowledged:false, leaseToken:null, leaseUntil:null,
    iv:{...record.iv,processing:'not_started'}};
}

export function prepareValuationUpgrade(record) {
  if(record?.phase!=='finished'||record.ivPolicyVersion===IV_POLICY_VERSION)return record;
  return {...record,ivPolicyVersion:IV_POLICY_VERSION,phase:'requested',
    workerAcknowledged:false,leaseToken:null,leaseUntil:null,
    iv:{...record.iv,result:null,previousResult:record.iv?.result||record.iv?.previousResult||null,processing:'not_started'}};
}

export function claimRecord(current, now, leaseToken) {
  if (!needsProcessing(current, now)) return null;
  return {...current, workerAcknowledged: true, leaseToken,
    leaseUntil: new Date(now + LEASE_MS).toISOString(), startedAt: new Date(now).toISOString(),
    attempts: (Number.isInteger(current.attempts) ? current.attempts : 0) + 1, phase: 'fetching',
    iv: {...current.iv, processing: 'processing', reason: null},
    supports: {...current.supports, processing: 'processing', reason: null}};
}

/** Preserve current request and reference fields. Only a claimed server result
 * is written, so import/reference edits cannot be reverted by old work. */
export function mergeProgress(current, expected, incoming, leaseToken) {
  if (!sameRequest(current, expected) || current.leaseToken !== leaseToken) return null;
  const next = {...current};
  for (const key of ['workerAcknowledged', 'startedAt', 'phase', 'instrument', 'iv', 'supports',
    'finishedAt', 'sourceRetrievedAt', 'dataWarnings']) {
    if (Object.hasOwn(incoming, key)) next[key] = incoming[key];
  }
  if (incoming.phase === 'finished') {
    next.leaseToken = null;
    next.leaseUntil = null;
    next.comparison = compareResearch(next);
  }
  return next;
}

async function main() {
  const runStartedAt = Date.now();
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && !process.argv.includes('--process')) throw new Error('Explicit process or dry-run mode is required');
  const secUserAgent = buildSecUserAgent(process.env.SEC_CONTACT_EMAIL);
  let serviceAccount;
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ''); }
  catch { throw new Error('Personal research credentials are missing or invalid'); }
  if (serviceAccount.project_id !== PERSONAL_PROJECT ||
      (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== PERSONAL_PROJECT)) {
    throw new Error('Unexpected Firebase project; personal research stopped');
  }
  const [{initializeApp, cert}, {getFirestore, FieldPath}] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore'),
  ]);
  initializeApp({credential: cert(serviceAccount), projectId: PERSONAL_PROJECT});
  const db = getFirestore();
  const {GoogleAuth}=await import('google-auth-library');
  const sheetsAuth=new GoogleAuth({credentials:serviceAccount,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const getSheetsToken=()=>sheetsAuth.getAccessToken();
  const userRefs = await db.collection('users').listDocuments();
  const counters = {portfolios: 0, pending: 0, claimed: 0, completed: 0, partial: 0, failed: 0, staleDiscarded: 0, ivMethods: {}, ivUnavailable: {}};
  for (const user of userRefs) {
    const ref = user.collection('portfolio').doc('data');
    const snap = await ref.get();
    if (!snap.exists) continue;
    counters.portfolios++;
    if (!dryRun && snap.data().akPublishedTableRequest?.id) {
      await processPublishedTables(db, ref, snap.data().akPublishedTableRequest, FieldPath, getSheetsToken);
    }
    const researchHistories=new Map();
    const requests = prioritizeRequests(Object.entries(snap.data().researchBySecurity || {}).filter(([,record]) => needsProcessing(prepareValuationUpgrade(prepareSecRecovery(record, !!process.env.SEC_CONTACT_EMAIL)))));
    counters.pending += requests.length;
    for (const [symbol, observed] of requests) {
      if (!canClaimResearchJob(counters.claimed, runStartedAt)) break;
      if (symbol !== observed.symbol) continue;
      if (dryRun) continue;
      const leaseToken = randomUUID();
      const claimed = await db.runTransaction(async transaction => {
        if (!canClaimResearchJob(counters.claimed, runStartedAt)) return null;
        const fresh = await transaction.get(ref);
        const data = fresh.data();
        const current = data?.researchBySecurity?.[symbol];
        if (!sameRequest(current, observed)) return null;
        if (!canClaimResearchJob(counters.claimed, runStartedAt)) return null;
        const reference = resolveReference(current, data.researchReferenceSnapshotMeta);
        const retry = prepareValuationUpgrade(prepareSecRecovery(current, !!process.env.SEC_CONTACT_EMAIL));
        const record = claimRecord({...retry, ...(reference ? {reference} : {})}, Date.now(), leaseToken);
        if (!record) return null;
        transaction.update(ref, new FieldPath('researchBySecurity', symbol), record);
        return record;
      });
      if (!claimed) continue;
      counters.claimed++;
      const persist = async incoming => db.runTransaction(async transaction => {
        const fresh = await transaction.get(ref);
        const record = mergeProgress(fresh.data()?.researchBySecurity?.[symbol], claimed, incoming, leaseToken);
        if (!record) return false;
        transaction.update(ref, new FieldPath('researchBySecurity', symbol), record);
        return true;
      });
      try {
        const output = await processResearchRequest(claimed, {
          fetchData: async (ticker, options) => {
            const result=await fetchResearchData(ticker, {...options,
            twelveDataKey: process.env.TWELVE_DATA_KEY,
            secUserAgent});
            if(options.asOf===new Date().toISOString().slice(0,10) && result.bars.length)researchHistories.set(ticker,result);
            return result;
          },
          progress: persist,
        });
        if (!await persist(output)) {counters.staleDiscarded++; continue;}
        const method=output.iv.result?.methodId;
        if(method)counters.ivMethods[method]=(counters.ivMethods[method]||0)+1;
        else {const code=output.iv.code||output.iv.processing;counters.ivUnavailable[code]=(counters.ivUnavailable[code]||0)+1;}
        const completed = [output.iv.processing, output.supports.processing].filter(state => state === 'completed').length;
        if (completed === 2) counters.completed++;
        else if (completed === 1 || output.iv.validation === 'not_applicable' && output.supports.processing === 'completed') counters.partial++;
        else counters.failed++;
      } catch {
        // An unexpected calculator/provider error must end visibly without
        // exposing request data, provider URLs, secrets or user identities.
        const part = {processing: 'failed', validation: 'experimental', result: null,
          reason: 'Research calculation failed. Retry is available.', code: 'research_failed'};
        const previous = name => ({...part,
          ...(claimed[name]?.result || claimed[name]?.previousResult ? {previousResult: claimed[name].result || claimed[name].previousResult} : {})});
        await persist({...claimed, phase: 'finished', finishedAt: new Date().toISOString(), iv: previous('iv'), supports: previous('supports')});
        counters.failed++;
      }
    }
    if(!dryRun && Date.now()-runStartedAt<RESEARCH_CLAIM_WINDOW_MS) {
      await refreshCharts(user.collection("portfolio"),snap.data(),researchHistories,
        symbol=>fetchChartHistory(symbol,{twelveDataKey:process.env.TWELVE_DATA_KEY}));
    }
  }
  console.log(JSON.stringify({mode: dryRun ? 'dry-run' : 'process', ...counters}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {console.error(secContactConfigurationMessage(error) ||
    'Personal research worker failed; no request details logged.'); process.exitCode = 1;});
}
