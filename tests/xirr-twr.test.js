import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,makeFlow,datedXirr,linkedTimeWeighted} from '../assets/performance-core.js';
import {chart} from '../assets/performance-panel.js';

const snap=value=>({accounts:{cash:{invested:value,brokerCash:0,cash:0,verified:true}}});
const coverage={cash:{broker:{start:'2025-12-31',end:'2026-12-31'}}};
test('no contribution: money-weighted annual return equals one-year TWR',()=>{
  const h={snapshots:{'2025-12-31':snap(100),'2026-12-31':snap(110)},flows:{},coverage};
  const r=calculate(h,'cash','broker','2025-12-31','2026-12-31');
  assert.ok(Math.abs(r.xirrPct-10)<0.05);
  assert.ok(Math.abs(r.twrPct-10)<1e-10);
  assert.equal(r.gain,10);
});
test('a deposit is not counted as investment gain and XIRR accounts for its timing',()=>{
  const f=makeFlow({id:'d',date:'2026-07-01',account:'cash',kind:'contribution',amount:100});
  const h={snapshots:{'2025-12-31':snap(100),'2026-07-01':snap(210),'2026-12-31':snap(231)},flows:{d:f},coverage};
  const r=calculate(h,'cash','broker','2025-12-31','2026-12-31');
  assert.equal(r.gain,31);
  assert.ok(r.xirrPct>15&&r.xirrPct<30);
  assert.ok(Math.abs(r.twrPct-21)<1e-8);
});
test('no valuation on contribution date labels linked TWR estimate',()=>{
  const f=makeFlow({id:'d',date:'2026-07-01',account:'cash',kind:'contribution',amount:100});
  const h={snapshots:{'2025-12-31':snap(100),'2026-12-31':snap(231)},flows:{d:f},coverage};
  const r=calculate(h,'cash','broker','2025-12-31','2026-12-31');
  assert.match(r.twrMethod,/Estimated/);
  assert.ok(Number.isFinite(r.xirrPct));
  assert.ok(Number.isFinite(r.twrPct));
});
test('unreconciled periods do not invent return figures',()=>{
  const h={snapshots:{'2025-12-31':snap(100),'2026-12-31':snap(110)},flows:{},coverage:{}};
  const r=calculate(h,'cash','broker','2025-12-31','2026-12-31');
  assert.equal(r.xirrPct,undefined);
  assert.equal(r.twrPct,undefined);
});
test('TWR chart and thinner gold capital line',()=>{
  const points=[{date:'2025-12-31',value:100,capital:100,twrPct:0},{date:'2026-12-31',value:110,capital:100,twrPct:10}];
  assert.match(chart(points,'twrPct',false),/TWR: 10\.00%/);
  assert.match(chart(points,'value',false),/stroke="#ab8b50" stroke-width="1\.35"/);
});
