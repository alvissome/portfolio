import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardBackup,readDashboardBackup,prepareResearchRestore} from '../assets/dashboard-backup.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {needsProcessing,sameRequest} from '../.github/scripts/research-engine.mjs';
import {mergeProgress} from '../.github/scripts/runResearch.js';
import {calculate,makeFlow} from '../assets/performance-core.js';

const date='2025-12-31',end='2026-01-02';
const state={holdings:[{ticker:'TEST',shares:2}],watchlist:[{symbol:'TEST'}],cash:{brokers:10},lastDailySync:{lastMetaAlertSent:12}};
const history={
  snapshots:{
    [date]:{accounts:{cash:{invested:100,cash:10,brokerCash:10,verified:true}}},
    [end]:{accounts:{cash:{invested:110,cash:15,brokerCash:15,verified:true}}}
  },
  flows:{funding:makeFlow({id:'funding',date:end,account:'cash',kind:'contribution',amount:5})},
  coverage:{cash:{broker:{start:date,end}}},
  trades:{},
  settings:{dailyEnabled:true,capture:{cash:{reconciledOn:end,sourceSignature:'signature',holdings:[]}}}
};

test('one dashboard backup preserves portfolio state, history and returns',()=>{
  const restored=readDashboardBackup(createDashboardBackup(state,history));
  assert.deepEqual(restored,{kind:'dashboard',state,performance:history});
  const result=calculate(restored.performance,'cash','broker',date,end);
  assert.equal(result.netFlow,5);
  assert.equal(result.gain,10);
  assert.deepEqual(readDashboardBackup(createDashboardBackup(state,{})).performance,{});
});

test('older portfolio and performance backups use their own restore scopes',()=>{
  assert.deepEqual(readDashboardBackup(JSON.stringify({_version:5,state})),{kind:'portfolio',state});
  assert.deepEqual(readDashboardBackup(JSON.stringify(state)),{kind:'portfolio',state});
  const restored=readDashboardBackup(JSON.stringify({schema:1,history}));
  assert.equal(restored.kind,'performance');
  assert.deepEqual(restored.performance.coverage,history.coverage);
  assert.equal(restored.performance.settings.dailyEnabled,false);
  assert.equal(restored.performance.settings.capture,undefined);
});

test('incomplete and unrelated files fail before choosing a restore scope',()=>{
  assert.throws(()=>readDashboardBackup(JSON.stringify({_version:6,state})),/Performance history/);
  assert.throws(()=>readDashboardBackup(JSON.stringify({_version:8,state})),/newer dashboard/);
  assert.throws(()=>readDashboardBackup('{}'),/missing holdings/);
  assert.throws(()=>readDashboardBackup('{"__proto__":{"polluted":true}}'),/Invalid field/);
  assert.throws(()=>readDashboardBackup(createDashboardBackup(state,{snapshots:[]})),/Invalid performance snapshots/);
});


test('portable dashboard backup excludes API credentials but preserves holdings and history',()=>{
  const withSecrets={...state,emailSettings:{
    email:'user@example.com',digestTime:'08:00',
    twelveDataKey:'test-twelve-secret',fmpApiKey:'test-fmp-secret',
    emailjsPublicKey:'test-emailjs-public',
    emailjsServiceId:'service-example',emailjsTemplateId:'template-example'
  },nested:{accessToken:'test-access-token',credentials:{password:'test-password'}}};
  const serialized=createDashboardBackup(withSecrets,history);
  for(const marker of ['test-twelve-secret','test-fmp-secret','test-emailjs-public','test-access-token','test-password']){
    assert.equal(serialized.includes(marker),false);
  }
  const restored=readDashboardBackup(serialized);
  assert.equal(restored.kind,'dashboard');
  assert.deepEqual(restored.performance,history);
  assert.deepEqual(restored.state.holdings,state.holdings);
  assert.equal(restored.state.emailSettings.email,'user@example.com');
  assert.equal(restored.state.emailSettings.emailjsServiceId,'service-example');
  assert.equal(restored.state.emailSettings.twelveDataKey,undefined);
  assert.equal(withSecrets.emailSettings.twelveDataKey,'test-twelve-secret');
});

const research={records:{EXAMPLE:{securityId:'EXAMPLE',symbol:'EXAMPLE',requestId:'old-request',modelVersion:'ak-reconstruction-v1',
  workerAcknowledged:true,leaseToken:'old-claim-token',leaseUntil:'2026-11-12T08:00:00Z',phase:'calculating',
  instrument:{name:'Example Company',currency:'USD'},
  iv:{processing:'completed',result:{value:20,method:'Example DCF',source:'Fixture',asOf:'2026-11-03'}},
  supports:{processing:'processing',previousResult:{value:[18,16],method:'Fixture chart',source:'Fixture',asOf:'2026-11-03'}},
  reference:{present:true,snapshotId:'adam-example',asOf:'2026-11-03',iv:{value:20},supports:[18,16]},
  comparison:{iv:{status:'matched',snapshotId:'adam-example',referenceAsOf:'2026-11-03'}}},
  REFERENCE:{securityId:'REFERENCE',symbol:'REFERENCE',reference:{present:false,snapshotId:'adam-example'}}},
  referenceMeta:{id:'adam-example',dates:['2026-11-03'],complete:true,coveredMarkets:['US','SG','HK']}};

test('v7 complete backups preserve research results, references and snapshot provenance without portable credentials',()=>{
  const privateResearch=structuredClone(research);
  privateResearch.records.EXAMPLE.instrument.apiKey='test-research-key';
  privateResearch.referenceMeta.accessToken='test-research-token';
  const serialized=createDashboardBackup(state,history,privateResearch);
  const raw=JSON.parse(serialized);
  assert.equal(raw._version,7);
  for(const secret of ['test-research-key','test-research-token','old-claim-token'])assert.equal(serialized.includes(secret),false);
  const restored=readDashboardBackup(serialized);
  assert.deepEqual(restored.state,state);
  assert.deepEqual(restored.performance,history);
  assert.deepEqual(restored.research.records.EXAMPLE.iv,research.records.EXAMPLE.iv);
  assert.deepEqual(restored.research.records.EXAMPLE.reference,research.records.EXAMPLE.reference);
  assert.deepEqual(restored.research.referenceMeta,research.referenceMeta);
  assert.equal(JSON.parse(createDashboardBackup(state,history))._version,6,'two-argument exports keep the established format');
});

test('restoring saved research retains findings but pauses unfinished work and invalidates old worker claims',()=>{
  let serial=0;
  const before=structuredClone(research);
  const restored=prepareResearchRestore(research,{requestId:()=>`new-${++serial}`,restoredAt:'2026-11-12T09:00:00Z'});
  const current=restored.records.EXAMPLE;
  assert.equal(current.requestId,'restore-new-1');
  assert.equal(current.workerAcknowledged,false);
  assert.equal(current.leaseToken,null);
  assert.equal(current.leaseUntil,null);
  assert.equal(current.phase,'restored');
  assert.equal(current.supports.processing,'blocked');
  assert.match(current.supports.reason,/Paused after backup restore/);
  assert.deepEqual(current.supports.previousResult,research.records.EXAMPLE.supports.previousResult);
  assert.deepEqual(current.iv,research.records.EXAMPLE.iv,'completed IV and provenance remain available');
  assert.deepEqual(current.reference,research.records.EXAMPLE.reference);
  assert.equal(needsProcessing(current),false,'paused research does not get claimed automatically');
  assert.equal(sameRequest(current,research.records.EXAMPLE),false);
  assert.equal(mergeProgress(current,research.records.EXAMPLE,{...research.records.EXAMPLE,phase:'finished'},'old-claim-token'),null,
    'an old in-flight worker cannot overwrite restored findings');
  assert.equal(Object.hasOwn(restored.records.REFERENCE,'requestId'),false,'reference-only records remain reference-only');
  assert.deepEqual(research,before,'restore preparation does not mutate the uploaded backup');
});

test('invalid research sections fail before restore while v6 files continue to have no research restore scope',()=>{
  assert.throws(()=>readDashboardBackup(JSON.stringify({_version:7,state,performance:history})),/Research data/);
  assert.throws(()=>readDashboardBackup(JSON.stringify({_version:7,state,performance:history,research:{records:[]}})),/Research data/);
  assert.throws(()=>readDashboardBackup(JSON.stringify({_version:7,state,performance:history,research:{records:{WRONG:{symbol:'OTHER',securityId:'OTHER'}}}})),/research security/);
  assert.equal(Object.hasOwn(readDashboardBackup(createDashboardBackup(state,history)),'research'),false);
});

test('the existing compiled Export Backup reads research privately and keeps the same download control',async()=>{
  const bundle=readFileSync(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
  const start=bundle.indexOf('async function exportDashboardBackup('),end=bundle.indexOf('async function restoreDashboardBackup(',start);
  let downloaded,clicked=false;
  const reads=[];
  const context={
    PR:async ref=>{reads.push(ref.path);return {metadata:{fromCache:false},exists:()=>true,
      data:()=>ref.path==='history'?history:{researchBySecurity:research.records,researchReferenceSnapshotMeta:research.referenceMeta}};},
    performanceRef:()=>({path:'history'}),qT:()=>({path:'portfolio'}),Xl:{currentUser:{uid:'private-test-user'}},
    createDashboardBackup,Blob,
    URL:{createObjectURL:blob=>{downloaded=blob;return 'blob:private-test';},revokeObjectURL:()=>{}},
    document:{createElement:()=>({click:()=>{clicked=true;}})},setTimeout:()=>0,
  };
  runInNewContext(`${bundle.slice(start,end)};this.exportBackup=exportDashboardBackup;`,context);
  await context.exportBackup('private-test-user',state);
  assert.deepEqual(reads.sort(),['history','portfolio']);
  assert.equal(clicked,true);
  const parsed=readDashboardBackup(await downloaded.text());
  assert.deepEqual(parsed.research.records.EXAMPLE.reference,research.records.EXAMPLE.reference);
  assert.deepEqual(parsed.performance,history);
});

test('the compiled restore includes research atomically only when present in the backup',async()=>{
  const bundle=readFileSync(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
  const start=bundle.indexOf('async function restoreDashboardBackup('),end=bundle.indexOf('const restoreMessages=',start);
  let committed;
  const context={
    Xl:{currentUser:{uid:'private-test-user'}},In:{cash:{}},Zm:value=>value,OR:value=>value,
    BR:value=>({holdings:value.holdings,watchlist:value.watchlist,cashPositions:value.cash}),
    CR:()=>123,prepareResearchRestore:value=>prepareResearchRestore(value,{requestId:()=> 'restored',restoredAt:'2026-11-12T09:00:00Z'}),
    qT:()=>({_key:'portfolio'}),performanceRef:()=>({_key:'history'}),WT:{},_R:()=>({}),xn:{none:()=>null},
    wR:(parser,method,key,data,converter,options)=>({toMutation:()=>({key,data,options})}),
    NR:async(db,mutations)=>{committed=mutations;},
  };
  runInNewContext(`${bundle.slice(start,end)};this.restoreBackup=restoreDashboardBackup;`,context);
  const v7=readDashboardBackup(createDashboardBackup(state,history,research));
  await context.restoreBackup('private-test-user',v7);
  assert.equal(committed.length,2,'portfolio, research and history share the existing atomic commit');
  assert.equal(committed[0].data.researchBySecurity.EXAMPLE.supports.processing,'blocked');
  assert.equal(committed[0].data.researchBySecurity.EXAMPLE.requestId,'restore-restored');
  assert.ok(committed[0].options.mergeFields.includes('researchBySecurity'),'the research map is replaced as a complete restored field');
  assert.deepEqual(committed[0].data.researchReferenceSnapshotMeta,research.referenceMeta);
  assert.deepEqual(committed[1].data,history);
  await context.restoreBackup('private-test-user',readDashboardBackup(createDashboardBackup(state,history)));
  assert.equal(Object.hasOwn(committed[0].data,'researchBySecurity'),false,'older v6 backup leaves current research untouched');
  assert.equal(Object.hasOwn(committed[0].data,'researchReferenceSnapshotMeta'),false);
});

test('the existing restore action quiesces research before committing and resumes it only on failure',async()=>{
  const bundle=readFileSync(new URL('../assets/index-CUEh86Kk.js',import.meta.url),'utf8');
  const start=bundle.indexOf('I=async()=>{',bundle.indexOf('function MN('));
  const end=bundle.indexOf('};return f?',start);
  assert.ok(start>=0&&end>start);
  const action=bundle.slice(start+'I=async()=>'.length,end+1);
  const events=[];
  let fail=false;
  const context={r:{kind:'dashboard'},n:{uid:'private-test-user'},restoring:{current:false},
    setRestoreBusy:value=>events.push(`busy:${value}`),
    research:{pause:async()=>events.push('quiesced'),resume:async()=>events.push('resumed')},
    restoreDashboardBackup:async()=>{events.push('committed');if(fail)throw Error('fixture failure');},
    alert:()=>{},window:{location:{reload:()=>events.push('reload')}}};
  runInNewContext(`this.restoreAction=async()=>${action};`,context);
  await context.restoreAction();
  assert.deepEqual(events,['busy:true','quiesced','committed','reload']);
  assert.equal(context.restoring.current,true,'successful restore stays quiesced until reload');
  events.length=0;context.restoring.current=false;fail=true;
  await context.restoreAction();
  assert.deepEqual(events,['busy:true','quiesced','committed','busy:false','resumed']);
  assert.equal(context.restoring.current,false);
});
