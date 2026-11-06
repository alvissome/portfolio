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
  assert.equal(r.twrBasis,'cumulative');
  assert.equal(r.twrKpiPct,r.twrPct);
});
test('TWR uses the measured dates even when the requested range is longer',()=>{
  const start='2026-01-03',end='2026-10-30';
  const h={snapshots:{'2024-01-01':{},[start]:snap(100),[end]:snap(121)},flows:{},coverage:{cash:{broker:{start,end}}}};
  const r=calculate(h,'cash','broker','2024-01-01','2026-12-31');
  assert.deepEqual([r.start,r.end],[start,end]);
  assert.equal(r.twrBasis,'cumulative');
  assert.ok(Math.abs(r.twrKpiPct-21)<1e-10);
});

test('a 366-day calendar year is cumulative and the next day is annualized',()=>{
  const start='2023-03-01',anniversary='2024-03-01',end='2024-03-02';
  const h={snapshots:{[start]:snap(100),[anniversary]:snap(121),[end]:snap(121)},flows:{},coverage:{cash:{broker:{start,end}}}};
  const oneYear=calculate(h,'cash','broker',start,anniversary);
  assert.equal(oneYear.twrBasis,'cumulative');
  assert.equal(oneYear.twrKpiPct,oneYear.twrPct);
  const longer=calculate(h,'cash','broker',start,end);
  assert.equal(longer.twrBasis,'annualized');
  assert.ok(Math.abs(longer.twrKpiPct-(1.21**(365.25/367)-1)*100)<1e-10);
  assert.ok(Math.abs(longer.points.at(-1).twrPct-21)<1e-10);
});

test('a February 29 valuation reaches its first anniversary on February 28',()=>{
  const start='2024-02-29',anniversary='2025-02-28',end='2025-03-01';
  const h={snapshots:{[start]:snap(100),[anniversary]:snap(121),[end]:snap(121)},flows:{},coverage:{cash:{broker:{start,end}}}};
  assert.equal(calculate(h,'cash','broker',start,anniversary).twrBasis,'cumulative');
  assert.equal(calculate(h,'cash','broker',start,end).twrBasis,'annualized');
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
  assert.equal(r.twrEstimated,true);
  assert.ok(Number.isFinite(r.xirrPct));
  assert.ok(Number.isFinite(r.twrPct));
});
test('unreconciled periods do not invent return figures',()=>{
  const h={snapshots:{'2025-12-31':snap(100),'2026-12-31':snap(110)},flows:{},coverage:{}};
  const r=calculate(h,'cash','broker','2025-12-31','2026-12-31');
  assert.equal(r.xirrPct,undefined);
  assert.equal(r.twrPct,undefined);
  assert.equal(r.twrKpiPct,undefined);
});
test('TWR chart and thinner gold capital line',()=>{
  const points=[{date:'2025-12-31',value:100,capital:100,twrPct:0},{date:'2026-12-31',value:110,capital:100,twrPct:10}];
  assert.match(chart(points,'twrPct',false),/TWR \(cumulative\): 10\.00%/);
  assert.match(chart(points,'value',false),/stroke="#ab8b50" stroke-width="1\.35"/);
});
