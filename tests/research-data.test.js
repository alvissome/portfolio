import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYahooChart,parseYahooFundamentals,parseSecCompanyFacts,
  parseTwelveDataHistory,fetchResearchData,classifyListingShares} from '../.github/scripts/research-data.mjs';

const now = new Date('2026-11-12T12:00:00Z');
const ts = day => Date.parse(day+'T00:00:00Z')/1000;
function chart(symbol='EXAMPLE', {currency='USD',type='EQUITY'}={}) {
  return {chart:{result:[{meta:{symbol,currency,instrumentType:type,dataGranularity:'1d',
    longName:'Example Company',exchangeTimezoneName:'UTC',exchangeName:'EXAMPLE',
    currentTradingPeriod:{regular:{start:ts('2026-11-12'),end:ts('2026-11-13')}}},
  timestamp:['2026-11-02','2026-11-03','2026-11-12'].map(ts),
  indicators:{quote:[{open:[10,11,12],high:[12,13,14],low:[9,10,11],close:[11,12,13]}],
    adjclose:[{adjclose:[5,6,7]}]},
  events:{dividends:{a:{date:ts('2026-11-02'),amount:1},b:{date:ts('2026-11-12'),amount:2}},
    splits:{a:{date:ts('2026-11-02'),numerator:2,denominator:1}}}}]}};
}
const series = (symbol,type,entries) => ({meta:{symbol:[symbol],type:[type]},[type]:entries.map(([end,value,currency='USD',period=type.startsWith('trailing')?'TTM':'12M'])=>
  ({asOfDate:end,periodType:period,currencyCode:currency,reportedValue:{raw:value}}))});

test('chart prices do not use dividend adjusted-close scaling and exclude open/future sessions',()=>{
  const r=parseYahooChart(chart(),'EXAMPLE',{now,asOf:'2026-11-03'});
  assert.deepEqual(r.bars.map(r=>r.close),[11,12]);
  assert.equal(r.dividendPerShareTTM,1);
  assert.equal(r.instrument.name,'Example Company');
  assert.equal(r.history.retrievedAt,now.toISOString());
  assert.equal(r.history.asOf,'2026-11-03');
  assert.equal(r.history.splitEvents.length,1);
  assert.equal(parseYahooChart(chart(),'EXAMPLE',{now}).bars.length,2,'today open session is excluded');
});

test('foreign listing identity is exact and invalid OHLC does not become a support input',()=>{
  assert.throws(()=>parseYahooChart(chart('EXAMPLE'),'EXAMPLE.HK',{now}),/IDENTITY/);
  const payload=chart();payload.chart.result[0].indicators.quote[0].low[0]=100;
  assert.deepEqual(parseYahooChart(payload,'EXAMPLE',{now}).bars.map(r=>r.date),['2026-11-03']);
  assert.throws(()=>parseYahooChart(chart(),'EXAMPLE',{now,asOf:'2026-02-30'}),/CUTOFF/);
});

test('a split after historical cutoff prevents treating current-adjusted OHLC as the historical price basis',()=>{
  const p=chart();p.chart.result[0].events.splits.future={date:ts('2026-11-10'),numerator:4,denominator:1};
  const r=parseYahooChart(p,'EXAMPLE',{now,asOf:'2026-11-03'});
  assert.deepEqual(r.bars.map(b=>b.date),['2026-11-02','2026-11-03']);
  assert.equal(r.history.splitEvents.length,2,'later split inventory is retained for reconciliation');
  assert.equal(r.history.futureSplitEvents.length,1);
  assert.equal(r.history.adjustmentVintageVerified,false);
});

test('listing denominator requires ordinary-share basis and domestic SEC identity, while ADR ratios remain unresolved',()=>{
  const instrument={symbol:'EXAMPLE',name:'Example Company',currency:'USD',type:'EQUITY'};
  const funds={financialCurrency:'USD',ttm:{shares:10,sharesBasis:'Ordinary shares outstanding'}};
  const submissions={tickers:['EXAMPLE'],sic:'6021',filings:{recent:{form:['10-K'],filingDate:['2026-02-01']}}};
  const verified=classifyListingShares(instrument,funds,submissions,{now});
  assert.equal(verified.listingSharesVerified,true);assert.equal(verified.methodFamily,'bank');
  const foreign=structuredClone(submissions);foreign.filings.recent.form=['20-F'];
  assert.equal(classifyListingShares(instrument,funds,foreign,{now}).listingSharesVerified,false);
  assert.equal(classifyListingShares({...instrument,name:'Example Sponsored ADR'},funds,submissions,{now}).listingSharesVerified,false);
  assert.equal(classifyListingShares(instrument,{...funds,ttm:{shares:10,sharesBasis:'Diluted weighted-average shares'}},submissions,{now}).listingSharesVerified,false);
  const mismatched={...submissions,tickers:['OTHER']};
  assert.equal(classifyListingShares(instrument,funds,mismatched,{now}).methodFamily,'unknown');
  const reit=structuredClone(submissions);reit.sic='6798';
  assert.equal(classifyListingShares(instrument,funds,reit,{now}).methodFamily,'reit');
});

test('SG/HK direct listing basis is explicit and cannot silently convert accounting currency',()=>{
  const instrument={symbol:'EXAMPLE.SI',name:'Example Ordinary Equity',currency:'SGD',type:'EQUITY'};
  const funds={financialCurrency:'SGD',ttm:{shares:10,sharesBasis:'Ordinary shares outstanding'}};
  assert.equal(classifyListingShares(instrument,funds,null,{now}).listingSharesVerified,true);
  assert.equal(classifyListingShares(instrument,{...funds,financialCurrency:'USD'},null,{now}).listingSharesVerified,false);
  assert.equal(classifyListingShares({...instrument,type:'ETF'},funds,null,{now}).methodFamily,'etf');
});

test('Yahoo financials retain zero, normalise capex outflows, reject quarterly flows and mark vintage unverified',()=>{
  const data={timeseries:{result:[
    series('EXAMPLE','annualOperatingCashFlow',[['2025-12-31',100],['2026-09-30',90,'USD','3M']]),
    series('EXAMPLE','annualCapitalExpenditure',[['2025-12-31',-30]]),
    series('EXAMPLE','annualTotalDebt',[['2025-12-31',0]]),
    series('EXAMPLE','annualOrdinarySharesNumber',[['2025-12-31',10]]),
    series('OTHER','annualNetIncome',[['2025-12-31',9999]]),
    series('EXAMPLE','trailingOperatingCashFlow',[['2026-09-30',120]]),
    series('EXAMPLE','trailingCapitalExpenditure',[['2026-09-30',-40]]),
    series('EXAMPLE','quarterlyOrdinarySharesNumber',[['2026-09-30',8,'USD','3M']]),
  ]}};
  const r=parseYahooFundamentals(data,'EXAMPLE',{now,priceCurrency:'USD'});
  assert.equal(r.annual[0].cfo,100);
  assert.equal(r.annual[0].capex,30);
  assert.equal(r.annual[0].totalDebt,0);
  assert.equal(r.annual[0].netIncome,null);
  assert.equal(r.ttm.cfo,120);
  assert.equal(r.ttm.capex,40);
  assert.equal(r.ttm.shares,8);
  assert.equal(r.ttm.totalDebt,null,'stale nine-month-old instant debt is not silently carried forward');
  assert.equal(r.pointInTimeVerified,false);
});

test('Yahoo statement currency is retained independently of listing currency',()=>{
  const data={timeseries:{result:[series('EXAMPLE','annualOperatingCashFlow',[['2025-12-31',100,'EUR']])]}};
  const r=parseYahooFundamentals(data,'EXAMPLE',{now,priceCurrency:'USD'});
  assert.equal(r.financialCurrency,'EUR');
  assert.equal(r.ttm.cfo,100,'no implicit FX conversion');
  assert.equal(parseYahooFundamentals(data,'EXAMPLE',{now,asOf:'2025-01-01'}),null);
});

function secPayload({previous=true}={}) {
  const entry=(start,end,val,filed)=>({start,end,val,filed,form:start?'10-K':'10-Q'});
  const cfo=[entry('2025-01-01','2025-12-31',120,'2026-02-01'),
    entry('2026-01-01','2026-09-30',110,'2026-11-01'),
    entry('2025-01-01','2025-12-31',9999,'2027-01-01')];
  if(previous)cfo.push(entry('2025-01-01','2025-09-30',90,'2025-11-01'));
  return {facts:{'us-gaap':{
    NetCashProvidedByUsedInOperatingActivities:{units:{USD:cfo}},
    PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[entry('2025-01-01','2025-12-31',30,'2026-02-01'),
      entry('2026-01-01','2026-09-30',25,'2026-11-01'),entry('2025-01-01','2025-09-30',20,'2025-11-01')]}},
    StockholdersEquity:{units:{USD:[entry(undefined,'2026-09-30',500,'2026-11-01')]}},
  },dei:{EntityCommonStockSharesOutstanding:{units:{shares:[entry(undefined,'2026-10-25',20,'2026-11-01')]}}}}};
}

test('SEC trailing flows use annual plus current YTD minus prior YTD, with filing cutoff',()=>{
  const r=parseSecCompanyFacts(secPayload(),{now,asOf:'2026-11-03',priceCurrency:'USD'});
  assert.equal(r.ttm.end,'2026-09-30');
  assert.equal(r.ttm.cfo,140);
  assert.equal(r.ttm.capex,35);
  assert.equal(r.ttm.shares,20);
  assert.equal(r.ttm.equity,500);
  assert.equal(r.ttm.totalDebt,null);
  assert.equal(r.pointInTimeVerified,true);
  assert.equal(r.annual[0].cfo,120,'future restatement is excluded by filed date');
});

test('SEC does not annualise a cumulative quarterly flow when prior comparable YTD is missing',()=>{
  const r=parseSecCompanyFacts(secPayload({previous:false}),{now});
  assert.equal(r.ttm.cfo,120);
  assert.equal(r.ttm.end,'2025-12-31');
  assert.notEqual(r.ttm.cfo,440);
});

test('Twelve Data rejects a wrong exchange rather than treating a foreign listing as a US stock',()=>{
  const payload={meta:{symbol:'EXAMPLE',exchange:'NYSE',currency:'USD',exchange_timezone:'UTC'},values:[]};
  assert.throws(()=>parseTwelveDataHistory(payload,'EXAMPLE.SI',{now}),/IDENTITY/);
  payload.meta.exchange='SGX';payload.meta.currency='SGD';
  payload.values=[{datetime:'2026-11-03',open:'10',high:'12',low:'9',close:'11'},
    {datetime:'2026-11-12',open:'10',high:'12',low:'9',close:'11'}];
  const r=parseTwelveDataHistory(payload,'EXAMPLE.SI',{now,asOf:'2026-11-03'});
  assert.equal(r.bars.length,1);
  assert.equal(r.instrument.currency,'SGD');
  assert.equal(r.history.adjustment,'splits');
});

test('adapter keeps partial name/history results and safe failure codes without credentials or raw errors',async()=>{
  const fetch=async url=>{
    if(url.includes('/chart/'))return {ok:true,json:async()=>chart()};
    return {ok:false,status:429,json:async()=>({message:'Sensitive backend detail'})};
  };
  const r=await fetchResearchData('EXAMPLE',{fetch,now,twelveDataKey:'secret-not-output'});
  assert.equal(r.instrument.name,'Example Company');
  assert.equal(r.bars.length,2);
  assert.equal(r.fundamentals,null);
  assert.ok(r.warnings.includes('YAHOO_FUNDAMENTALS_HTTP_429'));
  assert.ok(!JSON.stringify(r).includes('Sensitive backend detail'));
  assert.ok(!JSON.stringify(r).includes('secret-not-output'));
});

test('adapter bounds historical requests and does not map an overseas security onto a US ADR',async()=>{
  const urls=[];
  const fetch=async url=>{urls.push(url);return {ok:false,status:404};};
  const r=await fetchResearchData('EXAMPLE.HK',{fetch,now,asOf:'2026-11-03'});
  assert.equal(urls.length,2,'foreign listing does not trigger US CIK alias lookup');
  assert.ok(urls.every(url=>url.includes('EXAMPLE.HK')));
  const chartURL=new URL(urls.find(u=>u.includes('/chart/')));
  assert.equal(new Date(Number(chartURL.searchParams.get('period2'))*1000).toISOString().slice(0,10),'2026-11-12',
    'history fetch includes later split events, while parser still freezes price rows at requested cutoff');
  assert.equal(r.instrument.symbol,'EXAMPLE.HK');
  assert.ok(r.warnings.includes('SEC_NO_EXACT_US_LISTING'));
});
