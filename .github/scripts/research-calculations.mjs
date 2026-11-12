/** Independent, experimental research arithmetic. No portfolio writes/network. */
export const MODEL_VERSION = 'ak-reconstruction-v1';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const mean = xs => xs.reduce((sum, value) => sum + value, 0) / xs.length;
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const isoDay = value => new Date(value).toISOString().slice(0, 10);
const dateMs = value => Date.parse(value + (value.length === 10 ? 'T00:00:00Z' : ''));
const dayMs = 86400000;

function compactFinancialArchive(facts, annual, current) {
  const fields = ['cfo', 'capex', 'netIncome', 'equity', 'shares'];
  const numbers = row => Object.fromEntries(fields.filter(key => finite(row[key])).map(key => [key, row[key]]));
  const archive = {currency: facts.financialCurrency, financialAsOf: facts.asOf || current.end || null,
    annual: annual.slice(-5).map(row => ({end: row.end, ...numbers(row)})),
    ttm: {end: current.end || null, ...numbers(current)},
    sharesBasis: String(current.sharesBasis || 'Not supplied').slice(0, 80),
    sharesVerified: facts.listingSharesVerified === true,
    sharesProvenance: String(facts.listingSharesProvenance || '').slice(0, 180),
    cashBasis: String(facts.cashBasis || 'Provider cash plus short-term investments').slice(0, 100),
    debtBasis: String(facts.debtBasis || 'Provider total debt; lease treatment may differ from the teaching examples').slice(0, 100)};
  for (const key of ['cash', 'totalDebt']) if (finite(current[key])) archive.ttm[key] = current[key];
  if (finite(facts.dividendPerShareTTM)) archive.dividendPerShareTTM = facts.dividendPerShareTTM;
  if (JSON.stringify(archive).length > 2048) {
    archive.sharesProvenance = archive.sharesProvenance.slice(0, 60);
    archive.cashBasis = archive.cashBasis.slice(0, 40);
    archive.debtBasis = archive.debtBasis.slice(0, 40);
  }
  return archive;
}

export function dcf20({fcf0, g1, g2, g3 = .04, discountRate, cash, debt, shares}) {
  if (![fcf0, g1, g2, g3, discountRate, cash, debt, shares].every(finite) ||
      shares <= 0 || discountRate <= -1 || Math.min(g1, g2, g3) <= -1) {
    throw new TypeError('Invalid DCF inputs');
  }
  let flow = fcf0, present = 0;
  const schedule = [];
  for (let year = 1; year <= 20; year++) {
    const growth = year <= 5 ? g1 : year <= 10 ? g2 : g3;
    flow *= 1 + growth;
    const pv = flow / (1 + discountRate) ** year;
    present += pv;
    schedule.push({year, growth, cashFlow: flow, pv});
  }
  return {value: (present + cash - debt) / shares, presentValue: present, schedule};
}

export function justifiedPB({bookValuePerShare, roe, growth = .04, costOfEquity = .095}) {
  if (![bookValuePerShare, roe, growth, costOfEquity].every(finite) ||
      bookValuePerShare <= 0 || costOfEquity <= growth) throw new TypeError('Invalid P/B inputs');
  const multiple = (roe - growth) / (costOfEquity - growth);
  return {value: bookValuePerShare * multiple, multiple};
}

function completed(result) {
  return {processing: 'completed', validation: 'experimental', result, reason: null};
}
function unavailable(reason, code = 'insufficient_inputs') {
  return {processing: 'unavailable', validation: 'experimental', result: null, reason, code};
}

function latestAtOrBefore(bars, day, maximumAge = 14) {
  const cutoff = dateMs(day);
  return bars.filter(bar => dateMs(bar.date) <= cutoff && cutoff - dateMs(bar.date) <= maximumAge * dayMs).at(-1);
}

/** Historical P/B only when equity, shares and actual contemporaneous closes
 * are available. This is not labelled tangible book value unless supplied. */
export function historicalPB(annual, bars, splitEvents = []) {
  const first = annual.map(row => row.end).sort()[0];
  const last = bars.at(-1)?.date;
  if (splitEvents.some(event => event.date > first && event.date <= last)) return null;
  const observations = annual.flatMap(row => {
    const price = latestAtOrBefore(bars, row.end);
    if (!price || !finite(row.equity) || row.equity <= 0 || !finite(row.shares) || row.shares <= 0) return [];
    return [{end: row.end, multiple: price.close / (row.equity / row.shares)}];
  }).slice(-5);
  return observations.length >= 3 ? {multiple: mean(observations.map(row => row.multiple)), observations} : null;
}

function historicalGrowth(annual, field, current) {
  const observations = annual.filter(row => finite(row[field]) && row[field] > 0)
    .sort((a, b) => a.end.localeCompare(b.end)).slice(-5);
  if (observations.length < 3 || !(current > 0)) return null;
  const first = observations[0], last = observations.at(-1);
  const years = (dateMs(last.end) - dateMs(first.end)) / (365.25 * dayMs);
  if (years < 1.5) return null;
  return {raw: (last[field] / first[field]) ** (1 / years) - 1, start: first.end, end: last.end, years};
}

/** Valuation choices are disclosed model assumptions, not Adam's unpublished
 * analyst inputs. A genuine missing currency/share/base-flow input blocks IV. */
export function calculateIV(data, request = {}, asOf = new Date().toISOString().slice(0, 10)) {
  const instrument = data.instrument || {};
  if (['ETF', 'MUTUALFUND', 'INDEX'].includes(String(instrument.type).toUpperCase()) ||
      ['fund', 'etf'].includes(String(request.methodFamily || instrument.methodFamily).toLowerCase())) {
    return {processing: 'unsupported', validation: 'not_applicable', result: null,
      reason: 'Company DCF IV is not applicable to this fund/index. Technical supports are calculated separately.'};
  }
  const facts = data.fundamentals;
  if (!facts) return unavailable('Financial inputs could not be retrieved. Technical support calculation can still complete.');
  const currency = instrument.currency;
  if (!currency || !facts.financialCurrency || currency !== facts.financialCurrency) {
    return unavailable('Financial-statement and listing currencies are not verified as identical; an explicit FX/listing mapping is required.', 'currency_mapping_required');
  }
  if (facts.listingSharesVerified !== true) {
    const reason = typeof facts.listingSharesReason === 'string' ? facts.listingSharesReason.slice(0, 180) : '';
    const diagnostics = [...new Set((data.warnings || []).filter(code => /^SEC_[A-Z0-9_]{1,80}$/.test(code)))].slice(0, 5);
    return unavailable(['Share or ADR denominator is not verified for this listing.', reason,
      diagnostics.length ? `Provider diagnostics: ${diagnostics.join(', ')}.` : ''].filter(Boolean).join(' '), 'share_mapping_required');
  }
  const annual = (facts.annual || []).filter(row => row.end <= asOf).sort((a, b) => a.end.localeCompare(b.end));
  const current = facts.ttm || {};
  const share = current.shares;
  if (!finite(share) || share <= 0) return unavailable('Current share count is missing or invalid.');
  const source = facts.source || 'Public financial statements';
  const financialAsOf = facts.asOf || current.asOf || asOf;
  const family = String(request.methodFamily || instrument.methodFamily || 'unknown').toLowerCase();
  if (!['stock', 'bank', 'reit'].includes(family)) return unavailable('The valuation family is not classified. Select Stock, Bank or REIT after reviewing the instrument.', 'method_family_required');
  const common = {source, asOf, financialAsOf, currency, methodFamily: family, modelVersion: MODEL_VERSION,
    financialInputs: compactFinancialArchive(facts, annual, current),
    pointInTimeVerified: facts.pointInTimeVerified === true,
    vintageReason: facts.vintageReason || (facts.pointInTimeVerified ? null : 'Financial input publication vintage has not been independently verified.')};
  const assumptions = request.assumptions || {};

  if (family === 'bank' || family === 'reit') {
    const variants = [];
    const dividends = facts.dividendPerShareTTM ?? current.dividendPerShareTTM;
    if (finite(dividends) && dividends > 0) variants.push({key: 'yield_5pct', method: 'Dividend yield at 5%', value: dividends / .05,
      basis: 'trailing_provider_dividends',
      inputs: {dividendPerShareTTM: dividends, targetYield: .05}});
    const book = finite(current.equity) && current.equity > 0 ? current.equity / share : null;
    const historical = data.history?.splitEventsComplete === true && data.history?.adjustmentVintageVerified === true
      ? historicalPB(annual, data.bars || [], data.history.splitEvents || []) : null;
    if (finite(book) && historical) variants.push({key: 'historical_pb', method: 'Historical P/B on unadjusted equity',
      value: book * historical.multiple, basis: 'unadjusted_equity', inputs: {bookValuePerShare: book, historicalPB: historical.multiple, observations: historical.observations}});
    if (family === 'bank' && finite(book)) {
      const roes = annual.filter(row => finite(row.netIncome) && finite(row.equity) && row.equity > 0)
        .slice(-5).map(row => row.netIncome / row.equity);
      if (roes.length >= 3) {
        const roe = mean(roes), growth = finite(assumptions.perpetualGrowth) ? assumptions.perpetualGrowth : .04;
        const costOfEquity = finite(assumptions.costOfEquity) ? assumptions.costOfEquity : .095;
        if (costOfEquity > growth) variants.push({key: 'justified_pb', method: 'Justified P/B from historical ROE',
          ...justifiedPB({bookValuePerShare: book, roe, growth, costOfEquity}),
          inputs: {bookValuePerShare: book, normalizedROE: roe, perpetualGrowth: growth, costOfEquity},
          assumptions: ['Historical annual ROE uses end-period equity.',
            'Default perpetual growth 4% and cost of equity 9.5% are experimental model assumptions when no explicit inputs are supplied.']});
      }
    }
    if (!variants.length) return unavailable('Dividend/book-value inputs are insufficient for the selected bank/REIT method.');
    const selected = variants.find(variant => variant.key === request.ivMethod) ||
      variants.find(variant => variant.key === (family === 'bank' ? 'justified_pb' : 'historical_pb')) || variants[0];
    return completed({...common, ...selected, methodId: selected.key, variants: variants.map(variant => ({...variant, methodId: variant.key})), assumptions: [
      'Valuation variants are independent calculations; no published IV is used as an input.',
      'Unadjusted-equity P/B is not the same as P/TBV; method and input differences must be reconciled before calling it Adam-matched.',
      ...(selected.assumptions || []),
    ]});
  }

  const normalizedAnnual = annual.map(row => ({...row, fcf: finite(row.cfo) && finite(row.capex) ? row.cfo - row.capex : null}));
  let base = finite(current.cfo) && finite(current.capex) ? current.cfo - current.capex : null;
  let field = 'fcf', method = 'Historical-growth DCF20', cash = current.cash, debt = current.totalDebt;
  const notes = [];
  const capex = annual.filter(row => finite(row.capex) && row.capex >= 0).slice(-5).map(row => row.capex);
  if (finite(current.cfo) && capex.length === 5 && Math.max(...capex) > Math.max(1, Math.min(...capex)) * 2) {
    base = current.cfo - mean(capex);
    method = 'Historical-growth normalized DCF20';
    notes.push('Uneven CapEx is normalized using the last five annual outflows.');
  }
  if (!(base > 0)) {
    if (!(current.netIncome > 0)) return unavailable('Neither positive free cash flow nor positive net income is available for this model.');
    base = current.netIncome;
    field = 'netIncome'; method = 'Historical-growth discounted net income20';
    // Net income is already after financing costs; do not add/subtract the
    // enterprise-value cash/debt bridge a second time in the DNI alternative.
    cash = 0; debt = 0;
    notes.push('Positive net income replaces unavailable/non-positive FCF; no cash/debt bridge is added.');
  } else if (!finite(cash) || !finite(debt)) {
    return unavailable('Cash or total debt is missing; neither is assumed to be zero.');
  }
  const growth = historicalGrowth(normalizedAnnual, field, base);
  if (!growth) return unavailable('At least three positive annual cash-flow/earnings observations spanning two years are needed for an independent growth estimate.');
  const g1 = finite(assumptions.g1) ? assumptions.g1 : clamp(growth.raw, -.05, .25);
  const g2 = finite(assumptions.g2) ? assumptions.g2 : Math.min(g1, .15);
  const g3 = finite(assumptions.g3) ? assumptions.g3 : .04;
  const beta = finite(facts.beta) ? clamp(facts.beta, .8, 1.6) : 1;
  const riskFree = currency === 'HKD' ? .03068 : .03608;
  const marketPremium = currency === 'HKD' ? .06862 : .02728;
  const discountRate = finite(assumptions.discountRate) ? assumptions.discountRate :
    currency === 'SGD' ? .095 : Math.round((riskFree + beta * marketPremium) * 10000) / 10000;
  let valuation;
  try { valuation = dcf20({fcf0: base, g1, g2, g3, discountRate, cash, debt, shares: share}); }
  catch { return unavailable('The supplied growth or discount assumptions are invalid.', 'invalid_assumptions'); }
  return completed({...common, value: valuation.value, method, key: field === 'fcf' ? 'dcf_20y' : 'dni_20y',
    methodId: field === 'fcf' ? 'dcf_20y' : 'dni_20y',
    inputs: {baseFlow: base, shares: share, cash, debt, g1, g2, g3, discountRate, beta, historicalGrowth: growth},
    assumptions: [...notes,
      'Growth is estimated from historical statements, not current or historical analyst consensus.',
      'Default stage-one growth is historical CAGR capped to -5%–25%; stage two is at most 15%; years 11–20 use 4%.',
      'Twenty discounted annual flows; no perpetual terminal value.',
      `Default discount policy uses dated 11 March 2026 ${currency === 'HKD' ? 'Hong Kong' : 'US'} teaching inputs rather than a live risk-free rate; missing beta defaults to 1. SGD stocks without an explicit rate use an experimental 9.5% rate.`,
      'Inputs and method remain experimental until dated reference comparisons pass the validation protocol.',
    ]});
}

function aggregate(bars, frame, cutoff, completedOnly) {
  const groups = new Map();
  for (const bar of bars) {
    const day = new Date(bar.date + 'T00:00:00Z');
    const end = frame === 'monthly' ? new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)) :
      new Date(day.getTime() + ((5 - day.getUTCDay() + 7) % 7) * dayMs);
    const endDay = isoDay(end);
    if (completedOnly && endDay > cutoff) continue;
    if (!groups.has(endDay)) groups.set(endDay, []);
    groups.get(endDay).push(bar);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([end, rows]) => ({
    date: end > cutoff ? cutoff : end, open: rows[0].open, close: rows.at(-1).close,
    high: Math.max(...rows.map(row => row.high)), low: Math.min(...rows.map(row => row.low)),
  }));
}
function ema(values, span) {
  const result = [], alpha = 2 / (span + 1);
  for (const value of values) result.push(result.length ? alpha * value + (1 - alpha) * result.at(-1) : value);
  return result;
}
const touches = flags => flags.reduce((count, value, index) => count + (value && (!index || !flags[index - 1]) ? 1 : 0), 0);

/** The ranking port preserves the existing prototype: monthly/weekly pivots,
 * repeated reactions, former-resistance retests and MA confluence. */
export function calculateSupports(data, request = {}, asOf = new Date().toISOString().slice(0, 10)) {
  const bars = (data.bars || []).filter(bar => bar.date <= asOf &&
    [bar.open, bar.high, bar.low, bar.close].every(value => finite(value) && value > 0) &&
    bar.high >= Math.max(bar.open, bar.low, bar.close) && bar.low <= Math.min(bar.open, bar.high, bar.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length < 20) return unavailable('Fewer than twenty usable historical bars were retrieved.', 'insufficient_history');
  if (new Set(bars.map(bar => bar.date)).size !== bars.length) return unavailable('Price history contains duplicate dates.', 'invalid_history');
  const tolerance = .01, candidates = [], warnings = [];
  for (const frame of ['weekly', 'monthly']) {
    const xs = aggregate(bars, frame, asOf, request.completedPeriodsOnly === true);
    if (xs.length < 5) { warnings.push(`Insufficient ${frame} history for pivots.`); continue; }
    for (let index = 2; index < xs.length - 2; index++) {
      const window = xs.slice(index - 2, index + 3);
      for (const kind of ['swing_low', 'former_resistance']) {
        const value = kind === 'swing_low' ? xs[index].low : xs[index].high;
        let flags;
        if (kind === 'swing_low') {
          if (value !== Math.min(...window.map(bar => bar.low))) continue;
          flags = xs.slice(index).map(bar => bar.low <= value * (1 + tolerance) && bar.high >= value * (1 - tolerance));
        } else {
          if (value !== Math.max(...window.map(bar => bar.high))) continue;
          const later = xs.slice(index + 3), breakout = later.findIndex(bar => bar.close > value * (1 + tolerance));
          if (breakout < 0) continue;
          flags = later.slice(breakout + 1).map(bar => bar.low <= value * (1 + tolerance) && bar.close >= value);
          if (!flags.some(Boolean)) continue;
        }
        const count = touches(flags);
        candidates.push({price: value, kind, frame, origin: xs[index].date, confirmed: xs[index + 2].date,
          touches: count, score: count + (frame === 'monthly' ? 2 : 1)});
      }
    }
    const closes = xs.map(bar => bar.close);
    for (const [kind, span] of frame === 'weekly' ? [['ema', 20], ['ema', 40]] : [['ema', 40], ['sma', 50]]) {
      const required = kind === 'ema' ? span * 3 : span;
      if (xs.length < required) { warnings.push(`Insufficient warm-up for ${frame} ${kind}${span}.`); continue; }
      const values = kind === 'ema' ? ema(closes, span) : closes.map((_, index) => index < span - 1 ? null : mean(closes.slice(index - span + 1, index + 1)));
      const start = Math.max(required - 1, xs.length - 80);
      const count = touches(xs.slice(start).map((bar, offset) => bar.low <= values[start + offset] * (1 + tolerance) && bar.close >= values[start + offset]));
      if (count < 2) continue;
      candidates.push({price: values.at(-1), kind: kind + span, frame, origin: xs.at(-1).date, confirmed: xs.at(-1).date,
        touches: count, score: count + (frame === 'monthly' ? 2 : 1)});
    }
  }
  const clusters = [];
  for (const item of candidates.sort((a, b) => a.price - b.price)) {
    const last = clusters.at(-1);
    if (last && Math.abs(item.price / last.price - 1) <= tolerance) {
      last.evidence.push(item);
      last.price = [...last.evidence].sort((a, b) => b.score - a.score)[0].price;
    } else clusters.push({price: item.price, evidence: [item]});
  }
  for (const cluster of clusters) cluster.score = Math.max(...cluster.evidence.map(row => row.score)) + cluster.evidence.length - 1;
  const iv = request.ivForFilter;
  if (request.filterBelowIV === true && !finite(iv)) return unavailable('An explicit numeric IV is required for the optional below-IV filter.', 'missing_filter_input');
  const eligible = request.filterBelowIV === true ? clusters.filter(row => row.price <= iv) : clusters;
  const selected = [...eligible].sort((a, b) => b.score - a.score || b.price - a.price).slice(0, 5).sort((a, b) => b.price - a.price);
  if (!selected.length) return unavailable('No confirmed support candidates passed this model; no levels were invented.', 'no_confirmed_levels');
  return completed({value: selected.map(row => row.price), source: data.history?.source || data.historySource || 'Public daily OHLC',
    method: 'Experimental monthly/weekly support confluence', asOf, modelVersion: MODEL_VERSION,
    lastObservation: bars.at(-1).date, currency: data.instrument?.currency || null,
    adjustment: data.history?.adjustment || data.adjustment || 'provider split-adjusted OHLC',
    partialPeriodsIncluded: request.completedPeriodsOnly !== true, ivFilterApplied: request.filterBelowIV === true,
    pointInTimeVerified: data.history?.adjustmentVintageVerified === true,
    vintageReason: data.history?.vintageReason || (data.history?.adjustmentVintageVerified ? null : 'Historical split-adjustment vintage has not been verified.'),
    evidence: selected.map(row => ({...row, evidenceCount: row.evidence.length,
      evidence: [...row.evidence].sort((a,b)=>b.score-a.score).slice(0,6)})), warnings, assumptions: [
      'Support ranking is an uncalibrated reconstruction, not a verified reproduction of Adam’s published selection.',
      'Two later bars are required to confirm a pivot. Consecutive touches in the same zone count as one visit.',
      'Former resistance requires a breakout and a later retest. Broken levels may remain.',
      'Below-IV filtering is off unless explicitly requested. Three to five levels are not forced.',
    ]});
}
