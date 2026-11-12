import test from 'node:test';
import assert from 'node:assert/strict';
import {dcf20, justifiedPB, calculateIV, calculateSupports, historicalPB} from '../.github/scripts/research-calculations.mjs';

test('20-year arithmetic matches worked teaching examples without a terminal value', () => {
  const base = {fcf0:8403,g1:.509,g3:.04,discountRate:.0797,cash:13122,debt:3226,shares:1659};
  assert.equal(dcf20({...base,g2:.25}).value.toFixed(2), '757.00');
  assert.equal(dcf20({...base,g2:.15}).value.toFixed(2), '549.99');
  const msft = dcf20({fcf0:101030.4,g1:.1748,g2:.15,g3:.04,discountRate:.0661,cash:102012,debt:43208,shares:7466});
  assert.ok(Math.abs(msft.value - 518.98220737725239) < 1e-8);
  assert.equal(msft.schedule.length,20);
});

const annual = [2021,2022,2023,2024,2025].map((year,index)=>({end:`${year}-12-31`,cfo:100+index*10,capex:20,netIncome:60+index*5,equity:500+index*20,shares:10}));
const fundamentals = {source:'Fixture filings',asOf:'2026-01-31',financialCurrency:'USD',listingSharesVerified:true,annual,ttm:{cfo:150,capex:20,netIncome:85,cash:100,totalDebt:50,shares:10,equity:600}};
test('independent IV runs without any Adam reference and discloses historical assumptions',()=>{
  const result=calculateIV({instrument:{type:'EQUITY',currency:'USD',methodFamily:'stock'},fundamentals}, {}, '2026-02-01');
  assert.equal(result.processing,'completed');
  assert.equal(result.validation,'experimental');
  assert.ok(result.result.value>0);
  assert.ok(result.result.assumptions.some(value=>value.includes('not current or historical analyst consensus')));
  assert.equal(result.result.asOf,'2026-02-01');
  assert.equal(result.result.financialInputs.annual.length,5);
  assert.equal(result.result.financialInputs.ttm.cfo,150);
  assert.ok(JSON.stringify(result.result.financialInputs).length<=2048);
});
test('missing cash is not assumed zero; unmatched currencies and ETFs do not get fake IVs',()=>{
  const data={instrument:{type:'EQUITY',currency:'USD'},fundamentals:{...fundamentals,ttm:{...fundamentals.ttm,cash:null}}};
  assert.equal(calculateIV(data).processing,'unavailable');
  assert.equal(calculateIV({...data,instrument:{currency:'SGD'}}).code,'currency_mapping_required');
  const fund=calculateIV({...data,instrument:{type:'ETF'}});
  assert.equal(fund.validation,'not_applicable');
  assert.equal(fund.result,null);
});
test('bank/REIT methods retain independent variants and do not label unadjusted equity tangible book',()=>{
  const bars=annual.map(row=>({date:row.end,close:120}));
  const data={instrument:{type:'EQUITY',currency:'USD'},bars,history:{splitEventsComplete:true,splitEvents:[],adjustmentVintageVerified:true},fundamentals:{...fundamentals,dividendPerShareTTM:3}};
  const result=calculateIV(data,{methodFamily:'bank'});
  assert.equal(result.processing,'completed');
  assert.deepEqual(result.result.variants.map(row=>row.key),['yield_5pct','historical_pb','justified_pb']);
  assert.equal(result.result.variants[0].value,60);
  assert.equal(historicalPB(annual,bars).observations.length,5);
  assert.equal(historicalPB(annual,bars,[{date:'2023-06-01',numerator:2,denominator:1}]),null);
  assert.ok(!calculateIV({...data,history:{...data.history,adjustmentVintageVerified:false}}, {methodFamily:'bank'}).result.variants.some(row=>row.key==='historical_pb'));
  assert.ok(Math.abs(justifiedPB({bookValuePerShare:100,roe:.15,growth:.04,costOfEquity:.095}).value-200)<1e-10);
});
test('unverified ADR denominators and unknown model families block IV',()=>{
  const adr={instrument:{type:'ADR',currency:'USD',methodFamily:'stock'},fundamentals:{...fundamentals,listingSharesVerified:undefined}};
  assert.equal(calculateIV(adr).code,'share_mapping_required');
  assert.equal(calculateIV({instrument:{type:'EQUITY',currency:'USD'},fundamentals}).code,'method_family_required');
});

function history() {
  const rows=[];
  for(let i=0;i<3000;i++){
    const day=new Date(Date.UTC(2015,0,1)+i*86400000);
    if([0,6].includes(day.getUTCDay()))continue;
    const close=100+i*.02+5*((i%100)/100);
    rows.push({date:day.toISOString().slice(0,10),open:close,high:close+1,low:close-1,close});
  }
  return rows;
}
test('support calculations cannot see future bars and do not require IV or Adam coverage',()=>{
  const bars=history(),asOf='2022-01-03';
  const a=calculateSupports({bars,historySource:'Fixture daily bars'},{},asOf);
  const b=calculateSupports({bars:bars.filter(row=>row.date<=asOf),historySource:'Fixture daily bars'},{},asOf);
  assert.deepEqual(a,b);
  assert.equal(a.processing,'completed');
  assert.ok(a.result.value.length>0&&a.result.value.length<=5);
  assert.equal(a.result.ivFilterApplied,false);
  assert.ok(a.result.value.every((value,index)=>!index||value<a.result.value[index-1]));
});
test('support levels above IV remain unless the filter is explicitly enabled',()=>{
  const lows=[110,105,90,104,112,115,103,50,100,110,120];
  const weekly=lows.flatMap((low,index)=>Array.from({length:5},(_,day)=>({
    date:new Date(Date.UTC(2026,0,2)+index*7*86400000-day*86400000).toISOString().slice(0,10),
    open:low+3,high:low+10,low,close:low+5,
  }))).sort((a,b)=>a.date.localeCompare(b.date));
  const plain=calculateSupports({bars:weekly},{ivForFilter:70},'2026-03-20');
  assert.equal(plain.processing,'completed');
  assert.ok(plain.result.value.includes(90));
  assert.ok(plain.result.value.includes(50));
  const filtered=calculateSupports({bars:weekly},{filterBelowIV:true,ivForFilter:70},'2026-03-20');
  assert.deepEqual(filtered.result.value,[50]);
});
test('short or duplicate history and missing filter input end visibly',()=>{
  assert.equal(calculateSupports({bars:[]}).code,'insufficient_history');
  const bars=history();
  assert.equal(calculateSupports({bars:[...bars,bars[0]]}).code,'invalid_history');
  assert.equal(calculateSupports({bars},{filterBelowIV:true}).code,'missing_filter_input');
});
