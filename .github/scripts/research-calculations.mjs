import {normalizeValuationSettings, IV_POLICY_VERSION} from '../../assets/valuation-settings.js';
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

export function discountedCashFlow({fcf0, g1, g2, g3 = .04, discountRate, cash, debt, shares,
  years = 20, terminalGrowth = null, terminalTiming = 'end_forecast', additionalAssets = 0}) {
  if (![fcf0, g1, g2, g3, discountRate, cash, debt, shares, additionalAssets].every(finite) ||
      shares <= 0 || additionalAssets < 0 || discountRate <= -1 || Math.min(g1, g2, g3) <= -1 ||
      ![10,20].includes(years) || !['end_forecast','following_year'].includes(terminalTiming) || terminalGrowth !== null &&
      (!finite(terminalGrowth) || terminalGrowth <= -1 || discountRate <= terminalGrowth)) {
    throw new TypeError('Invalid DCF inputs');
  }
  let flow = fcf0, present = 0;
  const schedule = [];
  for (let year = 1; year <= years; year++) {
    const growth = year <= 5 ? g1 : year <= 10 ? g2 : g3;
    flow *= 1 + growth;
    const pv = flow / (1 + discountRate) ** year;
    present += pv;
    schedule.push({year, growth, cashFlow: flow, pv});
  }
  const terminalValue = terminalGrowth === null ? 0 : flow * (1 + terminalGrowth) / (discountRate - terminalGrowth);
  const terminalDiscountYear = years + (terminalTiming === 'following_year' ? 1 : 0);
  const terminalPresentValue = terminalValue / (1 + discountRate) ** terminalDiscountYear;
  return {value: (present + terminalPresentValue + cash - debt + additionalAssets) / shares,
    presentValue: present, terminalValue, terminalPresentValue, terminalDiscountYear, schedule};
}

export function dcf20(inputs) {
  return discountedCashFlow({...inputs, years:20, terminalGrowth:null});
}

/** Per-listing-unit distributions: no second cash/debt or share-count bridge. */
export function dividendDiscount({dividend0, growthRates, discountRate, terminalGrowth}) {
  if (![dividend0, discountRate, terminalGrowth].every(finite) || dividend0 <= 0 ||
      discountRate <= -1 || terminalGrowth <= -1 || discountRate <= terminalGrowth ||
      !Array.isArray(growthRates) || !growthRates.length || growthRates.length > 20 ||
      growthRates.some(value=>!finite(value)||value<=-1)) throw new TypeError('Invalid dividend discount inputs');
  let dividend=dividend0,presentValue=0;
  const schedule=growthRates.map((growth,index)=>{
    dividend*=1+growth;
    const pv=dividend/(1+discountRate)**(index+1);
    presentValue+=pv;
    return {year:index+1,growth,dividend,pv};
  });
  const terminalValue=dividend*(1+terminalGrowth)/(discountRate-terminalGrowth);
  const terminalPresentValue=terminalValue/(1+discountRate)**growthRates.length;
  return {value:presentValue+terminalPresentValue,presentValue,terminalValue,terminalPresentValue,schedule};
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
  let settings;
  try { settings=normalizeValuationSettings(request.valuation || {}); }
  catch(error) { return unavailable(error.message,'invalid_assumptions'); }
  if(settings.inputsAsOf>asOf)return unavailable('Valuation input date is later than the requested calculation date.','input_vintage_required');
  const instrument=data.instrument||{};
  const bookMethods=['historical_pb','peer_pb','justified_pb','nav'];
  const payoutMethods=['yield','ddm'];
  const explicitUnit=bookMethods.includes(settings.method)&&finite(settings.bookValuePerShare)||
    payoutMethods.includes(settings.method)&&finite(settings.dividendPerShare)||
    settings.method==='pe'&&finite(settings.earningsPerShare);
  const facts=data.fundamentals||(explicitUnit?{financialCurrency:instrument.currency,ttm:{},annual:[]}:null);
  const suppliedFamily=request.methodFamilySource==='user'?request.methodFamily:null;
  const providerFamily=['stock','bank','reit','insurance','financial_other','fund','etf'].includes(instrument.methodFamily)?instrument.methodFamily:null;
  const family=String(suppliedFamily||providerFamily||request.methodFamily||'unknown').toLowerCase();
  let method=settings.method||'auto';
  const fund=['ETF','MUTUALFUND','INDEX'].includes(String(instrument.type).toUpperCase())||['fund','etf'].includes(family);
  if(fund&&method==='auto')return {processing:'unsupported',validation:'not_applicable',result:null,
    reason:'Company DCF IV is not applicable to this fund/index. Select NAV with a dated fund NAV for closed-end funds.'};
  if(!facts)return unavailable('Financial inputs could not be retrieved. Technical support calculation can still complete.');
  const currency=instrument.currency;
  const listingPayout=payoutMethods.includes(method);
  if(!currency||!listingPayout&&(!facts.financialCurrency||(currency!==facts.financialCurrency&&!finite(settings.fxRate))))
    return unavailable('Financial-statement and listing currencies are not verified as identical; an explicit FX/listing mapping is required.','currency_mapping_required');
  const fx=currency===facts.financialCurrency?1:settings.fxRate;
  const current=facts.ttm||{},share=settings.shares??current.shares;
  // Dated per-listing-unit inputs need no second ordinary/ADR share conversion.
  const perUnit=bookMethods.includes(method)&&finite(settings.bookValuePerShare)||listingPayout||
    method==='pe'&&finite(settings.earningsPerShare);
  if(!perUnit&&facts.listingSharesVerified!==true&&!finite(settings.shares)){
    const diagnostics=[...new Set((data.warnings||[]).filter(code=>/^SEC_[A-Z0-9_]{1,80}$/.test(code)))].slice(0,5);
    return unavailable(['Share or ADR denominator is not verified for this listing.',facts.listingSharesReason,
      diagnostics.length?'Provider diagnostics: '+diagnostics.join(', ')+'.':''].filter(Boolean).join(' '),'share_mapping_required');
  }
  if(!perUnit&&!(share>0))return unavailable('Current share count is missing or invalid.');
  const annual=(facts.annual||[]).filter(row=>row.end<=asOf).sort((a,b)=>a.end.localeCompare(b.end));
  const assumptions={...(request.assumptions||{}),...settings};
  const notes=[];
  const common={source:facts.source||'Public financial statements',asOf,financialAsOf:facts.asOf||current.end||asOf,
    currency,methodFamily:family,modelVersion:MODEL_VERSION,policyVersion:IV_POLICY_VERSION,
    financialInputs:compactFinancialArchive(facts,annual,current),
    pointInTimeVerified:facts.pointInTimeVerified===true&&!settings.source,
    vintageReason:settings.source?'User-supplied assumptions retain their source date; publication vintage is not independently verified.':facts.vintageReason||'Financial publication vintage requires review.',
    settingsSource:settings.source||null,settingsAsOf:settings.inputsAsOf||null};
  const finish=(value,id,label,inputs,variants=[])=> {
    if(!finite(value)||value<=0)return unavailable('The selected method does not produce a positive equity value. Review the inputs.','nonpositive_equity_value');
    return completed({...common,value,key:id,methodId:id,method:label,inputs,
      variants:variants.map(v=>({...v,methodId:v.key})),assumptions:notes});
  };
  if(method==='auto'){
    if(['bank','reit','insurance'].includes(family))method=family==='bank'?'justified_pb':'historical_pb';
    else if(family==='financial_other')method='dni';
    else if(family==='stock')method='dcf';
    else return unavailable('The valuation family is not classified. Select a valuation method after reviewing the business.','method_family_required');
  }
  const book=settings.bookValuePerShare??(finite(current.equity)&&current.equity>0?current.equity/share:null);
  const dividend=settings.dividendPerShare??facts.dividendPerShareTTM??current.dividendPerShareTTM;
  if(method==='ddm'){
    if(!(dividend>0)||!settings.dividendGrowthRates?.length||!finite(settings.discountRate)||!finite(settings.terminalGrowth))
      return unavailable('Dividend discount needs a positive base DPU, explicit annual forward growth path, discount rate and perpetual terminal growth.','dividend_forecast_required');
    if(settings.discountRate<=settings.terminalGrowth)
      return unavailable('The dividend discount rate must exceed perpetual terminal growth.','invalid_terminal_rate');
    const model=dividendDiscount({dividend0:dividend,growthRates:settings.dividendGrowthRates,
      discountRate:settings.discountRate,terminalGrowth:settings.terminalGrowth});
    notes.push('Per-listing-unit dividend model: forecast years start after the base DPU period. Historical base-year growth is excluded.');
    notes.push('Discounted forward distributions plus a Gordon terminal value. No additional cash/debt or share-count bridge.');
    return finish(model.value,'ddm','Dividend discount · explicit forecasts + terminal value',
      {dividendPerShare:dividend,growthRates:settings.dividendGrowthRates,discountRate:settings.discountRate,
        terminalGrowth:settings.terminalGrowth,forecastYears:model.schedule.length,
        distributionsPresentValue:model.presentValue,terminalPresentValue:model.terminalPresentValue,
        dividendBasis:settings.dividendPerShare?'user_dated_dividend':'trailing_provider_dividends'});
  }
  if(['historical_pb','peer_pb','justified_pb','nav','yield'].includes(method)){
    const variants=[];
    const yieldRate=settings.targetYield??.05;
    if(finite(dividend)&&dividend>0)variants.push({key:yieldRate===.05?'yield_5pct':'yield_price',
      method:'Dividend yield price',value:dividend/yieldRate,basis:settings.dividendPerShare?'user_dated_dividend':'trailing_provider_dividends',
      inputs:{dividendPerShare:dividend,targetYield:yieldRate}});
    const historical=method!=='peer_pb'&&data.history?.splitEventsComplete===true&&data.history?.adjustmentVintageVerified===true?
      historicalPB(annual,data.bars||[],data.history.splitEvents||[]):null;
    const multiple=settings.historicalMultiple??(method==='peer_pb'?null:historical?.multiple);
    if(book>0&&multiple>0)variants.push({key:method==='peer_pb'?'peer_pb':'historical_pb',
      method:method==='peer_pb'?'Peer P/B · supplied multiple':settings.historicalMultiple?'Historical P/B / P/NAV · supplied multiple':'Historical P/B · annual sample proxy',
      value:book*multiple*fx,basis:'unadjusted_equity',inputs:{bookValuePerShare:book,
        ...(method==='peer_pb'?{peerPB:multiple,referenceBasis:'peer'}:{historicalPB:multiple,referenceBasis:'historical'}),
        fxRate:fx,observations:settings.historicalMultiple?[]:historical?.observations||[]}});
    if(['bank','justified_pb'].includes(family)||method==='justified_pb'){
      const roes=annual.filter(r=>finite(r.netIncome)&&r.equity>0).slice(-5).map(r=>r.netIncome/r.equity);
      const roe=settings.roe??(roes.length>=3?mean(roes):null);
      const growth=assumptions.perpetualGrowth??.04,cost=assumptions.costOfEquity??.095;
      if(finite(roe)&&book>0&&cost>growth)variants.push({key:'justified_pb',method:'ROE-adjusted P/B',
        value:justifiedPB({bookValuePerShare:book,roe,growth,costOfEquity:cost}).value*fx,
        inputs:{bookValuePerShare:book,normalizedROE:roe,perpetualGrowth:growth,costOfEquity:cost,fxRate:fx}});
    }
    if(method==='nav'){
      if(!(book>0))return unavailable('A dated NAV per listing unit is needed.','nav_required');
      return finish(book*fx,'nav','Net asset value per unit',{navPerUnit:book,fxRate:fx});
    }
    const id=method==='yield'?(yieldRate===.05?'yield_5pct':'yield_price'):method;
    const selected=variants.find(v=>v.key===(request.ivMethod||id));
    if(!selected)return unavailable('Inputs are insufficient for the selected valuation method. Supply the historical multiple, normalized ROE, NAV or distribution as applicable.');
    notes.push(method==='peer_pb'?'Peer P/B needs an explicitly selected peer basket, aggregation and matching book basis in the source rationale.':
      'Historical multiples need a matching lookback and book/NAV basis. Annual samples are disclosed proxies for daily-average multiples.');
    notes.push('Dividend yield prices are a separate variant from book/NAV fair value. Review forward dividends and special distributions.');
    if(!settings.roe&&family==='bank')notes.push('Default bank ROE uses five annual end-equity observations. Long-run growth 4% and cost of equity 9.5% are proxy assumptions unless supplied.');
    const result=finish(selected.value,selected.key,selected.method,selected.inputs,variants);
    if(result.result)result.result.basis=selected.basis||null;
    return result;
  }
  if(method==='pe'){
    const eps=settings.earningsPerShare??(finite(current.netIncome)?current.netIncome/share:null);
    if(!(eps>0)||!(settings.historicalMultiple>0))
      return unavailable('Price/earnings needs positive listing-equivalent EPS and a dated selected P/E multiple.','earnings_multiple_required');
    notes.push('The selected P/E multiple and EPS basis must share a source date; historical and peer multiples are not interchangeable.');
    return finish(eps*settings.historicalMultiple*fx,'earnings_multiple','Price/earnings · supplied multiple',
      {earningsPerShare:eps,multiple:settings.historicalMultiple,fxRate:fx});
  }
  const revenue=current.revenue;
  if(['ps','psg'].includes(method)){
    if(!(revenue>0&&share>0))return unavailable('Positive revenue and verified shares are needed for sales valuation.');
    const revenuePerShare=revenue/share;
    if(method==='ps'){
      if(!(settings.historicalMultiple>0))return unavailable('Supply a dated historical P/S multiple.','historical_multiple_required');
      return finish(revenuePerShare*settings.historicalMultiple*fx,'historical_ps','Historical P/S',{revenuePerShare,multiple:settings.historicalMultiple,fxRate:fx});
    }
    const growth=selectedGrowth(settings);
    if(!(growth>0))return unavailable('Supply a dated forward revenue-growth forecast for PSG.','revenue_forecast_required');
    // AK's 0.2 rule uses growth in percentage points, e.g. 70%, entered as 70.
    const multiple=.2*(growth*100);
    return finish(revenuePerShare*multiple*fx,'psg','Price/sales-to-growth',{revenuePerShare,revenueGrowth:growth,psg:.2,impliedPS:multiple,fxRate:fx});
  }
  const normalizedAnnual=annual.map(r=>({...r,fcf:finite(r.cfo)&&finite(r.capex)?r.cfo-r.capex:null}));
  let field=method==='ocf'?'cfo':method==='dni'?'netIncome':'fcf';
  const history=normalizedAnnual.filter(r=>finite(r[field])).slice(-(settings.flowYears||5));
  let base=method==='dcf'&&finite(current.cfo)&&finite(current.capex)?current.cfo-current.capex:current[field];
  const capex=annual.filter(r=>finite(r.capex)&&r.capex>=0).slice(-5).map(r=>r.capex);
  const capexYears=settings.capexYears??(method==='dcf'&&capex.length===5&&Math.max(...capex)>Math.max(1,Math.min(...capex))*2?5:0);
  if(method==='dcf'&&capexYears){
    const values=capex.slice(-capexYears);
    if(values.length!==capexYears||!finite(current.cfo))return unavailable('The selected CapEx normalization window is incomplete.');
    base=current.cfo-mean(values);
    notes.push('TTM operating cash flow minus '+capexYears+'-year average annual CapEx.');
  }
  if(settings.flowYears){
    if(history.length!==settings.flowYears)return unavailable('The selected flow normalization window is incomplete.');
    base=mean(history.map(r=>r[field]));
    notes.push(settings.flowYears+'-year average starting '+field+'.');
  }
  if(finite(settings.baseFlow))base=settings.baseFlow;
  const baseFlowBeforeAdjustment=base,sbcFraction=settings.sbcFraction??0;
  const stockBasedCompensation=settings.stockBasedCompensation??current.stockBasedCompensation;
  if(sbcFraction>0){
    if(!['dcf','ocf'].includes(method)||!finite(stockBasedCompensation)||stockBasedCompensation<0)
      return unavailable('An SBC deduction needs a nonnegative charge for the selected FCF/OCF starting-flow period.','sbc_basis_required');
    base-=stockBasedCompensation*sbcFraction;
    notes.push('Subtract '+(sbcFraction*100)+'% of the supplied SBC charge from the selected starting flow. Do not supply an already-adjusted base as well.');
  }
  if(!(base>0))return unavailable('The selected starting cash flow or earnings is not positive. Review normalization or select an earnings, book or sales method.','flow_basis_required');
  const cash=settings.cash??current.cash,debt=settings.debt??current.totalDebt;
  if(!finite(cash)||!finite(debt))return unavailable('Cash or total debt is missing; neither is assumed to be zero.');
  const additionalAssets=settings.additionalAssets??0;
  if(additionalAssets>0&&method!=='dni')
    return unavailable('Additional assets are supported with DNI only; exclude their earnings from the projected base to avoid double counting.','additional_asset_basis_required');
  const historical=historicalGrowth(normalizedAnnual,field,base);
  let g1=selectedGrowth(settings);
  const forward=finite(g1);
  if(!forward)g1=finite(assumptions.g1)?assumptions.g1:historical?clamp(historical.raw,-.05,.25):null;
  if(!finite(g1))return unavailable('Supply a forward growth estimate or sufficient positive historical flow observations.');
  const g2=finite(assumptions.g2)?assumptions.g2:Math.min(g1,.15),g3=finite(assumptions.g3)?assumptions.g3:.04;
  const beta=finite(facts.beta)?clamp(facts.beta,.8,1.6):1;
  const rf=currency==='HKD'?.03068:.03608,mrp=currency==='HKD'?.06862:.02728;
  const discount=finite(assumptions.discountRate)?assumptions.discountRate:currency==='SGD'?.095:Math.round((rf+beta*mrp)*10000)/10000;
  const projection=settings.projection||'finite_20',terminal=projection==='terminal_10',years=projection==='finite_20'?20:10;
  if(terminal&&(!forward||!finite(settings.g2)||!finite(settings.discountRate)||!finite(settings.terminalGrowth)))
    return unavailable('Terminal DCF needs dated forward growth, explicit stage-two growth, discount rate and perpetual terminal growth.','terminal_inputs_required');
  if(terminal&&discount<=settings.terminalGrowth)
    return unavailable('The cash-flow discount rate must exceed perpetual terminal growth.','invalid_terminal_rate');
  const model=discountedCashFlow({fcf0:base,g1,g2,g3,discountRate:discount,cash,debt,shares:share,
    years,terminalGrowth:terminal?settings.terminalGrowth:null,terminalTiming:settings.terminalTiming,additionalAssets});
  const value=model.value*fx;
  notes.push(forward?'Growth from dated supplied forecasts or direct scenario input.':'Growth is a historical-flow proxy, not current or historical analyst consensus. Historical CAGR is capped to -5%–25%.');
  notes.push('Years 6–10 default to the smaller of stage-one growth and 15%; an explicit scenario can change this.');
  if(years===20)notes.push('The final decade defaults to 4%; an explicit scenario can change this.');
  notes.push(terminal?'Ten discounted annual flows plus a perpetual terminal value from year eleven.':
    years===10?'Ten discounted annual flows; no perpetual terminal value.':'Twenty discounted annual flows; no perpetual terminal value.');
  notes.push('Cash and debt bridge follows the selected teaching calculator, including DNI.');
  if(terminal)notes.push('Terminal component discounted at year '+model.terminalDiscountYear+'. The October 2025 WM worksheet is numerically consistent with the optional year-11 convention.');
  if(additionalAssets>0)notes.push('Additional assets are added separately; their earnings and gains must be excluded from the projected DNI base.');
  if(!finite(assumptions.discountRate))notes.push('Discount proxy uses dated March 2026 teaching inputs; missing beta defaults to 1. SGD defaults to 9.5%.');
  const id=method+(terminal?'_terminal':'_'+years+'y');
  return finish(value,id,(forward?'Forecast':'Historical-growth proxy')+' '+({dcf:'FCF',ocf:'OCF',dni:'DNI'}[method])+(terminal?' · terminal value':years),
    {baseFlow:base,baseFlowBeforeAdjustment,stockBasedCompensation:stockBasedCompensation??null,sbcFraction,additionalAssets,
      flowBasis:method,capexYears,flowYears:settings.flowYears||0,shares:share,cash,debt,g1,g2,
      ...(years===20?{g3}:{}),projection,forecastYears:years,
      ...(terminal?{terminalGrowth:settings.terminalGrowth,terminalPresentValue:model.terminalPresentValue,
        terminalTiming:settings.terminalTiming||'end_forecast',terminalDiscountYear:model.terminalDiscountYear}:{}),
      discountRate:discount,beta,fxRate:fx,historicalGrowth:historical});
}

function selectedGrowth(settings) {
  if(finite(settings.g1))return settings.g1;
  const estimates=settings.growthEstimates||[];
  if(!estimates.length)return null;
  if(settings.growthSelection==='lowest')return Math.min(...estimates);
  if(settings.growthSelection==='highest')return Math.max(...estimates);
  if(settings.growthSelection==='median'){
    const sorted=[...estimates].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
  }
  return mean(estimates);
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
