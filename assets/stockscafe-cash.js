import {parseDelimited, number} from './performance-core.js';

// The current-portfolio export may aggregate all accounts into one CASH row.
// Never infer its account or treat an imported balance as a new cash movement.
export function readPortfolioTSV(text) {
  const [rawHeader,...data]=parseDelimited(text,'\t');
  const header=rawHeader?.map(key=>key.trim());
  if(!header || !['Symbol','Shares','AveragePrice'].every(k=>header.includes(k)))throw Error('Choose the StocksCafe current-portfolio TSV, not its transaction-history CSV.');
  return data.map(cells=>Object.fromEntries(header.map((key,i)=>[key.trim(),(cells[i]??'').trim()])));
}
export function exportedCash(rows) {
  const cash=rows.filter(r=>r.Symbol==='CASH');
  if(!cash.length)return null;
  if(cash.length!==1)throw Error('This export has multiple CASH rows. Export a combined SGD view with one total, then review its account breakdown.');
  const row=cash[0];
  if(row.Currency!=='SGD')throw Error('Export the portfolio with SGD base currency before importing cash. No currency conversion is guessed.');
  // Preserve an explicit zero rather than falling back to another column.
  const value=row.Shares!==''?row.Shares:row.AveragePrice;
  return number(String(value??'').replace(/,/g,''));
}
export function cashAllocation(total,current,{scope,srs,cpfIs}={}) {
  if(total===null)return {};
  total=number(total);
  if(!['brokers','combined'].includes(scope))throw Error('Choose whether the exported CASH includes retirement cash.');
  if(scope==='brokers')return {brokers:total};
  srs=number(srs);cpfIs=number(cpfIs);
  if(srs<0 || cpfIs<0)throw Error('Retirement cash cannot be negative.');
  const cents=n=>Math.round(n*100);
  if([total,srs,cpfIs].some(n=>Math.abs(n*100-cents(n))>1e-6))throw Error('Enter cash balances to the nearest cent.');
  const brokers=(cents(total)-cents(srs)-cents(cpfIs))/100;
  if(brokers<0)throw Error('SRS and CPF cash exceed the exported total. Check the export selection and account balances.');
  // Replaces all three balances. Bank cash and income history are never added.
  return {brokers,srs,cpfIs};
}

export async function reviewStocksCafeImport(text,current) {
  const rows=readPortfolioTSV(text),total=exportedCash(rows);
  if(total===null)return {};
  const fmt=n=>new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD'}).format(n);
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='sc-cash-dialog';
    dialog.innerHTML=`<form><h2>Review imported cash</h2><p>Exported CASH total: <strong data-total></strong></p><p>The TSV may combine broker, SRS and CPF cash. Choose what this export includes. Use a complete holdings export containing all your Investment, CPF-SRS and CPF-IS portfolios; exclude Trading, Options, Bond and Test. A partial holdings export can mark missing positions as exited. The selection below describes the CASH row only.</p><label>Cash included in this export<select name="scope" required><option value="">Choose cash scope…</option><option value="brokers">Broker cash only — keep retirement cash unchanged</option><option value="combined">Broker + SRS + CPF investment cash</option></select></label><fieldset hidden><legend>Actual retirement cash in StocksCafe (SGD)</legend><label>SRS cash<input name="srs" type="number" min="0" step="0.01" required></label><label>CPF investment-account cash<input name="cpfIs" type="number" min="0" step="0.01" required></label><p>Exclude money returned to CPF OA and cumulative dividends no longer held as cash. Existing balances below are suggestions: compare them with StocksCafe.</p></fieldset><p data-review></p><p class="sc-cash-error" role="alert"></p><p>Import replaces the relevant balances; it never adds to them. Bank money set aside and historical performance records stay unchanged. This import does not confirm reconciliation or record transfer dates.</p><label><input name="confirmed" type="checkbox" required> I checked the cash scope and account balances against StocksCafe.</label><div class="sc-cash-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Import holdings & cash</button></div></form>`;
    document.body.append(dialog);
    const form=dialog.querySelector('form'),scope=form.elements.scope,fields=dialog.querySelector('fieldset'),error=dialog.querySelector('[role=alert]');
    dialog.querySelector('[data-total]').textContent=fmt(total);
    form.elements.srs.value=Number(current.srs??0).toFixed(2);
    form.elements.cpfIs.value=Number(current.cpfIs??0).toFixed(2);
    let completed=false;
    const finish=result=>{if(completed)return;completed=true;dialog.close();dialog.remove();resolve(result);};
    const plan=()=>cashAllocation(total,current,Object.fromEntries(new FormData(form)));
    const review=()=>{
      const combined=scope.value==='combined';fields.hidden=!combined;fields.disabled=!combined;
      form.elements.confirmed.checked=false;error.textContent='';
      const out=dialog.querySelector('[data-review]');out.textContent='';
      if(!scope.value)return;
      try{const p=plan();out.textContent=combined?`After import — Brokers: ${fmt(p.brokers)} · SRS: ${fmt(p.srs)} · CPF investment: ${fmt(p.cpfIs)}`:`Broker cash becomes ${fmt(p.brokers)}. SRS and CPF cash stay unchanged.`;}catch(e){error.textContent=e.message;}
    };
    form.oninput=e=>{if(e.target.name!=='confirmed')review();};
    form.onsubmit=e=>{e.preventDefault();try{const p=plan();if(!form.reportValidity())return;finish(p);}catch(err){error.textContent=err.message;}};
    dialog.querySelector('[data-cancel]').onclick=()=>finish(null);
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
    review();dialog.showModal();
  });
}
