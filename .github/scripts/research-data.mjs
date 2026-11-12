/** Public-input adapters for the personal portfolio research worker.
 * No credentials or user portfolio values are logged. A provider failure is a
 * safe code, never a response body or URL (which could contain an API key).
 */
import {loadBundledSecTickerCatalog, SEC_CATALOG_MAX_AGE_DAYS} from './sec-ticker-catalog.mjs';
const DAY = 86400000;
const METRICS = {
  cfo: 'OperatingCashFlow', capex: 'CapitalExpenditure', netIncome: 'NetIncome',
  revenue: 'TotalRevenue', equity: 'StockholdersEquity', totalDebt: 'TotalDebt',
  cash: 'CashCashEquivalentsAndShortTermInvestments', tangibleEquity: 'TangibleBookValue',
  shares: 'OrdinarySharesNumber', dilutedShares: 'DilutedAverageShares',
};
const FLOW_FIELDS = new Set(['cfo', 'capex', 'netIncome', 'revenue']);
const FIELDS = Object.keys(METRICS);
const SEC_TAGS = {
  cfo: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
  equity: ['StockholdersEquity'],
  cash: ['CashCashEquivalentsAndShortTermInvestments', 'CashAndCashEquivalentsAtCarryingValue'],
  totalDebt: ['LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities'],
  shares: ['EntityCommonStockSharesOutstanding'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
};
const tickerCaches = new WeakMap();
const submissionCaches = new WeakMap();

const finite = n => typeof n === 'number' && Number.isFinite(n);
const blankMetrics = () => Object.fromEntries(FIELDS.map(k => [k, null]));
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
const dayString = value => new Date(value).toISOString().slice(0, 10);
function cutoffTime(now, asOf) {
  if (asOf !== undefined && (!dateOnly(asOf) || asOf > dayString(now))) throw new TypeError('INVALID_RESEARCH_CUTOFF');
  return asOf ? Math.min(+new Date(now), Date.parse(asOf + 'T23:59:59.999Z')) : +new Date(now);
}
function validateSymbol(symbol) {
  if (typeof symbol !== 'string' || !/^[A-Z0-9][A-Z0-9.^=\-]{0,29}$/i.test(symbol)) throw new TypeError('INVALID_RESEARCH_SYMBOL');
  return symbol;
}
function localDate(time, zone = 'UTC') {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(time)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch { return dayString(time); }
}
function validBar(bar) {
  return dateOnly(bar.date) && ['open', 'high', 'low', 'close'].every(k => finite(bar[k]) && bar[k] > 0)
    && bar.high >= Math.max(bar.open, bar.low, bar.close) && bar.low <= Math.min(bar.open, bar.high, bar.close);
}
async function safeJSON(fetchImpl, url, code, headers = {}) {
  try {
    const response = await fetchImpl(url, {headers, signal: AbortSignal.timeout(20000), redirect: 'error'});
    if (!response.ok) return {data: null, code: `${code}_HTTP_${response.status}`};
    return {data: await response.json(), code: null};
  } catch { return {data: null, code: `${code}_UNAVAILABLE`}; }
}

/** Yahoo chart OHLC uses the provider's historical split convention. Do not
 * multiply OHLC by adjclose/close: adjclose also reflects cash dividends.
 * The explicit convention is retained for reproducible research comparisons.
 */
export function parseYahooChart(payload, symbol, {now = new Date(), asOf} = {}) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || String(meta.symbol).toUpperCase() !== symbol.toUpperCase() || meta.dataGranularity !== '1d') {
    throw new Error('YAHOO_HISTORY_IDENTITY_OR_INTERVAL');
  }
  const nowMs = +new Date(now);
  const cutoffMs = cutoffTime(now, asOf);
  const cutoff = dayString(cutoffMs);
  const session = meta.currentTradingPeriod?.regular;
  const quote = result.indicators?.quote?.[0] ?? {};
  const seen = new Set();
  const bars = (result.timestamp ?? []).map((time, i) => ({
    date: localDate(time * 1000, meta.exchangeTimezoneName), time,
    open: quote.open?.[i], high: quote.high?.[i], low: quote.low?.[i], close: quote.close?.[i],
  })).filter(bar => bar.time * 1000 <= cutoffMs && bar.date <= cutoff
    && !(session && nowMs < session.end * 1000 && bar.time >= session.start)
    && validBar(bar) && !seen.has(bar.date) && seen.add(bar.date))
    .sort((a, b) => a.date.localeCompare(b.date)).map(({time, ...bar}) => bar);
  const dividends = Object.values(result.events?.dividends ?? {}).filter(d => finite(d.amount)
    && d.amount >= 0 && finite(d.date) && d.date * 1000 <= cutoffMs && d.date * 1000 > cutoffMs - 365 * DAY);
  const dividendPerShareTTM = result.events?.dividends && meta.currency
    ? dividends.reduce((sum, d) => sum + d.amount, 0) : null;
  const splitEvents = Object.values(result.events?.splits ?? {}).filter(s => finite(s.date) && s.date * 1000 <= nowMs)
    .map(s => ({date: localDate(s.date * 1000, meta.exchangeTimezoneName), numerator: s.numerator ?? null, denominator: s.denominator ?? null})).slice(-64);
  const futureSplitEvents = splitEvents.filter(s => s.date > cutoff);
  return {
    instrument: {symbol, name: meta.longName || meta.shortName || null, currency: meta.currency || null,
      type: meta.instrumentType || null, exchange: meta.fullExchangeName || meta.exchangeName || null},
    bars,
    history: {source: 'Yahoo Finance chart', asOf: bars.at(-1)?.date ?? null,
      retrievedAt: new Date(nowMs).toISOString(), adjustment: 'Provider historical OHLC; split convention, no adjclose dividend rescaling',
      interval: '1d', completeSessionsOnly: true,
      splitEvents, splitEventsComplete: true, futureSplitEvents,
      adjustmentVintageVerified: futureSplitEvents.length === 0,
      vintageReason: futureSplitEvents.length ? 'Provider historical prices may reflect splits after requested cutoff; historical price basis needs reconciliation'
        : 'No provider-reported split after requested cutoff through retrieval date'},
    dividendPerShareTTM,
  };
}

export function parseYahooFundamentals(payload, symbol, {now = new Date(), asOf, priceCurrency = null} = {}) {
  const cutoff = dayString(cutoffTime(now,asOf));
  const entries = [];
  for (const series of Array.isArray(payload?.timeseries?.result) ? payload.timeseries.result : []) {
    if (!Array.isArray(series.meta?.symbol) || !series.meta.symbol.some(s => String(s).toUpperCase() === symbol.toUpperCase())) continue;
    for (const [field, type] of Object.entries(METRICS)) {
      for (const frequency of ['annual', 'trailing', 'quarterly']) {
        const key = frequency + type;
        for (const fact of Array.isArray(series[key]) ? series[key] : []) {
          const end = dateOnly(fact.asOfDate);
          const value = fact.reportedValue?.raw;
          if (!end || end > cutoff || !finite(value)) continue;
          // Reject a quarterly flow masquerading as an annual or TTM value.
          if (FLOW_FIELDS.has(field) && ((frequency === 'annual' && fact.periodType !== '12M')
            || (frequency === 'trailing' && !['TTM', '12M'].includes(fact.periodType)))) continue;
          if (FLOW_FIELDS.has(field) && frequency === 'quarterly') continue;
          entries.push({field, frequency, end, value: field === 'capex' ? Math.abs(value) : value,
            currency: fact.currencyCode || null});
        }
      }
    }
  }
  const money = entries.filter(e => !['shares', 'dilutedShares'].includes(e.field));
  const currencies = [...new Set(money.map(e => e.currency).filter(Boolean))];
  const latestMoneyDate = money.map(e => e.end).sort().at(-1);
  const latestCurrencies = [...new Set(money.filter(e => e.end === latestMoneyDate).map(e => e.currency).filter(Boolean))];
  // A listing currency is not evidence that the company's accounts use that
  // currency. If reporting currency changes, retain the latest unambiguous one.
  const currency = latestCurrencies.length === 1 ? latestCurrencies[0] : currencies.length === 1 ? currencies[0] : null;
  if (!currency) return null;
  const usable = entries.filter(e => ['shares', 'dilutedShares'].includes(e.field) || e.currency === currency);
  const annualMap = new Map();
  for (const e of usable.filter(e => e.frequency === 'annual')) {
    if (!annualMap.has(e.end)) annualMap.set(e.end, {end: e.end, ...blankMetrics()});
    annualMap.get(e.end)[e.field] = e.value;
  }
  const annual = [...annualMap.values()].sort((a,b) => a.end.localeCompare(b.end)).slice(-11);
  for (const row of annual) {
    row.sharesBasis = row.shares !== null ? 'Ordinary shares outstanding' : row.dilutedShares !== null ? 'Diluted weighted-average shares' : null;
    row.shares ??= row.dilutedShares;
  }
  const latestFlowDate = usable.filter(e => FLOW_FIELDS.has(e.field) && e.frequency === 'trailing')
    .map(e => e.end).sort().at(-1) ?? annual.at(-1)?.end ?? null;
  const ttm = {end: latestFlowDate, ...blankMetrics()};
  for (const field of FIELDS) {
    const matches = usable.filter(e => e.field === field && e.end <= (latestFlowDate ?? cutoff)
      && (!FLOW_FIELDS.has(field) || e.end === latestFlowDate && ['annual', 'trailing'].includes(e.frequency)))
      .sort((a,b) => a.end.localeCompare(b.end) || (a.frequency === 'trailing' ? 1 : 0) - (b.frequency === 'trailing' ? 1 : 0));
    const selected = matches.at(-1);
    if (selected && (FLOW_FIELDS.has(field) || Date.parse(latestFlowDate ?? cutoff) - Date.parse(selected.end) <= 150 * DAY)) ttm[field] = selected.value;
  }
  ttm.sharesBasis = ttm.shares !== null ? 'Ordinary shares outstanding' : ttm.dilutedShares !== null ? 'Diluted weighted-average shares' : null;
  ttm.shares ??= ttm.dilutedShares;
  if (!annual.length && !Object.values(ttm).some(finite)) return null;
  return {source: 'Yahoo Finance fundamentals time series', asOf: latestFlowDate,
    retrievedAt: new Date(now).toISOString(), financialCurrency: currency, annual, ttm,
    pointInTimeVerified: false, vintageReason: 'Provider does not supply filing/publication dates or historical consensus vintages',
    vintage: 'Current retrieval; financial period dates are not historical publication or consensus vintages',
    warnings: currencies.length > 1 ? ['MIXED_CURRENCIES_FILTERED'] : []};
}

function secEntries(payload, tags, unit, cutoff) {
  for (const tag of tags) {
    const concept = payload.facts?.['us-gaap']?.[tag] || payload.facts?.dei?.[tag];
    const facts = (Array.isArray(concept?.units?.[unit]) ? concept.units[unit] : []).filter(f => dateOnly(f.end) && f.end <= cutoff
      && dateOnly(f.filed) && f.filed <= cutoff && finite(f.val));
    if (!facts.length) continue;
    const unique = new Map();
    for (const fact of facts.sort((a,b) => a.filed.localeCompare(b.filed))) unique.set(`${fact.start || ''}:${fact.end}`, fact);
    return [...unique.values()];
  }
  return [];
}
const duration = f => f.start ? (Date.parse(f.end) - Date.parse(f.start)) / DAY + 1 : 0;
function secFlowAt(facts, end) {
  const annual = facts.filter(f => duration(f) >= 330 && duration(f) <= 400).sort((a,b) => a.end.localeCompare(b.end));
  const direct = annual.findLast(f => f.end === end);
  if (direct) return direct.val;
  const base = annual.findLast(f => f.end < end);
  const current = facts.filter(f => f.end === end && duration(f) >= 30 && duration(f) <= 320)
    .sort((a,b) => duration(a) - duration(b)).at(-1);
  if (!base || !current || Date.parse(end) - Date.parse(base.end) > 320 * DAY) return null;
  const previous = facts.findLast(f => Math.abs((Date.parse(current.end) - Date.parse(f.end)) / DAY - 365.25) <= 8
    && Math.abs(duration(f) - duration(current)) <= 8);
  return previous ? base.val + current.val - previous.val : null;
}

/** US-GAAP fallback. Facts from custom taxonomies are intentionally not guessed.
 * Periods and filed dates are checked; quarterly cumulative cash flow is never
 * multiplied by four or silently called annual cash flow.
 */
export function parseSecCompanyFacts(payload, {now = new Date(), asOf, priceCurrency = null} = {}) {
  const cutoff = dayString(cutoffTime(now,asOf));
  const monetaryConcept = payload?.facts?.['us-gaap']?.NetCashProvidedByUsedInOperatingActivities
    || payload?.facts?.['us-gaap']?.NetIncomeLoss || payload?.facts?.['us-gaap']?.StockholdersEquity;
  const units = Object.keys(monetaryConcept?.units ?? {});
  const currencies = units.filter(u => /^[A-Z]{3}$/.test(u));
  const currency = currencies.length === 1 ? currencies[0] : currencies.includes(priceCurrency) ? priceCurrency : null;
  if (!currency) return null;
  const byField = Object.fromEntries(Object.entries(SEC_TAGS).map(([field,tags]) => [field,
    secEntries(payload, tags, ['shares','dilutedShares'].includes(field) ? 'shares' : currency, cutoff)]));
  const annualEnds = [...new Set([...byField.cfo, ...byField.netIncome].filter(f => duration(f) >= 330 && duration(f) <= 400).map(f => f.end))].sort().slice(-11);
  function atEnd(field, end) {
    const matches = (byField[field] ?? []).filter(f => f.end === end);
    if (FLOW_FIELDS.has(field)) return secFlowAt(byField[field] ?? [], end);
    const value = matches.sort((a,b) => (duration(a)>=330&&duration(a)<=400?1:0)-(duration(b)>=330&&duration(b)<=400?1:0)
      || a.filed.localeCompare(b.filed)).at(-1)?.val;
    return finite(value) ? value : null;
  }
  const annual = annualEnds.map(end => {
    const row = {end, ...blankMetrics()};
    for (const field of FIELDS) row[field] = atEnd(field, end);
    row.capex = finite(row.capex) ? Math.abs(row.capex) : null;
    row.sharesBasis = row.shares !== null ? 'Ordinary shares outstanding' : row.dilutedShares !== null ? 'Diluted weighted-average shares' : null;
    row.shares ??= row.dilutedShares;
    return row;
  });
  const flowEnds = [...new Set([...byField.cfo, ...byField.netIncome].map(f=>f.end))].sort().reverse();
  const end = flowEnds.find(day => secFlowAt(byField.cfo, day) !== null || secFlowAt(byField.netIncome, day) !== null) ?? annual.at(-1)?.end;
  if (!end) return null;
  const ttm = {end, ...blankMetrics()};
  for (const field of FIELDS) ttm[field] = atEnd(field, end);
  ttm.capex = finite(ttm.capex) ? Math.abs(ttm.capex) : null;
  const latestShares = byField.shares.filter(f => f.end <= cutoff).sort((a,b)=>a.end.localeCompare(b.end)).at(-1);
  if (latestShares && Date.parse(cutoff) - Date.parse(latestShares.end) < 180*DAY) ttm.shares = latestShares.val;
  ttm.sharesBasis = ttm.shares !== null ? 'Ordinary shares outstanding' : ttm.dilutedShares !== null ? 'Diluted weighted-average shares' : null;
  ttm.shares ??= ttm.dilutedShares;
  return {source: 'SEC EDGAR companyfacts (US-GAAP)', asOf: end, retrievedAt: new Date(now).toISOString(),
    financialCurrency: currency, annual, ttm,
    pointInTimeVerified: true, filingsThrough: cutoff,
    cashBasis: 'Reported standard aggregate; cash-only fallback may exclude short-term investments',
    debtBasis: 'Reported long-term debt plus capital lease aggregate; unavailable if aggregate tag absent',
    vintage: 'Current SEC facts, filtered to financial periods and filing dates at/before retrieval cutoff',
    warnings: ['SEC_STANDARD_TAGS_ONLY', 'SEC_DEBT_FIELD_MAY_BE_UNAVAILABLE', 'NO_ANALYST_CONSENSUS']};
}

async function secTicker(symbol, fetchImpl, now, secUserAgent, loadSecCatalog) {
  if (/\.(?:SI|HK|L)$/i.test(symbol)) return {entry:null,warning:'SEC_NO_EXACT_US_LISTING'};
  let cache = tickerCaches.get(fetchImpl);
  const retrieved = Date.parse(cache?.catalogProvenance?.retrievedAt);
  const fallbackExpired = cache?.catalogProvenance && (!Number.isFinite(retrieved) ||
    retrieved > +new Date(now) || +new Date(now) - retrieved > SEC_CATALOG_MAX_AGE_DAYS * DAY);
  if (!cache || +new Date(now) - cache.fetchedAt > DAY || fallbackExpired) {
    const r = await safeJSON(fetchImpl, 'https://www.sec.gov/files/company_tickers.json', 'SEC_TICKERS', {'User-Agent': secUserAgent});
    cache = {fetchedAt: +new Date(now), data: r.data, error: r.code};
    // Only an index retrieval failure may use the dated full public catalog.
    // This never replaces the current data.sec.gov issuer/annual-form checks.
    if (!r.data && r.code) {
      try {
        const fallback = await loadSecCatalog({now});
        cache.data = fallback.data;
        cache.catalogProvenance = {...fallback.provenance, fallbackFor: r.code};
        cache.fallbackCode = 'SEC_TICKERS_CATALOG_FALLBACK';
      } catch (error) {
        cache.fallbackCode = /^SEC_CATALOG_[A-Z_]+$/.test(error?.message || '')
          ? error.message : 'SEC_CATALOG_UNAVAILABLE';
      }
    }
    tickerCaches.set(fetchImpl, cache);
  }
  const entry = Object.values(cache.data ?? {}).find(r => r.ticker === symbol.toUpperCase());
  return {entry,warning:cache.error || (entry?null:'SEC_NO_EXACT_TICKER'),
    warnings:cache.fallbackCode?[cache.fallbackCode]:[],catalogProvenance:cache.catalogProvenance || null};
}
async function secFallback(symbol, fetchImpl, now, asOf, priceCurrency, secUserAgent, loadSecCatalog) {
  const {entry,warning,warnings}=await secTicker(symbol,fetchImpl,now,secUserAgent,loadSecCatalog);
  if(!entry)return{fundamentals:null,name:null,warning,warnings};
  const cik = String(entry.cik_str).padStart(10, '0');
  const r = await safeJSON(fetchImpl, `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 'SEC_FACTS', {'User-Agent': secUserAgent});
  return {fundamentals: r.data ? parseSecCompanyFacts(r.data, {now, asOf, priceCurrency}) : null,
    name: entry.title || r.data?.entityName || null, warning: r.code || warning,warnings};
}

/** Exact SEC issuer linkage is used for share-basis classification, not as an
 * inferred ADR conversion. Foreign annual forms stay unresolved until their
 * depositary ratio and economic share denomination have explicit evidence.
 */
export function classifyListingShares(instrument,fundamentals,submissions,{now=new Date(),asOf}={}) {
  const cutoff=dayString(cutoffTime(now,asOf));
  const type=String(instrument.type||'').toUpperCase();
  const exactIssuer=Array.isArray(submissions?.tickers)&&submissions.tickers.some(t=>String(t).toUpperCase()===instrument.symbol.toUpperCase());
  const sic=exactIssuer?Number(submissions.sic):null;
  const methodFamily=sic===6798?'reit':sic>=6020&&sic<=6099?'bank':sic>=6000&&sic<=6999?'financial_other':sic>=100&&sic<=9999?'stock':'unknown';
  const base={listingSharesVerified:false,listingSharesProvenance:null,listingSharesReason:'Listing share basis has not been verified',methodFamily};
  if(type==='ETF')return{...base,methodFamily:'etf',listingSharesReason:'ETF does not use an individual-company share denominator'};
  if(['MUTUALFUND','FUND','MUTUAL FUND'].includes(type))return{...base,methodFamily:'fund',listingSharesReason:'Fund does not use an individual-company share denominator'};
  if(type!=='EQUITY')return{...base,listingSharesReason:'Provider instrument type is not verified equity'};
  if(/\b(?:ADR|ADS|depositary|depository)\b/i.test(instrument.name||''))return{...base,listingSharesReason:'Depositary-share ratio is not verified'};
  if(!fundamentals?.ttm?.sharesBasis?.startsWith('Ordinary shares')||!finite(fundamentals.ttm.shares)||fundamentals.ttm.shares<=0)
    return{...base,listingSharesReason:'Provider ordinary shares outstanding are unavailable; weighted-average shares are not an explicit listing denominator'};
  if(/\.(?:SI|HK)$/i.test(instrument.symbol)){
    if(instrument.currency!==fundamentals.financialCurrency)return{...base,listingSharesReason:'Listing and reporting currency differ; share/FX basis needs explicit verification'};
    return{...base,listingSharesVerified:true,listingSharesProvenance:'Exact SG/HK equity listing with provider ordinary shares outstanding and identical reporting/trading currency; no ADR conversion applied',listingSharesReason:null};
  }
  if(!exactIssuer)
    return{...base,listingSharesReason:'No exact SEC issuer ticker match for the requested listing'};
  const recent=submissions.filings?.recent;
  const annual=(recent?.form||[]).map((form,i)=>({form,date:recent.filingDate?.[i]}))
    .filter(r=>['10-K','20-F','40-F'].includes(r.form)&&dateOnly(r.date)&&r.date<=cutoff).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  if(annual?.form!=='10-K')return{...base,methodFamily,listingSharesReason:annual?'Foreign issuer annual report: depositary/ordinary-share ratio is unresolved':'No domestic 10-K annual-report basis at requested cutoff'};
  return{...base,methodFamily,listingSharesVerified:true,listingSharesProvenance:'Exact SEC ticker/issuer match with 10-K annual reporting at cutoff; provider ordinary shares outstanding (no ADR conversion)',listingSharesReason:null};
}

async function listingBasis(instrument,fundamentals,fetchImpl,now,asOf,secUserAgent,loadSecCatalog) {
  if(/\.(?:SI|HK|L)$/i.test(instrument.symbol)||instrument.type!=='EQUITY')return classifyListingShares(instrument,fundamentals,null,{now,asOf});
  const {entry,warning,warnings,catalogProvenance}=await secTicker(instrument.symbol,fetchImpl,now,secUserAgent,loadSecCatalog);
  if(!entry)return{...classifyListingShares(instrument,fundamentals,null,{now,asOf}),warning,warnings,catalogProvenance};
  const cik=String(entry.cik_str).padStart(10,'0');
  let caches=submissionCaches.get(fetchImpl);
  if(!caches){caches=new Map();submissionCaches.set(fetchImpl,caches);}
  let cache=caches.get(cik);
  if(!cache||+new Date(now)-cache.fetchedAt>DAY){
    const r=await safeJSON(fetchImpl,`https://data.sec.gov/submissions/CIK${cik}.json`,'SEC_SUBMISSIONS',{'User-Agent':secUserAgent});
    cache={fetchedAt:+new Date(now),...r};caches.set(cik,cache);
  }
  return{...classifyListingShares(instrument,fundamentals,cache.data,{now,asOf}),warning:cache.code || warning,
    warnings:[...(warnings || []),...(warning && cache.code?[warning]:[])],catalogProvenance,
    issuer:cache.data?{cik,sic:cache.data.sic||null,sicDescription:cache.data.sicDescription||null}:null};
}

function tdSymbol(symbol) {
  if (symbol.endsWith('.SI')) return `${symbol.slice(0,-3)}:SGX`;
  if (symbol.endsWith('.HK')) return `${symbol.slice(0,-3)}:HKEX`;
  if (symbol.endsWith('.L')) return `${symbol.slice(0,-2)}:LSE`;
  return symbol;
}
export function parseTwelveDataHistory(payload, symbol, {now = new Date(), asOf} = {}) {
  const expected = tdSymbol(symbol).split(':');
  if (payload?.status === 'error' || !payload?.meta || String(payload.meta.symbol).toUpperCase() !== expected[0].toUpperCase()
    || expected[1] && ![expected[1], expected[1] === 'HKEX' ? 'SEHK' : expected[1]].includes(payload.meta.exchange)) {
    throw new Error('TWELVE_HISTORY_IDENTITY');
  }
  const today = localDate(+new Date(now), payload.meta.exchange_timezone);
  const cutoff = dayString(cutoffTime(now,asOf));
  const seen = new Set();
  const bars = (payload.values ?? []).map(r => ({date: dateOnly(r.datetime), open: +r.open,
    high: +r.high, low: +r.low, close: +r.close})).filter(r => r.date < today && r.date <= cutoff && validBar(r)
      && !seen.has(r.date) && seen.add(r.date))
    .sort((a,b)=>a.date.localeCompare(b.date));
  return {instrument:{symbol, name:payload.meta.name || null, currency:payload.meta.currency || null,
    type:payload.meta.type === 'ETF' ? 'ETF' : payload.meta.type === 'Common Stock' ? 'EQUITY' : payload.meta.type || null,
    exchange:payload.meta.exchange || null}, bars,
    history:{source:'Twelve Data time_series', asOf:bars.at(-1)?.date ?? null,
      retrievedAt:new Date(now).toISOString(),adjustment:'splits',interval:'1d',completeSessionsOnly:true,splitEvents:[],splitEventsComplete:false,futureSplitEvents:[],
      adjustmentVintageVerified:!asOf||asOf===dayString(now),
      vintageReason:'Provider splits-adjusted series; historical split-event inventory is unavailable in this response'},
    dividendPerShareTTM:null};
}

/** Main adapter. Raw provider payloads stay in memory and are never logged.
 * It returns a useful partial result if prices, company facts or name lookup
 * fail independently. No aliasing between ADRs and overseas listings occurs.
 */
export async function fetchResearchData(symbol, {fetch:fetchImpl = globalThis.fetch, now = new Date(),
  asOf, twelveDataKey = null, secUserAgent = 'PersonalPortfolioResearch https://github.com/alvissome/portfolio',
  loadSecCatalog = loadBundledSecTickerCatalog} = {}) {
  validateSymbol(symbol);
  const warnings = [];
  const cutoffMs = cutoffTime(now,asOf);
  const period2 = Math.floor(cutoffMs/1000)+1;
  const chartPeriod2=Math.floor(+new Date(now)/1000)+1;
  const period1 = Math.floor((cutoffMs - 11*365.25*DAY)/1000);
  const types = Object.values(METRICS).flatMap(type=>['annual','trailing','quarterly'].map(f=>f+type));
  const [chart, facts] = await Promise.all([
    safeJSON(fetchImpl, `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${chartPeriod2}&events=div%2Csplits`, 'YAHOO_HISTORY', {'User-Agent':secUserAgent}),
    safeJSON(fetchImpl, `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types.join(',')}&period1=${period1}&period2=${period2}`, 'YAHOO_FUNDAMENTALS', {'User-Agent':secUserAgent}),
  ]);
  let history = null;
  if (chart.data) {try {history = parseYahooChart(chart.data,symbol,{now,asOf});} catch {warnings.push('YAHOO_HISTORY_INVALID');}}
  else warnings.push(chart.code);
  if ((!history || history.bars.length < 2) && twelveDataKey) {
    const url = new URL('https://api.twelvedata.com/time_series');
    for (const [key,value] of Object.entries({symbol:tdSymbol(symbol),interval:'1day',outputsize:'5000',
      adjust:'splits',start_date:dayString(period1*1000),end_date:dayString(cutoffMs),apikey:twelveDataKey})) url.searchParams.set(key,value);
    const r=await safeJSON(fetchImpl,url.toString(),'TWELVE_HISTORY');
    if(r.data){try{history=parseTwelveDataHistory(r.data,symbol,{now,asOf});}catch{warnings.push('TWELVE_HISTORY_INVALID');}}
    else warnings.push(r.code);
  }
  let fundamentals = facts.data ? parseYahooFundamentals(facts.data,symbol,{now,asOf,priceCurrency:history?.instrument.currency}) : null;
  if(facts.code)warnings.push(facts.code);
  let secName = null;
  if(!fundamentals || !fundamentals.annual.some(row => finite(row.cfo) || finite(row.netIncome))){
    const sec=await secFallback(symbol,fetchImpl,now,asOf,history?.instrument.currency,secUserAgent,loadSecCatalog);
    fundamentals=sec.fundamentals || fundamentals;secName=sec.name;
    if(sec.warning)warnings.push(sec.warning);
    warnings.push(...(sec.warnings || []));
  }
  if(!history)warnings.push('HISTORY_UNAVAILABLE');
  if(!fundamentals)warnings.push('FUNDAMENTALS_UNAVAILABLE');
  const instrument=history?.instrument || {symbol,name:null,currency:null,type:null,exchange:null};
  instrument.name ||= secName;
  const basis=await listingBasis(instrument,fundamentals,fetchImpl,now,asOf,secUserAgent,loadSecCatalog);
  instrument.methodFamily=basis.methodFamily;
  if(basis.issuer)instrument.issuer=basis.issuer;
  if(basis.warning)warnings.push(basis.warning);
  warnings.push(...(basis.warnings || []));
  if(basis.catalogProvenance)instrument.issuerCatalog=basis.catalogProvenance;
  if(fundamentals){
    fundamentals.dividendPerShareTTM=history?.dividendPerShareTTM ?? null;
    fundamentals.listingSharesVerified=basis.listingSharesVerified;
    fundamentals.listingSharesProvenance=basis.listingSharesProvenance;
    fundamentals.listingSharesReason=basis.listingSharesReason;
  }
  return {instrument,bars:history?.bars ?? [],history:history?.history ?? null,fundamentals,
    dividendPerShareTTM:history?.dividendPerShareTTM ?? null,warnings:[...new Set(warnings.filter(Boolean))]};
}
