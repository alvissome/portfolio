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
// One private write saves the confirmation, today's value and capture configuration.
// Never turn today's quotes into an invented historical valuation.
export function confirmationSnapshot(history,state,{account,date,cash,unchanged=false,coverage=null}) {
  if(!ACCOUNTS.includes(account))throw Error('Choose an account.');
  if(dateKey(date)!==todaySG())throw Error('Automatic snapshots use today’s prices. Earlier dates require dated source values; do not backdate today’s portfolio.');
  const prior=history.settings?.capture?.[account];
  if(!prior)throw Error('Complete the initial account setup first, confirming the Cash/SRS/CPF split and actual cash.');
  const positions=derivePositions(history.trades||{})[account];
  if(JSON.stringify(positions)!==prior.positionSignature)throw Error('Holdings changed. Review the account setup before restarting daily snapshots.');
  const signature=sourceSignature({holdings:state.holdings,cashPositions:{...state.cash,cpf:state.cash.cpfIs}},account);
  cash=number(cash);
  if(unchanged&&(prior.needsReconciliation||signature!==prior.sourceSignature||cash!==prior.cash||Object.values(history.flows||{}).some(f=>!f.voided&&f.account===account&&f.date>prior.reconciledOn)))throw Error('Recorded holdings, balances or movements changed. Use Confirm reconciliation instead of No changes.');
  let invested=0;
  for(const h of positions){
    const p=state.priceCache?.[h.ticker],fx=h.currency==='SGD'?1:state.fxRates?.[h.currency];
    if(!(p?.close>0)||p.priceStale||!(fx>0))throw Error('Sync prices and FX before confirming; a current snapshot cannot be calculated.');
    invested+=number(h.shares)*p.close*fx;
  }
  const patch={snapshots:{[date]:{accounts:{[account]:{invested,cash,verified:true,source:unchanged?'unchanged confirmation':'reconciliation confirmation'}},recordedAt:new Date().toISOString()}},settings:{dailyEnabled:true,checks:{[account]:{date,sourceSignature:signature}},capture:{[account]:{...prior,cash,holdings:positions,positionSignature:JSON.stringify(positions),sourceSignature:signature,reconciledOn:date,needsReconciliation:false}}}};
  if(coverage){
    const start=dateKey(coverage.start),basis=coverage.basis;
    if(start>date||!['total','invested'].includes(basis))throw Error('Invalid reconciliation period.');
    patch.coverage={[account]:{[basis]:{start,end:date}}};
  }else if(unchanged){
    // An explicit no-activity confirmation can extend existing total coverage.
    // Invested-only dividends/flows still need their own coverage confirmation.
    const previous=history.coverage?.[account]?.total;
    if(previous&&previous.end>=prior.reconciledOn&&previous.start<=prior.reconciledOn)patch.coverage={[account]:{total:{start:previous.start,end:date}}};
  }
  return patch;
}
// Account-specific inventory: the same ticker may exist in multiple accounts.
// This is staged evidence until the owner reconciles it against statements.
export function derivePositions(trades) {
  const grouped=new Map(),result={cash:[],srs:[],cpf:[]};
  for(const t of Object.values(trades||{})){
    if(!ACCOUNTS.includes(t.account))throw Error('Invalid trade account.');
    if(t.action===0)continue;
    const key=[t.account,t.exchange,t.symbol].join('|');
    const p=grouped.get(key)||{account:t.account,exchange:t.exchange,symbol:t.symbol,shares:0,currency:t.currency,currencies:new Set()};
    p.currencies.add(t.currency);
    p.shares+=number(t.action)*number(t.units);grouped.set(key,p);
  }
  const suffix={USX:'',SGX:'.SI',HKEX:'.HK',LSE:'.L'};
  for(const p of grouped.values()){
    if(Math.abs(p.shares)<1e-7)continue;
    if(p.currencies.size>1)throw Error('An active holding has inconsistent currencies; reconcile the source export.');
    if(p.shares<0)throw Error('Trade history leaves a negative position; use a complete reconciled export.');
    if(!Object.hasOwn(suffix,p.exchange))throw Error('An active holding needs an exchange mapping.');
    result[p.account].push({ticker:p.symbol+suffix[p.exchange],shares:Math.round(p.shares*1e8)/1e8,currency:p.currency});
  }
  for(const a of ACCOUNTS)result[a].sort((x,y)=>x.ticker.localeCompare(y.ticker));
  return result;
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
export function makeFlow({id, date, account, kind, amount, note='',dateApproximate=false}) {
  dateKey(date);
  if (!ACCOUNTS.includes(account)) throw Error('Choose an account.');
  const a = number(amount);
  if (a <= 0) throw Error('Amount must be greater than zero.');
  const types = {
    earmark:[a,0], contribution:[a,0], withdrawal:[-a,0], buy:[0,a], sale:[0,-a],
    dividend:[0,-a], dividend_to_oa:[-a,-a], sale_to_oa:[-a,-a],
    cash_to_oa:[-a,0], transfer_in:[a,0], transfer_out:[-a,0],
  };
  if (!types[kind]) throw Error('Unknown cash movement.');
  if(kind==='earmark'&&account!=='cash')throw Error('Bank money set aside for investing belongs to Cash investment.');
  if (kind.endsWith('_to_oa') && account!=='cpf') throw Error('Transfers to CPF OA must use CPF.');
  const [total,invested] = types[kind];
  return {id,date,account,kind,total,invested,dateApproximate:dateApproximate===true||dateApproximate==='on',location:kind==='earmark'?'bank':'account',note:String(note).slice(0,500)};
}
// A transfer between cash locations crosses neither performance boundary.
// Source balances must already have been reconciled; this records the audit trail.
export function makeBankTransfer({id,date,amount,bankBefore,brokerBefore,note=''}) {
  dateKey(date);
  if(date>todaySG())throw Error('Future transfers cannot be recorded.');
  const a=number(amount),bank=number(bankBefore),broker=number(brokerBefore);
  if(a<0.01||bank<0||a>bank||[a,bank,broker].some(n=>Math.abs(n*100-Math.round(n*100))>1e-6))throw Error('Use cents: transfer must be positive and cannot exceed the bank cash set aside.');
  const cents=n=>Math.round(n*100)/100;
  return {id,date,account:'cash',kind:'bank_to_broker',amount:cents(a),total:0,invested:0,location:'bank_to_broker',bankBefore:cents(bank),bankAfter:cents(bank-a),brokerBefore:cents(broker),brokerAfter:cents(broker+a),note:String(note).slice(0,500)};
}
export function confirmCashLocations(transfer,bank,broker) {
  if(Math.abs(number(bank)-transfer.bankAfter)>.005||Math.abs(number(broker)-transfer.brokerAfter)>.005)throw Error('Update the bank cash and import/reconcile the broker cash first. Both balances must match the transfer review.');
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
  const hasFlowValuations = complete && flows.every(f=>!f.dateApproximate&&usable.some(r=>r.date===f.date));
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
  return {points,start:first.date,end:last.date,opening:first.value,closing:last.value,netFlow:sum,gain,returnPct:points.at(-1).returnPct,method,message:hasFlowValuations?'End-of-day cash-flow convention.':'Estimated return: a cash-flow date is approximate, a valuation is missing on a flow date, or an account is unverified.'};
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
    const nativeCurrency=cells[6].trim().toUpperCase();
    const baseAmount=baseCurrency==='SGD'&&cells[12].trim()!==''?Math.abs(number(cells[12])):nativeCurrency==='SGD'?Math.abs(number(cells[8])):null;
    if(baseAmount===null)missingBase++;
    const trade={account,date:cells[5].trim(),action,exchange:cells[1].trim(),symbol:cells[2].trim(),units:number(cells[3]),price:number(cells[4]),currency:cells[6].trim(),beforeFees:number(cells[7]),afterFees:number(cells[8]),label:cells[9].trim(),note:cells[10],baseAmount};
    const {baseAmount:ignoredBase,...identity}=trade;
    const key=JSON.stringify(identity),occurrence=counts.get(key)||0;counts.set(key,occurrence+1);
    trades.push({...trade,sourceKey:key+'#'+occurrence});
  }
  return {trades,excluded:[...excluded],missingBase};
}
export async function stableId(text) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
