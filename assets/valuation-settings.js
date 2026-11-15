// All rates are decimal fractions in storage. Financial amounts use full units.
export const IV_POLICY_VERSION = 'business-methods-20261115';
export const VALUATION_METHODS = [
  ['auto','Auto'], ['dcf','Free cash flow · 20 years'], ['ocf','Operating cash flow · 20 years'],
  ['dni','Net income · 20 years'], ['historical_pb','Historical P/B or P/NAV'],
  ['justified_pb','ROE-adjusted P/B'], ['nav','NAV per unit'],
  ['ps','Historical price/sales'], ['psg','Price/sales-to-growth'], ['yield','Dividend yield price'],
];
export const VALUATION_NUMBERS = [
  ['baseFlow','Starting flow (full financial-currency units)'], ['shares','Listing-equivalent shares (full units)'],
  ['cash','Cash + short-term investments'], ['debt','Debt'],
  ['fxRate','Listing-currency units per financial-currency unit'], ['bookValuePerShare','Book / NAV per listing unit'],
  ['historicalMultiple','Historical P/B, P/NAV or P/S multiple'], ['dividendPerShare','Annual dividend / DPU (listing currency)'],
];
export const VALUATION_RATES = [
  ['g1','Growth years 1–5 (%)'], ['g2','Growth years 6–10 (%)'], ['g3','Growth years 11–20 (%)'],
  ['discountRate','Discount rate (%)'], ['roe','Normalized ROE (%)'],
  ['perpetualGrowth','Long-run book growth (%)'], ['costOfEquity','Cost of equity (%)'],
  ['targetYield','Required dividend yield (%)'],
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
      if (['cash','debt','dividendPerShare'].includes(key) && value < 0) throw Error('Cash, debt and distributions cannot be negative.');
      if (['g1','g2','g3','perpetualGrowth','discountRate'].includes(key) && value <= -1) throw Error('Growth and discount rates must exceed -100%.');
      result[key]=value;
    } else if (key === 'method') {
      if (!VALUATION_METHODS.some(([id])=>id===value)) throw Error('Unknown valuation method.');
      result[key]=value;
    } else if (['capexYears','flowYears'].includes(key)) {
      if (![0,3,5].includes(value)) throw Error('Normalization period must be current, three years or five years.');
      result[key]=value;
    } else if (key === 'growthSelection') {
      if (!['historical','average','lowest','highest'].includes(value)) throw Error('Unknown growth selection.');
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
  const hasInputs=Object.keys(result).some(k=>numbers.has(k))||result.growthEstimates?.length;
  if(hasInputs&&(!result.source||!result.inputsAsOf))throw Error('Add the source and date for your valuation inputs.');
  return result;
}
