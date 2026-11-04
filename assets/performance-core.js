// Pure calculations shared by the browser and the personal snapshot worker.
export const ACCOUNTS = ['cash', 'srs', 'cpf'];
export const todaySG = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Singapore', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
export function dateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw Error('Use a valid YYYY-MM-DD date.');
  return value;
}
const day = d => Date.parse(dateKey(d)+'T00:00:00Z') / 86400000;
export function number(value) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) throw Error('Enter a finite amount.');
  return Number(value);
}
export function accountForLabel(label) {
  const s = String(label).trim().replace(/^Portfolio\s*-\s*/i, '').trim();
  if (/^Investment(?:\s|$)/i.test(s)) return 'cash';
  if (/^\|\s*CPF-IS$/i.test(s)) return 'cpf';
  if (/^\|\s*CPF-SRS$/i.test(s)) return 'srs';
  return null;
}
export function selectedAccounts(scope) {
  if (scope === 'combined') return ACCOUNTS;
  if (scope === 'retirement') return ['srs','cpf'];
  if (!ACCOUNTS.includes(scope)) throw Error('Unknown portfolio.');
  return [scope];
}
export function sourceSignature(data,account) {
  const type={cash:'Cash',srs:'Retirement - SRS',cpf:'Retirement - CPF'}[account];
  const holdings=Object.values(data.holdings||{}).filter(h=>!h.exited&&h.accountType===type).map(h=>[h.ticker,Number(h.shares),h.currency]).sort((a,b)=>a[0].localeCompare(b[0]));
  const c=data.cashPositions||{};
  const cash=account==='cash'?[c.brokers||0,c.growth||0,c.dividend||0]:[account==='srs'?c.srs||0:c.cpf||0];
  return JSON.stringify({holdings,cash});
}
export function snapshotValue(snapshot, scope, basis) {
  if (!['total','invested'].includes(basis)) throw Error('Unknown view.');
  let value = 0;
  for (const account of selectedAccounts(scope)) {
    const row = snapshot.accounts?.[account];
    if (!row || row.verified !== true) return null;
    const invested = number(row.invested);
    const cash = number(row.cash);
    if (invested < 0 || !Number.isFinite(invested+cash)) throw Error('Invalid valuation.');
    value += invested + (basis==='total' ? cash : 0);
  }
  return value;
}
export function flowValue(flow, scope, basis) {
  if (!selectedAccounts(scope).includes(flow.account)) return 0;
  return number(flow[basis] ?? 0);
}
// Flow amounts are signed amounts crossing each boundary, in SGD, at end of day.
// Dividends distributed out of holdings are negative invested flows. They remain
// income, not new contributions. A payment to CPF OA also exits the total boundary.
export function makeFlow({id, date, account, kind, amount, note=''}) {
  dateKey(date);
  if (!ACCOUNTS.includes(account)) throw Error('Choose an account.');
  const a = number(amount);
  if (a <= 0) throw Error('Amount must be greater than zero.');
  const types = {
    contribution:[a,0], withdrawal:[-a,0], buy:[0,a], sale:[0,-a],
    dividend:[0,-a], dividend_to_oa:[-a,-a], sale_to_oa:[-a,-a],
    transfer_in:[a,0], transfer_out:[-a,0],
  };
  if (!types[kind]) throw Error('Unknown cash movement.');
  if (kind.endsWith('_to_oa') && account!=='cpf') throw Error('Transfers to CPF OA must use CPF.');
  const [total,invested] = types[kind];
  return {id,date,account,kind,total,invested,note:String(note).slice(0,500)};
}
export function calculate(history, scope, basis, start, end) {
  dateKey(start); dateKey(end);
  if (start > end) throw Error('Start date must precede end date.');
  const dates = Object.keys(history.snapshots || {}).filter(d=>d>=start && d<=end).sort();
  const rows = dates.map(date=>({date,value:snapshotValue(history.snapshots[date],scope,basis)}));
  const usable = rows.filter(r=>r.value!==null);
  if (!usable.length) return {points:[],message:'No verified valuations in this period.'};
  const first = usable[0], last = usable.at(-1);
  const flows = Object.values(history.flows || {}).filter(f=>!f.voided && f.date>first.date && f.date<=last.date && flowValue(f,scope,basis)!==0);
  const sum = flows.reduce((n,f)=>n+flowValue(f,scope,basis),0);
  const gain = last.value-first.value-sum;
  if (usable.length<2 || first.date===last.date) return {points:usable,start:first.date,end:last.date,opening:first.value,closing:last.value,gain:null,netFlow:0,returnPct:null,message:'Tracking has started. A second valuation is needed to measure performance.'};
  const reconciled=selectedAccounts(scope).every(a=>{
    const c=history.coverage?.[a]?.[basis];
    return c && c.start<=first.date && c.end>=last.date;
  });
  if(!reconciled)return {points:usable.map(p=>({...p,returnPct:null})),start:first.date,end:last.date,opening:first.value,closing:last.value,netFlow:null,gain:null,returnPct:null,message:'Value history is available. Reconcile all cash movements for this period before calculating returns.'};
  const complete = rows.every(r=>r.value!==null);
  const hasFlowValuations = complete && flows.every(f=>usable.some(r=>r.date===f.date));
  let method = hasFlowValuations ? 'Time-weighted return' : 'Modified Dietz estimate';
  let product=1, runningFlow=0;
  const points=[{...first,returnPct:first.value>0?0:null,capital:first.value}];
  for (let i=1;i<usable.length;i++) {
    const prev=usable[i-1], current=usable[i];
    const intervalFlows=flows.filter(f=>f.date>prev.date && f.date<=current.date);
    const net=intervalFlows.reduce((n,f)=>n+flowValue(f,scope,basis),0);
    runningFlow+=net;
    const duration=day(current.date)-day(first.date);
    const weighted=flows.filter(f=>f.date<=current.date).reduce((n,f)=>n+flowValue(f,scope,basis)*(day(current.date)-day(f.date))/duration,0);
    const denominator=first.value+weighted;
    if (hasFlowValuations) product=prev.value>0 && product!==null ? product*(current.value-net)/prev.value : null;
    let ret=hasFlowValuations ? (product===null?null:product-1) : denominator>0?(current.value-first.value-runningFlow)/denominator:null;
    if (ret!==null && (!Number.isFinite(ret) || ret < -1)) ret=null;
    points.push({...current,returnPct:ret===null?null:ret*100,capital:first.value+runningFlow});
  }
  return {points,start:first.date,end:last.date,opening:first.value,closing:last.value,netFlow:sum,gain,returnPct:points.at(-1).returnPct,method,message:hasFlowValuations?'End-of-day cash-flow convention.':'Estimated return: a valuation is missing on a cash-flow date or an account is unverified.'};
}
export function parseDelimited(text) {
  const delimiter=text.split(/\r?\n/,1)[0].includes('\t')?'\t':',';
  let rows=[],row=[],cell='',quoted=false;
  text=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted && text[i+1]==='"'){cell+='"';i++;}else if(quoted || cell==='')quoted=!quoted;else throw Error('Invalid CSV quoting.');}
    else if(c===delimiter&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw Error('Unclosed CSV quote.');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
// Stable IDs make repeat imports idempotent while retaining identical trade fills
// using an occurrence index within each complete export.
export function importTrades(text) {
  const rows=parseDelimited(text), trades=[], excluded=new Set(), counts=new Map();let missingBase=0;
  for(const cells of rows) {
    if(!/^-?\d+$/.test(cells[0]?.trim()||'')) {if(!trades.length && /buy|sell|type|action/i.test(cells[0]||''))continue;throw Error('This is not the StocksCafe transaction export (Export as Above).');}
    if(cells.length<13)throw Error('Expected the 13-column StocksCafe transaction export.');
    const account=accountForLabel(cells[9]);
    if(!account){excluded.add(cells[9]);continue;}
    const action=number(cells[0]);if(![-1,0,1].includes(action))throw Error('Unknown trade action.');
    dateKey(cells[5].trim());
    const baseCurrency=cells[11].trim().toUpperCase();
    if(baseCurrency && baseCurrency!=='SGD')throw Error('Export with SGD base currency before importing.');
    const baseAmount=baseCurrency==='SGD'&&cells[12].trim()!==''?Math.abs(number(cells[12])):null;
    if(baseAmount===null)missingBase++;
    const trade={account,date:cells[5].trim(),action,exchange:cells[1].trim(),symbol:cells[2].trim(),units:number(cells[3]),price:number(cells[4]),currency:cells[6].trim(),beforeFees:number(cells[7]),afterFees:number(cells[8]),label:cells[9].trim(),note:cells[10],baseAmount};
    const key=JSON.stringify(trade),occurrence=counts.get(key)||0;counts.set(key,occurrence+1);
    trades.push({...trade,sourceKey:key+'#'+occurrence});
  }
  return {trades,excluded:[...excluded],missingBase};
}
export async function stableId(text) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
