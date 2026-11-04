import {ACCOUNTS,todaySG,dateKey,number,calculate,makeFlow,makeBankTransfer,confirmCashLocations,parseDelimited,importTrades,stableId,sourceSignature,derivePositions,capturePositions,confirmationSnapshot,importValuations} from './performance-core.js?v=history-20261104';

import {cashParts,readCashParts,snapshotProgress} from './performance-view.js';

const names={cash:'Investment',srs:'SRS',cpf:'CPF investment'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n==null?'—':new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD'}).format(n);
const empty=()=>({snapshots:{},flows:{},trades:{},settings:{},coverage:{}});
function amount(state,account,positions=null) {
  let sum=0;
  for(const h of positions||state.holdings.filter(h=>!h.exited && h.accountType===({cash:'Cash',srs:'Retirement - SRS',cpf:'Retirement - CPF'}[account]))){
    const p=state.priceCache[h.ticker];
    if(!p || !(p.close>0) || p.priceStale)throw Error('A holding price is missing or stale. Sync prices before saving a valuation.');
    const fx=h.currency==='SGD'?1:state.fxRates?.[h.currency];
    if(!(fx>0))throw Error('A currency conversion is unavailable.');
    sum+=number(h.shares)*p.close*fx;
  }
  return sum;
}
export function chart(points,metric,privateMode) {
  const data=points.filter(p=>p[metric]!=null);
  if(!data.length)return '<div class="pf-empty">'+(metric==='value'?'Confirm reconciliation to save today’s snapshot from your imported account holdings. Subsequent no-change confirmations also save a snapshot. Automatic daily snapshots then build the trend; no manual backdating is needed.':'Percentage returns need two different snapshot dates and confirmation that money movements between them are complete. Use Monthly update → Confirm reconciliation.')+'</div>';
  const W=900,H=250,L=80,R=20,T=20,B=40;
  const values=data.map(p=>p[metric]);
  if(metric==='value')values.push(...data.map(p=>p.capital).filter(Number.isFinite));
  let lo=Math.min(...values),hi=Math.max(...values);if(hi===lo){hi+=1;lo-=1;}
  const pad=(hi-lo)*.1;lo-=pad;hi+=pad;
  const start=Date.parse(data[0].date),end=Date.parse(data.at(-1).date);
  const x=p=>(end===start?W/2:L+(Date.parse(p.date)-start)/(end-start)*(W-L-R)),y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  const line=(key,color)=>'<polyline fill="none" stroke="'+color+'" stroke-width="3" points="'+data.filter(p=>p[key]!=null).map(p=>x(p).toFixed(1)+','+y(p[key]).toFixed(1)).join(' ')+'"/>';
  let svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+(metric==='value'?'Portfolio value and opening value plus net flows':'Portfolio return percentage')+'">';
  for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,Y=y(v);svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y+'" y2="'+Y+'" stroke="#e5eaf0"/><text x="'+(L-10)+'" y="'+(Y+4)+'" text-anchor="end">'+esc(privateMode&&metric==='value'?'•••':metric==='value'?Math.round(v).toLocaleString('en-SG'):v.toFixed(1)+'%')+'</text>';}
  svg+=line(metric,'#167d9a');if(metric==='value')svg+=line('capital','#ab8b50');
  for(const p of data)svg+='<circle cx="'+x(p)+'" cy="'+y(p[metric])+'" r="3" fill="#167d9a"><title>'+esc(p.date+': '+(privateMode&&metric==='value'?'Hidden':metric==='value'?money(p.value):p.returnPct.toFixed(2)+'%'))+'</title></circle>';
  return svg+'<text x="'+L+'" y="'+(H-8)+'">'+data[0].date+'</text><text x="'+(W-R)+'" y="'+(H-8)+'" text-anchor="end">'+data.at(-1).date+'</text></svg>';
}

export function cashFields(state,account,prefix,readonly) {
  const parts=cashParts(state,account),total=parts.reduce((n,p)=>n+p.value,0);
  return parts.map(p=>`<label>${esc(p.label)}<input data-cash-part name="${esc(prefix+'-'+p.key)}" type="number" step="0.01" value="${p.value.toFixed(2)}" ${readonly?'readonly':''} required></label>`).join('')+`<p>Total cash for this account: <strong data-cash-total="${esc(prefix)}">${money(total)}</strong></p>`;
}

export function createPerformanceComponent(React,jsx) {
  return function PerformancePanel({uid,state,storage}) {
    const root=React.useRef(null),controller=React.useRef(null);
    React.useEffect(()=>{const c=mount(root.current,uid,state,storage);controller.current=c;return()=>{c.destroy();controller.current=null;};},[uid]);
    React.useEffect(()=>controller.current?.update(state),[state]);
    return jsx.jsx('section',{ref:root,className:'pf-panel', 'aria-label':'Portfolio performance'});
  };
}
export function mount(root,uid,initialState,storage) {
  let state=initialState,history=empty(),alive=true,busy=false,loaded=false,error='',scope='cash',basis='total',metric='value',period='1Y',customStart='',customEnd=todaySG();
  let pending=null;
  root.innerHTML='<p>Loading performance history…</p>';
  const merge=(base,patch)=>{for(const [k,v]of Object.entries(patch)){
    if(['__proto__','constructor','prototype'].includes(k))throw Error('Invalid history field.');
    if(v&&typeof v==='object'&&!Array.isArray(v)){if(!Object.hasOwn(base,k)||!base[k]||typeof base[k]!=='object')base[k]={};merge(base[k],v);}else base[k]=v;
  }};
  async function save(patch) {
    if(!loaded)throw Error('History must load successfully before saving.');
    if(busy)throw Error('Wait for the current save to finish.');
    busy=true;
    try {
      const prospective=JSON.parse(JSON.stringify(history));merge(prospective,patch);
      if(new TextEncoder().encode(JSON.stringify(prospective)).length>700000)throw Error('History is approaching its storage limit. Export a backup before extending storage. No data was discarded.');
      await storage.save(patch);if(alive)merge(history,patch);
    }finally{busy=false;}
  }
  function range(){
    const end=period==='custom'?customEnd:todaySG();let start=Object.keys(history.snapshots).sort()[0]||end;
    if(period==='YTD')start=end.slice(0,4)+'-01-01';
    else if(['1M','3M','6M','1Y'].includes(period)){const d=new Date(end+'T00:00:00Z'),months=period==='1Y'?12:parseInt(period);d.setUTCMonth(d.getUTCMonth()-months);start=d.toISOString().slice(0,10);}
    else if(period==='custom')start=customStart||start;
    return [start,end];
  }
  function render(){
    if(!alive)return;
    const [start,end]=range();let result;
    try{result=calculate(history,scope,basis,start,end);}catch(e){result={points:[],message:e.message};}
    const progress=snapshotProgress(history,scope,basis,start,end,state);
    const privacy=state.privacyMode;
    const show=n=>privacy?'S$•••':money(n);
    const options=(values,selected)=>values.map(([v,label])=>'<option value="'+v+'" '+(v===selected?'selected':'')+'>'+label+'</option>').join('');
    root.innerHTML=`<div class="pf-title"><div><h2>Portfolio performance</h2><p>Investment growth, with contributions kept separate.</p></div></div>
      <div class="pf-controls"><label>Portfolio<select data-filter="scope">${options([['cash','Investment'],['retirement','Retirement'],['srs','SRS'],['cpf','CPF investment'],['combined','Combined']],scope)}</select></label>
      <label>Measure<select data-filter="basis">${options([['total','Holdings + available cash'],['invested','Invested holdings only']],basis)}</select></label>
      <label>Chart<select data-filter="metric">${options([['value','Value (SGD)'],['returnPct','Return (%)']],metric)}</select></label>
      <label>Period<select data-filter="period">${options(['1M','3M','6M','YTD','1Y','All','custom'].map(x=>[x,x==='custom'?'Custom':x]),period)}</select></label>
      ${period==='custom'?`<label>From<input data-filter="start" type="date" value="${esc(customStart||start)}"></label><label>To<input data-filter="end" type="date" value="${esc(customEnd)}"></label>`:''}</div>
      ${error?'<p class="pf-error" role="alert">'+esc(error)+'</p>':''}
      <div class="pf-stats"><div><span>Opening value</span><strong>${show(result.opening)}</strong></div><div><span>Net flows</span><strong>${show(result.netFlow)}</strong></div><div><span>Investment gain / loss</span><strong>${show(result.gain)}</strong></div><div><span>${esc(result.method||'Return')}</span><strong>${result.returnPct==null?'—':result.returnPct.toFixed(2)+'%'}</strong></div></div>
      ${chart(result.points||[],metric,privacy)}
      <p class="pf-caption">${progress.dates.length} saved snapshot date${progress.dates.length===1?'':'s'} for this view${progress.dates.length?': '+esc(progress.dates[0])+(progress.dates.length>1?' to '+esc(progress.dates.at(-1)):''):''}. ${progress.dates.length===1?(metric==='value'?'Your saved value is shown as one point. ':'Percentage returns need a later snapshot date. ')+'Confirming twice on the same date updates the same saved value; a later date supplies the trend. ':''}${progress.paused.length?'Capture needs reconciliation for: '+progress.paused.map(a=>esc(names[a])).join(', ')+'.':progress.dailyEnabled&&progress.configured?'Daily capture is enabled and scheduled for 08:30 Singapore time; changes still need reconciliation.':'Confirm reconciliation for each account in this view to configure daily capture.'} ${progress.missing.length?'Latest saved date lacks verified values for: '+progress.missing.map(a=>esc(names[a])).join(', ')+'. Combined views need all selected accounts on the same date.':''}</p>
      ${progress.dates.length<2?'<p class="pf-caption">Current-portfolio TSVs contain today’s holdings and cash, not an earlier valuation series. Historical transaction imports do not create old snapshots. Historical backfill is not yet complete; earlier values require dated source records.</p>':''}
      <p class="pf-caption">${esc(result.message)} ${basis==='total'&&progress.unknownCash.length?'Historical holdings exist with unresolved cash. Select Invested holdings only to view those dates.':''} ${result.start?'Actual coverage: '+result.start+' to '+result.end+'.':''}</p>
      ${metric==='value'?'<p class="pf-caption">Blue: portfolio value · Gold: opening value + net flows during this period (not lifetime contributions).</p>':''}
      <p class="pf-caption">Bank cash set aside: ${show(state.cash.growth)} · Broker cash: ${show(state.cash.brokers)}. These are current balances, not your original funding budget.</p>
      <p class="pf-caption">${ACCOUNTS.map(a=>{const c=history.settings.checks?.[a];if(!c)return esc(names[a])+': not checked';const raw={holdings:state.holdings,cashPositions:{...state.cash,cpf:state.cash.cpfIs}};return esc(names[a])+': checked '+esc(c.date)+(c.sourceSignature!==sourceSignature(raw,a)?' (balances or holdings changed since)':'');}).join(' · ')}</p>
      <div class="pf-actions"><button data-action="monthly">Monthly update</button><button data-action="money">Money set aside & transfers</button></div>
      <p class="pf-caption">Use the top Import menu to upload account-specific StocksCafe TSVs in one batch. Confirm reconciliation or no changes to save today’s snapshot and enable daily snapshots. Holdings values are calculated from quantities and synced prices.</p>
      <details><summary>Advanced: history, backups & settings</summary>
      <h3>Earlier history & account setup</h3><div class="pf-actions"><button data-action="valuation">Advanced account setup / earlier snapshot</button></div><p class="pf-caption">Optional setup tools, not monthly uploads. A StocksCafe transaction CSV provides dated trades and account splits; the normal TSV updates current balances. A valuation CSV supplies earlier statement values with columns date,account,invested_sgd,cash_sgd. Leave cash_sgd blank when historical cash is unknown: these records appear only in the invested-holdings view. Use zero only when actual cash was zero. Values retain their source dates; lines between sparse snapshots are not daily history.</p><div class="pf-actions"><button data-action="import-trades">Import historical StocksCafe transactions</button><button data-action="import-valuations">Import earlier statement values</button></div>
      <h3>Performance-history backup</h3><p class="pf-caption">The top Export Backup / Import Backup controls cover your original portfolio data. These separate controls cover the new snapshots and movement history. Use them for recovery, not routine updates.</p><div class="pf-actions"><button data-action="export">Export performance history</button><button data-action="restore">Restore performance history</button></div>
      <h3>Automatic snapshots</h3><p class="pf-caption">${history.settings.dailyEnabled?'Enabled for accounts confirmed during snapshot setup. Cash stays at its last checked amount; changes need reconciliation. Pause only when you want automatic recording to stop.':'Waiting for verified account setup and confirmation. Confirming today’s reconciliation or no changes enables daily snapshots. Data is private in your personal Firebase account; the daily cloud job does not depend on your laptop.'}</p>${history.settings.dailyEnabled?'<div class="pf-actions"><button data-action="stop-daily">Pause automatic snapshots</button></div>':''}
      <h3>History & corrections</h3><p class="pf-caption">${Object.keys(history.snapshots).length} snapshot dates · ${Object.values(history.flows).filter(f=>!f.voided).length} cash movements · ${Object.keys(history.trades).length} imported transactions. Trade imports are staged for reconciliation; they do not invent historical valuations or cash flows.</p>
      <div class="pf-scroll"><table><thead><tr><th>Date</th><th>Account</th><th>Movement</th><th>Amount</th><th></th></tr></thead><tbody>${Object.values(history.flows).filter(f=>!f.voided).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(f=>`<tr><td>${esc(f.date)}</td><td>${esc(names[f.account])}</td><td>${esc(f.kind==='bank_to_broker'?'Bank → IBKR (internal)':f.kind==='cash_to_oa'?'CPF investment cash → OA':f.kind)}</td><td>${show(f.amount??Math.abs(f.total||f.invested))}</td><td><button data-void="${esc(f.id)}">Void entry</button></td></tr>`).join('')}</tbody></table></div></details>
      <div class="pf-dialog-host"></div>`;
    root.querySelectorAll('[data-filter]').forEach(el=>el.onchange=()=>{const k=el.dataset.filter;if(k==='scope')scope=el.value;else if(k==='basis')basis=el.value;else if(k==='metric')metric=el.value;else if(k==='period')period=el.value;else if(k==='start')customStart=el.value;else customEnd=el.value;error='';render();});
    root.querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>run(()=>action(el.dataset.action)));
    root.querySelectorAll('[data-void]').forEach(el=>el.onclick=()=>run(async()=>{await save({flows:{[el.dataset.void]:{...history.flows[el.dataset.void],voided:true}}});render();}));
  }
  async function run(fn){try{error='';await fn();}catch(e){error=e.message;render();}}
  function actionMenu(title,description,items){
    const host=root.querySelector('.pf-dialog-host');
    host.innerHTML=`<dialog open class="pf-dialog"><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="pf-menu">${items.map(([action,title,description])=>`<button data-menu-action="${action}"><strong>${esc(title)}</strong><span>${esc(description)}</span></button>`).join('')}</div><button data-close-menu>Close</button></dialog>`;
    host.querySelector('[data-close-menu]').onclick=()=>host.replaceChildren();
    host.querySelectorAll('[data-menu-action]').forEach(el=>el.onclick=()=>run(()=>action(el.dataset.menuAction)));
  }
  function dialog(title,body,onSubmit){
    const host=root.querySelector('.pf-dialog-host');host.innerHTML=`<dialog open class="pf-dialog"><form><h3>${esc(title)}</h3>${body}<p class="pf-error" role="alert"></p><div class="pf-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Save</button></div></form></dialog>`;
    const form=host.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>host.replaceChildren();
    form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await onSubmit(new FormData(form));host.replaceChildren();render();}catch(err){form.querySelector('[role=alert]').textContent=err.message;submit.disabled=false;}};
  }
  async function action(which){
    if(which==='monthly'){
      const items=[['coverage','Confirm reconciliation','Confirm actual cash and complete money movements. Saves today’s snapshot and enables daily cloud snapshots.'],['unchanged','No holdings or cash changes','Skip an identical TSV upload. Saves today’s snapshot using updated prices and unchanged cash, and enables daily snapshots.']];
      if(state.accountImportVersion!==1&&!Object.keys(history.settings.capture||{}).length)items.unshift(['valuation','Complete initial account setup','One-time check of account-specific holdings and actual cash before daily recording can start.']);
      actionMenu('Monthly update','Use Confirm reconciliation after importing account TSVs, including the first time. It saves today’s snapshot and enables daily recording. No changes is for a previously confirmed account.',items);return;
    }
    if(which==='money'){
      actionMenu('Money set aside & transfers','Choose what happened. These actions record history; actual bank and broker balances are updated separately.',[
        ['earmark','Set aside additional money','New money allocated to investing in your bank; a contribution to the full Cash investment portfolio.'],
        ['bank-transfer','Move earmarked money to IBKR','Record a bank → broker transfer of money already set aside. It is not a second contribution.'],
        ['cpf-to-oa','CPF investment cash → OA','Record the dated return of cash already held in CPF-IS. Import the reduced cash from StocksCafe; this records the transfer for performance only.'],
        ['flow','Other money movements','Record withdrawals, direct contributions, CPF transfers to OA or other movements needed for return calculations. Do not duplicate dividends handled by StocksCafe.']
      ]);return;
    }
    if(which==='stop-daily'){await save({settings:{dailyEnabled:false}});render();return;}
    if(which==='unchanged'){
      dialog('Monthly check: unchanged',`<label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><input name="date" type="hidden" value="${todaySG()}"><p>Snapshot date: ${todaySG()} (today)</p><label><input type="checkbox" required> I checked the source account: holdings and actual cash are unchanged. There are no unrecorded deposits, withdrawals, dividends, interest, fees, FX conversions or corporate actions.</label><p>This saves today’s calculated holdings value and unchanged cash, then enables daily cloud snapshots. Existing confirmed total-return coverage is extended across a period with no activity. It does not invent earlier values. Use Confirm reconciliation for the first check or whenever holdings/cash changed.</p>`,async fd=>{
        const date=dateKey(fd.get('date')),a=fd.get('account');if(date>todaySG()||!ACCOUNTS.includes(a))throw Error('Invalid account or check date.');
        await save(confirmationSnapshot(history,state,{account:a,date,cash:history.settings.capture?.[a]?.cash,unchanged:true}));
      });return;
    }
    if(which==='bank-transfer'){
      dialog('Record bank → IBKR transfer',`<p>First reduce bank cash set aside in the dashboard settings and import the updated StocksCafe TSV (or reconcile broker cash). Then record this transfer. Nothing is added to contributions or deducted from investment performance.</p><label>Transfer date<input name="date" type="date" value="${todaySG()}" required></label><label>Amount transferred (SGD)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Bank cash before transfer (SGD)<input name="bankBefore" type="number" min="0" step="0.01" required></label><label>Broker cash before transfer (SGD)<input name="brokerBefore" type="number" step="0.01" required></label><label>Note<input name="note" maxlength="500"></label><p>Use matching SGD cash movements before any later currency conversion or trading. Record fees separately as expenses. If other activity has already changed the balances, reconcile the dated statements first. In StocksCafe this is a broker deposit; do not record it again as new money in this dashboard.</p><label><input type="checkbox" required> The updated bank and broker balances include this transfer exactly once.</label><p>This saves a transfer record only. It does not change balances or send money.</p>`,async fd=>{
        const flow=makeBankTransfer({id:crypto.randomUUID(),...Object.fromEntries(fd)});
        confirmCashLocations(flow,state.cash.growth,state.cash.brokers);
        if(Object.values(history.flows).some(f=>!f.voided&&f.kind===flow.kind&&f.date===flow.date&&f.amount===flow.amount&&f.bankBefore===flow.bankBefore&&f.brokerBefore===flow.brokerBefore))throw Error('This transfer is already recorded.');
        const patch={flows:{[flow.id]:flow}};const c=history.settings.capture?.cash;if(c)patch.settings={capture:{cash:{...c,needsReconciliation:true}}};await save(patch);
      });return;
    }
    if(which==='cpf-to-oa'){
      dialog('CPF investment cash → OA',`<p>In StocksCafe, record a WITHDRAWAL from CPF-IS on the bank’s actual transfer date, with note “Returned to CPF OA”. Keep the original dividend or sale record. Import its updated cash balance into this dashboard.</p><label>Transfer date<input name="date" type="date" value="${todaySG()}" required></label><label>Amount returned to OA (SGD)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Note<input name="note" maxlength="500" placeholder="Returned to CPF OA — statement reference"></label><label><input type="checkbox" required> This amount left CPF investment-account cash and has not already been recorded as another dashboard withdrawal or transfer to OA.</label><p>This records a withdrawal from the tracked portfolio, not an expense or investment loss. It does not reduce the cash balance again. OA and its interest stay outside this tracker. For holdings-only returns, retain the earlier dated dividend or sale entry; moving that cash later creates no second holdings-only payout.</p>`,async fd=>{
        const flow=makeFlow({id:crypto.randomUUID(),...Object.fromEntries(fd),account:'cpf',kind:'cash_to_oa'});
        if(flow.date>todaySG())throw Error('Future movements cannot be recorded.');
        if(Object.values(history.flows).some(f=>!f.voided&&f.account==='cpf'&&f.date===flow.date&&f.total===flow.total))throw Error('A CPF outflow for the same date and amount is already recorded. Review it before adding another.');
        const patch={flows:{[flow.id]:flow}};const c=history.settings.capture?.cpf;if(c)patch.settings={capture:{cpf:{...c,needsReconciliation:true}}};await save(patch);
      });return;
    }
    if(which==='coverage'){

      dialog('Confirm reconciliation',`<p>Confirm actual cash and complete money movements. For today, this also saves a snapshot and enables daily cloud snapshots. Earlier period confirmations never backdate today’s prices.</p><label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><label>View<select name="basis"><option value="total">Holdings + available cash</option><option value="invested">Invested holdings only</option></select></label><label>From<input name="start" type="date" value="${Object.keys(history.snapshots).sort()[0]||todaySG()}" required></label><label>Through<input name="end" type="date" value="${todaySG()}" required></label><div data-cash-review>${cashFields(state,'cash','reconcile',true)}</div><p>Balances come from the dashboard. Correct broker cash through its TSV import or Advanced cash settings; update money set aside in Settings. This confirmation uses their sum.</p><label><input type="checkbox" required> Actual cash and account split are correct; all relevant money movements for this view and period are recorded.</label><p>For holdings + cash: check contributions, withdrawals and CPF transfers to OA. Retained dividends are already reflected in cash, not contributions. Invested-only returns also need dated purchases, sales and dividends from StocksCafe records. Historical period confirmation changes return coverage only; it needs existing dated values. Cash includes earmarked bank cash for Cash investment, actual SRS cash for SRS, and only actual investment-account cash for CPF.</p>`,async fd=>{
        const start=dateKey(fd.get('start')),end=dateKey(fd.get('end')),a=fd.get('account'),b=fd.get('basis');
        if(start>end||end>todaySG()||!ACCOUNTS.includes(a)||!['total','invested'].includes(b))throw Error('Invalid reconciliation period.');
        if(end===todaySG())await save(confirmationSnapshot(history,state,{account:a,date:end,cash:readCashParts(fd,a,'reconcile'),coverage:{start,basis:b}}));
        else {
          if(!history.snapshots[end]?.accounts?.[a]?.verified)throw Error('An earlier period needs a verified snapshot from that date’s source data. Today’s prices cannot supply it.');
          await save({coverage:{[a]:{[b]:{start,end}}}});
        }
      });
      const form=root.querySelector('.pf-dialog form');const showCash=()=>{const host=form.querySelector('[data-cash-review]');host.innerHTML=cashFields(state,form.elements.account.value,'reconcile',true);host.hidden=form.elements.end.value!==todaySG();};form.elements.account.onchange=showCash;form.elements.end.onchange=showCash;
      return;
    }
    if(which==='export'){
      const url=URL.createObjectURL(new Blob([JSON.stringify({schema:1,exportedAt:new Date().toISOString(),history},null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='portfolio-performance-'+todaySG()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    if(which==='valuation'){
      let positions=null;try{if(state.accountImportVersion===1||Object.keys(history.trades).length)positions=capturePositions(history,state);}catch{}
      const rows=ACCOUNTS.map(account=>{let value='';try{value=amount(state,account,positions?.[account]).toFixed(2);}catch{}return `<fieldset><legend>${names[account]}</legend>${positions?'<details><summary>Holdings included</summary><p>'+esc(positions[account].map(p=>p.ticker+' × '+p.shares).join(', ')||'none')+'</p></details>':'<p>Initial setup needed: check the Cash/SRS/CPF split. Import Cash, SRS and CPF account TSVs together to establish the split. A complete reconciled transaction export is an alternative for legacy records.</p>'}<details><summary>Holdings value: ${value===''?'unavailable — sync prices':money(Number(value))} (calculated)</summary><p>Calculated from holdings quantities, prices and FX. No manual price calculation is needed. Change only to enter a value from an earlier dated statement or correct the initial account split.</p><label>Holdings value (SGD)<input name="${account}-invested" type="number" step="0.01" min="0" value="${value}"></label></details>${cashFields(state,account,account,true)}<label><input name="${account}-verified" type="checkbox"> The account split and actual cash are correct; cash excludes historical dividends already paid out.</label></fieldset>`;}).join('');
      dialog('Advanced account setup & earlier snapshot',`<label>Snapshot date<input name="date" type="date" value="${todaySG()}" required></label><p>Normal monthly updates only need Confirm reconciliation, including the first confirmation after account TSV import. This advanced form is for legacy setup or recording a statement-backed earlier snapshot. Holdings values are calculated automatically where prices are available; review actual cash and the Cash/SRS/CPF split. Cash defaults to the current dashboard balances, including your StocksCafe cash import. Check actual investment-account cash and exclude money returned to OA. For earlier dates, use statement values from that date, not today’s prices.</p>${rows}<details><summary>Automatic daily snapshots (enabled after setup)</summary><label><input name="daily" type="checkbox" checked> Record daily closing-price snapshots in the cloud after this account setup. Reconfirm actual cash after changes.</label><p>Uses calculated holdings values and the last confirmed cash balance. A later automatic snapshot can provide the chart’s second date. It does not sync new trades or cash activity from your broker.</p></details>`,async fd=>{
        const date=dateKey(fd.get('date'));if(date>todaySG())throw Error('Future valuations cannot be recorded.');
        const accounts={};let count=0;
        for(const a of ACCOUNTS)if(fd.has(a+'-verified')){const invested=number(fd.get(a+'-invested')),cash=readCashParts(fd,a,a);if(invested<0)throw Error('Holdings value cannot be negative.');accounts[a]={invested,cash,cashVerified:true,verified:true,source:'manual reconciliation'};count++;}
        if(!count)throw Error('Verify at least one account.');
        const patch={snapshots:{[date]:{accounts,recordedAt:new Date().toISOString()}}};
        const rawCheck={holdings:state.holdings,cashPositions:{...state.cash,cpf:state.cash.cpfIs}};
        patch.settings={checks:{}};for(const a of Object.keys(accounts))patch.settings.checks[a]={date,sourceSignature:sourceSignature(rawCheck,a),recordedAt:new Date().toISOString()};
        if(fd.has('daily')){
          if(date!==todaySG())throw Error('Daily capture must start with today’s reconciliation.');
          if(!positions)throw Error('Import and reconcile the account-specific TSVs or a complete trade history to establish holdings before daily capture.');
          const raw={holdings:state.holdings,cashPositions:{brokers:state.cash.brokers,growth:state.cash.growth,dividend:state.cash.dividend,srs:state.cash.srs,cpf:state.cash.cpfIs}};
          const capture={...history.settings.capture};for(const a of ACCOUNTS)if(fd.has(a+'-verified'))capture[a]={cash:accounts[a].cash,holdings:positions[a],positionSignature:JSON.stringify(positions[a]),sourceSignature:sourceSignature(raw,a),reconciledOn:date,needsReconciliation:false};
          patch.settings={...patch.settings,dailyEnabled:true,capture};
        }
        await save(patch);
      });
      const setupForm=root.querySelector('.pf-dialog form');setupForm.elements.date.onchange=()=>{const historical=setupForm.elements.date.value!==todaySG();setupForm.elements.daily.checked=!historical;setupForm.querySelectorAll('[data-cash-part]').forEach(input=>{input.readOnly=!historical;});};setupForm.oninput=()=>{for(const account of ACCOUNTS){const total=setupForm.querySelector('[data-cash-total="'+account+'"]');try{total.textContent=money(readCashParts(new FormData(setupForm),account,account));}catch{total.textContent='Enter both balances';}}};
      return;
    }
    if(which==='earmark'){
      dialog('Set aside money for investing',`<p>Record additional money newly earmarked in your bank. It enters the Cash investment portfolio on this date and remains excluded from the invested-holdings-only return until invested.</p><label>Date set aside<input name="date" type="date" value="${todaySG()}" required></label><label>Additional amount (SGD)<input name="amount" type="number" min="0.01" step="0.01" required></label><label><input name="dateApproximate" type="checkbox"> The date is approximate (historical entry).</label><label>Note<input name="note" maxlength="500" placeholder="For example, money reserved in a savings account"></label><p>This records contribution history only. If this amount is already included in your bank cash balance, do not add it to the balance again. Otherwise update the actual bank cash balance and record a verified valuation. Moving this same money to your broker later is an internal transfer, not another contribution. An opening valuation already includes money earmarked before tracking began.</p>`,async fd=>{const flow=makeFlow({id:crypto.randomUUID(),...Object.fromEntries(fd),account:'cash',kind:'earmark'});if(flow.date>todaySG())throw Error('Future movements cannot be recorded.');const patch={flows:{[flow.id]:flow}};const c=history.settings.capture?.cash;if(c)patch.settings={capture:{cash:{...c,needsReconciliation:true}}};await save(patch);});return;
    }
    if(which==='flow'){
      dialog('Record a dated cash movement',`<label>Date<input name="date" type="date" value="${todaySG()}" required></label><label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><label>Movement<select name="kind"><option value="contribution">New money added</option><option value="withdrawal">Money withdrawn</option><option value="buy">Investment purchase (including fees)</option><option value="sale">Investment sale (net proceeds retained)</option><option value="dividend">Dividend paid into account cash</option><option value="cash_to_oa">CPF investment cash transferred to OA (income/sale recorded earlier)</option><option value="dividend_to_oa">CPF dividend paid directly to OA (not recorded earlier)</option><option value="sale_to_oa">CPF sale paid directly to OA (not recorded earlier)</option><option value="transfer_in">Transfer from another tracked account</option><option value="transfer_out">Transfer to another tracked account</option></select></label><label>Amount in SGD<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Note<input name="note" maxlength="500"></label><p>Moving bank cash to your broker is internal to Cash investment: do not record it as a new contribution. Between tracked accounts, record matching transfer-out and transfer-in entries. Dividends are income, not contributions. Movement entries adjust performance only; reconcile the actual cash balance separately.</p>`,async fd=>{const flow=makeFlow({id:crypto.randomUUID(),...Object.fromEntries(fd)});if(flow.date>todaySG())throw Error('Future movements cannot be recorded.');const patch={flows:{[flow.id]:flow}};const c=history.settings.capture?.[flow.account];if(c)patch.settings={capture:{[flow.account]:{...c,needsReconciliation:true}}};await save(patch);});return;
    }
    const input=document.createElement('input');input.type='file';input.accept=which==='restore'?'.json':'.csv,.tsv,.txt';
    input.onchange=()=>run(async()=>{
      const file=input.files[0];if(!file)return;if(file.size>4*1024*1024)throw Error('Use an export smaller than 4 MB.');const text=await file.text();let patch,summary;
      if(which==='import-trades'){
        const parsed=importTrades(text),trades={};for(const t of parsed.trades){const id=await stableId(t.sourceKey);trades[id]=t;}
        patch={trades};summary=`Stage ${Object.keys(trades).length} investment and retirement trades for reconciliation. ${parsed.missingBase} trades need historical SGD conversion. Excluded portfolios: ${parsed.excluded.join(', ')||'none'}. Valuations and cash flows remain unchanged.`;
      }else if(which==='import-valuations'){
        const parsed=importValuations(text,history.snapshots);
        patch={snapshots:parsed.snapshots};summary=`Import ${parsed.count} account valuations across ${Object.keys(parsed.snapshots).length} dates. ${parsed.holdingsOnly} records have unknown cash and appear only in Holdings value. Cash-inclusive values and percentage returns remain unavailable until their source balances and movements are reconciled. Existing matching dates and accounts will be replaced.`;
      }else{
        const backup=JSON.parse(text);if(backup.schema!==1||!backup.history)throw Error('Use a performance history backup.');
        patch=validateBackup(backup.history);summary='Merge this performance history backup. Matching records will be replaced. Existing portfolio holdings and settings stay unchanged.';
      }
      pending=patch;dialog('Review import',`<p>${esc(summary)}</p><label><input name="verified" type="checkbox" required> I checked the source and confirm these records.</label>`,async()=>{await save(pending);pending=null;});
    });input.click();
  }
  function validateBackup(h){
    const patch={snapshots:{},flows:{},trades:{},coverage:{},settings:{dailyEnabled:false}};
    for(const [date,s]of Object.entries(h.snapshots||{})){dateKey(date);if(date>todaySG())throw Error('Future valuation in backup.');const accounts={};for(const a of ACCOUNTS)if(s.accounts?.[a]){const r=s.accounts[a],invested=number(r.invested),cash=r.cashVerified===false?null:number(r.cash);if(invested<0)throw Error('Invalid valuation.');accounts[a]={invested,cash,cashVerified:r.cashVerified!==false,verified:r.verified===true,source:'history backup'};}patch.snapshots[date]={accounts};}
    for(const [id,f]of Object.entries(h.flows||{})){if(!/^[a-f0-9-]{16,100}$/.test(id)||!ACCOUNTS.includes(f.account))throw Error('Invalid flow.');dateKey(f.date);if(f.date>todaySG())throw Error('Future movement in backup.');patch.flows[id]=f.kind==='bank_to_broker'?{...makeBankTransfer({...f,id}),voided:!!f.voided}:{id,date:f.date,account:f.account,kind:String(f.kind),total:number(f.total),invested:number(f.invested),dateApproximate:f.dateApproximate===true,location:f.location==='bank'?'bank':'account',voided:!!f.voided,note:String(f.note||'').slice(0,500)};}
    for(const a of ACCOUNTS){const c=h.settings?.checks?.[a];if(c){dateKey(c.date);if(c.date>todaySG()||typeof c.sourceSignature!=='string')throw Error('Invalid check date.');patch.settings.checks||={};patch.settings.checks[a]={date:c.date,sourceSignature:c.sourceSignature};}}
    // Trades remain source evidence; never execute or infer cash transactions.
    for(const [id,t]of Object.entries(h.trades||{})){if(!/^[a-f0-9]{64}$/.test(id)||!ACCOUNTS.includes(t.account))throw Error('Invalid trade evidence.');dateKey(t.date);patch.trades[id]=t;}
    for(const a of ACCOUNTS)for(const b of ['total','invested'])if(h.coverage?.[a]?.[b]){const c=h.coverage[a][b];dateKey(c.start);dateKey(c.end);if(c.start>c.end||c.end>todaySG())throw Error('Invalid reconciliation coverage.');patch.coverage[a]||={};patch.coverage[a][b]={start:c.start,end:c.end};}
    return patch;
  }
  storage.load().then(h=>{if(alive){history={...empty(),...h};loaded=true;render();}}).catch(e=>{if(alive){error='Could not load history: '+e.message;render();}});
  return {update(s){const changedPrivacy=s.privacyMode!==state.privacyMode;state=s;if(alive&&loaded&&(!root.querySelector('dialog')||changedPrivacy))render();},destroy(){alive=false;root.replaceChildren();}};
}
