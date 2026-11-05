import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardBackup,readDashboardBackup} from '../assets/dashboard-backup.js';
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
  assert.throws(()=>readDashboardBackup(JSON.stringify({_version:7,state})),/newer dashboard/);
  assert.throws(()=>readDashboardBackup('{}'),/missing holdings/);
  assert.throws(()=>readDashboardBackup('{"__proto__":{"polluted":true}}'),/Invalid field/);
  assert.throws(()=>readDashboardBackup(createDashboardBackup(state,{snapshots:[]})),/Invalid performance snapshots/);
});
