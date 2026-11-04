import {planAccountImports,ACCOUNT_NAMES} from './account-portfolio.js?v=monthly-20261104';
import {readPortfolioTSV,exportedCash} from './stockscafe-cash.js';

export async function reviewAccountBatch(files,state,downloadBackup) {
  if(!Array.isArray(files)||!files.length||files.length>3)throw Error('Choose up to three account-specific TSV files.');
  // Validate the file format before opening a review; no state is modified.
  const info=files.map(f=>({...f,missingCash:exportedCash(readPortfolioTSV(f.text))===null}));
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='sc-cash-dialog';
    dialog.innerHTML=`<form><h2>Import account portfolios</h2><p>Select the account for each file. Each export must contain the complete current holdings for that account, with SGD reporting currency. Choose your Investment portfolios together for Cash, CPF-SRS for SRS, and CPF-IS for CPF.</p><div data-files></div><p>Only the selected accounts will be replaced. Bank money set aside stays separate. BDiv is derived from StocksCafe’s SGD P&amp;L, cost and value figures; it is not added to cash.</p><div data-summary aria-live="polite"></div><p class="sc-cash-error" role="alert"></p><div data-backup><p>The first import replaces old combined holdings with account-specific positions. Save a current backup before continuing.</p><button type="button" data-download>Download current portfolio backup</button><label><input type="checkbox" name="backup" required> I saved the current backup.</label></div><label><input name="confirmed" type="checkbox" required> I checked the account mapping, complete holdings, actual cash and SGD reporting currency for every file.</label><p>Importing saves current holdings and balances only. Confirm reconciliation afterward to save today’s performance snapshot. Earlier history is not rewritten.</p><div class="sc-cash-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Import batch</button></div></form>`;
    const form=dialog.querySelector('form'),list=dialog.querySelector('[data-files]'),summary=dialog.querySelector('[data-summary]'),error=dialog.querySelector('[role=alert]'),submit=form.querySelector('[type=submit]');
    info.forEach((file,i)=>{
      const field=document.createElement('fieldset');field.dataset.fileIndex=String(i);
      field.innerHTML=`<legend></legend><label>Destination account<select name="account-${i}" required><option value="">Choose account…</option><option value="cash">Investment</option><option value="srs">SRS</option><option value="cpf">CPF investment</option></select></label>${file.missingCash?`<label>No CASH row in this file: actual cash (SGD)<input name="cash-${i}" type="number" step="0.01" required placeholder="Enter actual balance, including 0"></label>`:''}`;
      field.querySelector('legend').textContent=file.name;list.append(field);
    });
    const initial=state.accountImportVersion!==1,backup=dialog.querySelector('[data-backup]');
    backup.hidden=!initial;form.elements.backup.disabled=!initial;
    let downloaded=false,finished=false;
    const finish=value=>{if(finished)return;finished=true;dialog.close();dialog.remove();resolve(value);};
    const selected=()=>info.map((f,i)=>({...f,account:form.elements['account-'+i].value,cashIfMissing:form.elements['cash-'+i]?.value}));
    const fmt=n=>state.privacyMode?'S$•••':new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD'}).format(n);
    const review=()=>{
      error.textContent='';summary.replaceChildren();submit.disabled=true;
      try{
        const plan=planAccountImports(state,selected());
        Array.from(list.children).sort((a,b)=>['cash','srs','cpf'].indexOf(form.elements['account-'+a.dataset.fileIndex].value)-['cash','srs','cpf'].indexOf(form.elements['account-'+b.dataset.fileIndex].value)).forEach(field=>list.append(field));
        const table=document.createElement('table');table.className='sc-import-summary';
        table.innerHTML='<caption>Balances after import</caption><thead><tr><th>Account</th><th>Positions</th><th>Cash</th><th>BDiv</th></tr></thead><tbody></tbody>';
        for(const row of plan.summary){const tr=document.createElement('tr');for(const value of [ACCOUNT_NAMES[row.account],row.positions,fmt(row.cash),fmt(row.dividends)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.querySelector('tbody').append(tr);}
        summary.append(table);
        const details=document.createElement('details');details.innerHTML='<summary>Review holdings by account</summary><table class="sc-import-summary"><thead><tr><th>Account / ticker</th><th>Shares</th><th>Average cost</th><th>BDiv (SGD)</th></tr></thead><tbody></tbody></table>';
        for(const h of plan.patch.holdings.filter(h=>!h.exited&&plan.summary.some(r=>r.account===h.importAccount))){
          const tr=document.createElement('tr');
          for(const value of [ACCOUNT_NAMES[h.importAccount]+' · '+h.ticker,state.privacyMode?'•••':h.shares,state.privacyMode?'•••':h.currency+' '+h.average_cost,fmt(h.bDiv)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
          details.querySelector('tbody').append(tr);
        }
        summary.append(details);
        const changes=document.createElement('p');changes.textContent=`Holdings rows: ${state.holdings.filter(h=>!h.exited).length} → ${plan.patch.holdings.filter(h=>!h.exited).length}. A stock held in multiple accounts appears once per account.`;summary.append(changes);
        submit.disabled=false;
      }catch(e){error.textContent=e.message;}
    };
    form.oninput=e=>{if(!['confirmed','backup'].includes(e.target.name)){form.elements.confirmed.checked=false;review();}};
    dialog.querySelector('[data-download]').onclick=()=>{downloadBackup();downloaded=true;};
    form.onsubmit=e=>{
      e.preventDefault();try{
        if(!form.reportValidity())return;
        if(initial&&!downloaded)throw Error('Download and save the current portfolio backup first.');
        const batch=selected();planAccountImports(state,batch);finish(batch);
      }catch(err){error.textContent=err.message;}
    };
    dialog.querySelector('[data-cancel]').onclick=()=>finish(null);
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
    document.body.append(dialog);review();dialog.showModal();
  });
}

export function createCashSettings(React,jsx) {
  return function CashSettings({cash,info={},onChange,privacyMode}) {
    const [advanced,setAdvanced]=React.useState(false);
    const field=(name,label,readonly=false)=>jsx.jsxs('label',{className:'sc-cash-setting',children:[label,jsx.jsx('input',{type:'number',step:'0.01',value:cash[name],readOnly:readonly,onChange:readonly?undefined:e=>onChange(name,e.target.value),'aria-label':label}),readonly&&jsx.jsx('small',{children:info[name]?.importedAt?'Updated '+new Date(info[name].importedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})+' · '+info[name].source:'Existing balance — import an account TSV to refresh.'})]},name);
    return jsx.jsxs('div',{children:[
      jsx.jsx('p',{children:'Import StocksCafe account TSVs to refresh broker, SRS and CPF cash. These are current balances, separate from cumulative dividends.'}),
      field('brokers','Broker cash (SGD)',true),field('srs','SRS cash (SGD)',true),field('cpfIs','CPF investment cash (SGD; excludes OA)',true),
      field('growth','Bank cash set aside — Growth (SGD)'),field('dividend','Bank cash set aside — Dividend (SGD)'),
      jsx.jsxs('details',{children:[jsx.jsx('summary',{children:'Advanced: manual cash corrections'}),jsx.jsx('p',{children:'Use only to correct a reconciled balance. A correction changes no contribution or transfer history. Your next account import replaces the corrected balance.'}),jsx.jsxs('label',{children:[jsx.jsx('input',{type:'checkbox',checked:advanced,onChange:e=>setAdvanced(e.target.checked)}),' Enable manual corrections']}),advanced&&jsx.jsxs('div',{children:[field('brokers','Correct broker cash (SGD)'),field('srs','Correct SRS cash (SGD)'),field('cpfIs','Correct CPF investment cash (SGD)')]})]})
    ]});
  };
}
