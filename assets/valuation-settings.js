// All rates are decimal fractions in storage. Financial amounts use full units.
export const IV_POLICY_VERSION = 'archive-methods-20261117';
export const VALUATION_METHODS = [
  ['auto','Auto'], ['dcf','Free cash flow'], ['ocf','Operating cash flow'],
  ['dni','Net income'], ['historical_pb','Historical P/B or P/NAV'],
  ['peer_pb','Peer P/B'], ['pe','Price/earnings · selected multiple'],
  ['justified_pb','ROE-adjusted P/B'], ['nav','NAV per unit'],
  ['ps','Historical price/sales'], ['psg','Price/sales-to-growth'], ['yield','Dividend yield price'],
  ['ddm','Dividend discount · explicit forecasts + terminal value'],
];
export const VALUATION_NUMBERS = [
  ['baseFlow','Starting flow before SBC adjustment (full financial-currency units)'], ['shares','Listing-equivalent shares (full units)'],
  ['cash','Cash + short-term investments'], ['debt','Debt'],
  ['fxRate','Listing-currency units per financial-currency unit'], ['bookValuePerShare','Book / NAV per listing unit'],
  ['historicalMultiple','Selected P/E, P/B, P/NAV or P/S multiple'], ['dividendPerShare','Annual dividend / DPU (listing currency)'],
  ['earningsPerShare','Earnings per listing unit (financial currency)'],
  ['stockBasedCompensation','SBC charge for the starting-flow period'],
  ['additionalAssets','Additional assets excluded from projected earnings'],
];
export const VALUATION_RATES = [
  ['g1','Growth years 1–5 (%)'], ['g2','Growth years 6–10 (%)'], ['g3','Growth years 11–20 (%)'],
  ['discountRate','Discount rate (%)'], ['roe','Normalized ROE (%)'],
  ['perpetualGrowth','Long-run book growth (%)'], ['costOfEquity','Cost of equity (%)'],
  ['targetYield','Required dividend yield (%)'],
  ['terminalGrowth','Perpetual terminal growth (%)'], ['sbcFraction','SBC charge to subtract (%)'],
];
const numbers = new Set([...VALUATION_NUMBERS,...VALUATION_RATES].map(([key])=>key));
export function normalizeValuationSettings(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid valuation settings.');
  const result = {};
  for (const [key,value] of Object.entries(raw)) {
    if (numbers.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Valuation inputs must be finite numbers.');
      if (['shares','fxRate','bookValuePerShare','historicalMultiple','targetYield','costOfEquity'].includes(key) && value <= 0)
        throw Error('Shares, conversion rates, multiples and required returns must be positive.');
      if (['cash','debt','dividendPerShare','stockBasedCompensation','additionalAssets'].includes(key) && value < 0) throw Error('Cash, debt, distributions and adjustments cannot be negative.');
      if (['g1','g2','g3','perpetualGrowth','terminalGrowth','discountRate'].includes(key) && value <= -1) throw Error('Growth and discount rates must exceed -100%.');
      if (key === 'sbcFraction' && (value < 0 || value > 1)) throw Error('The SBC deduction must be between 0% and 100%.');
      result[key]=value;
    } else if (key === 'method') {
      if (!VALUATION_METHODS.some(([id])=>id===value)) throw Error('Unknown valuation method.');
      result[key]=value;
    } else if (['capexYears','flowYears'].includes(key)) {
      if (![0,3,5].includes(value)) throw Error('Normalization period must be current, three years or five years.');
      result[key]=value;
    } else if (key === 'growthSelection') {
      if (!['historical','average','median','lowest','highest'].includes(value)) throw Error('Unknown growth selection.');
      result[key]=value;
    } else if (key === 'projection') {
      if (!['finite_20','finite_10','terminal_10'].includes(value)) throw Error('Unknown projection model.');
      result[key]=value;
    } else if (key === 'terminalTiming') {
      if (!['end_forecast','following_year'].includes(value)) throw Error('Unknown terminal discount timing.');
      result[key]=value;
    } else if (key === 'dividendGrowthRates') {
      if (!Array.isArray(value)||value.length<1||value.length>20||value.some(v=>!Number.isFinite(v)||v<=-1)) throw Error('Supply one to twenty valid annual dividend growth rates.');
      result[key]=value;
    } else if (key === 'growthEstimates') {
      if (!Array.isArray(value)||value.length>12||value.some(v=>!Number.isFinite(v)||v<=-1)) throw Error('Invalid analyst growth estimates.');
      result[key]=value;
    } else if (key === 'inputsAsOf') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)
        throw Error('Enter a valid input date.');
      result[key]=value;
    } else if (key === 'source') {
      if (typeof value !== 'string'||value.length>600) throw Error('Source must be at most 600 characters.');
      result[key]=value.trim();
    } else throw Error('Unknown valuation setting.');
  }
  const hasInputs=Object.keys(result).some(k=>numbers.has(k))||result.growthEstimates?.length||result.dividendGrowthRates?.length;
  if(hasInputs&&(!result.source||!result.inputsAsOf))throw Error('Add the source and date for your valuation inputs.');
  return result;
}
