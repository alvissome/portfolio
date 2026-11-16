import test from 'node:test';
import assert from 'node:assert/strict';
import {chartWindow} from '../assets/ticker-chart.js';
import {refreshCharts} from '../.github/scripts/research-price-charts.mjs';
test('chart periods count sessions and clamp calendar month boundaries',()=>{
  const points=['2026-02-28','2026-03-01','2026-07-30','2026-07-31','2026-08-03','2026-08-28','2026-08-31'].map(date=>({date,close:20}));
  assert.equal(chartWindow(points,'5D')[0].date,'2026-07-30');
  assert.equal(chartWindow(points,'1M')[0].date,'2026-07-31');
  assert.equal(chartWindow(points,'6M')[0].date,'2026-02-28');
});
test('shared ticker history is filled once, reused across tabs and retained on failed refresh',async()=>{
  const docs=new Map(),collection={doc:key=>({get:async()=>({data:()=>docs.get(key)}),set:async(v,options)=>docs.set(key,{...(options?.merge?docs.get(key):{}),...v})})};
  const data={holdings:{cashPosition:{ticker:'MSFT',accountType:'Cash'}},watchlist:['MSFT','A','B','C','D','E'].map(symbol=>({symbol}))};
  const history={instrument:{currency:'USD'},history:{source:'test'},bars:[{date:'2026-11-12',close:20}]};
  const fail=()=>{throw Error('Unexpected data call');};
  assert.equal(await refreshCharts(collection,data,new Map([['MSFT',history]]),async()=>history,new Date('2026-11-13')),6);
  await refreshCharts(collection,data,new Map(),fail,new Date('2026-11-13'));
  await refreshCharts(collection,data,new Map(),async()=>null,new Date('2026-11-14'));
  assert.equal(docs.get('tickerChart-MSFT').unavailable,true);
  assert.deepEqual(docs.get('tickerChart-MSFT').points,history.bars);
});
