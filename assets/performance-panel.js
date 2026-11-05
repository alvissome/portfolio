import {readCashLedger,ledgerReviewWindow,reconcileLedgerEntries,ledgerPatch} from './stockscafe-ledger.js?v=ledger-checkpoint-20261105';
import {ACCOUNTS,todaySG,dateKey,number,calculate,makeFlow,makeBankTransfer,confirmCashLocations,sourceSignature,capturePositions,confirmationSnapshot} from './performance-core.js?v=ytd-20261105';

import {cashParts,readCashParts,snapshotProgress,performanceRange,confirmedPerformanceRange} from './performance-view.js?v=period-coverage-20261105';

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
  const line=(key,color,width=3)=>'<polyline fill="none" stroke="'+color+'" stroke-width="'+width+'" points="'+data.filter(p=>p[key]!=null).map(p=>x(p).toFixed(1)+','+y(p[key]).toFixed(1)).join(' ')+'"/>';
  let svg='<figure class="pf-chart"><figcaption data-chart-readout aria-live="polite">Hover, tap or focus a point to see its date and value.</figcaption><svg viewBox="0 0 '+W+' '+H+'" role="group" aria-label="'+(metric==='value'?'Portfolio value and opening value plus net flows':'Portfolio time-weighted return percentage')+'">';
  for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,Y=y(v);svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y+'" y2="'+Y+'" stroke="#e5eaf0"/><text x="'+(L-10)+'" y="'+(Y+4)+'" text-anchor="end">'+esc(privateMode&&metric==='value'?'•••':metric==='value'?Math.round(v).toLocaleString('en-SG'):v.toFixed(1)+'%')+'</text>';}
  svg+=line(metric,'#167d9a');if(metric==='value')svg+=line('capital','#ab8b50',1.35);
  for(const p of data){
    const label=p.date+' · '+(metric==='value'?'Portfolio value: '+(privateMode?'Hidden':money(p.value)) : (metric==='twrPct'?'TWR: '+p.twrPct.toFixed(2)+'%':'Return: '+p.returnPct.toFixed(2)+'%'))+(metric==='value'&&Number.isFinite(p.capital)?' · Opening value + net flows: '+(privateMode?'Hidden':money(p.capital)):'');
    svg+='<circle data-chart-point data-label="'+esc(label)+'" cx="'+x(p)+'" cy="'+y(p[metric])+'" r="12" fill="transparent" tabindex="0" role="button" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title></circle><circle cx="'+x(p)+'" cy="'+y(p[metric])+'" r="3" fill="#167d9a" pointer-events="none"/>';
  }
  return svg+'<text x="'+L+'" y="'+(H-8)+'">'+data[0].date+'</text><text x="'+(W-R)+'" y="'+(H-8)+'" text-anchor="end">'+data.at(-1).date+'</text></svg></figure>';
}

export function bindChart(root){
  const figure=root.querySelector('.pf-chart');if(!figure)return;
  const svg=figure.querySelector('svg'),readout=figure.querySelector('[data-chart-readout]'),points=[...figure.querySelectorAll('[data-chart-point]')];
  const show=p=>{points.forEach(n=>n.classList.toggle('pf-point-active',n===p));readout.textContent=p.dataset.label;};
  const nearest=e=>{const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)*900/rect.width;return points.reduce((best,p)=>Math.abs(Number(p.getAttribute('cx'))-x)<Math.abs(Number(best.getAttribute('cx'))-x)?p:best,points[0]);};
  svg.onpointermove=e=>{if(e.pointerType!=='touch')show(nearest(e));};
  svg.onclick=e=>{const p=e.target?.closest?.('[data-chart-point]');show(points.includes(p)?p:nearest(e));};
  points.forEach((p,i)=>{p.onfocus=()=>show(p);p.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,i+(e.key==='ArrowLeft'?-1:1)));points[next].focus();}else if(['Enter',' '].includes(e.key)){e.preventDefault();show(p);}};});
}

export function cashFields(state,account,prefix,readonly,brokerOnly=false) {
  const all=cashParts(state,account),parts=brokerOnly&&account==='cash'?all.slice(0,1):all,total=parts.reduce((n,p)=>n+p.value,0);
  const allocation=brokerOnly&&account==='cash'?`<input type="hidden" name="${esc(prefix+'-bank')}" value="${all[1].value.toFixed(2)}">`:'';
  return parts.map(p=>`<label>${esc(p.label)}<input data-cash-part name="${esc(prefix+'-'+p.key)}" type="number" step="0.01" value="${p.value.toFixed(2)}" ${readonly?'readonly':''} required></label>`).join('')+allocation+`<p>${brokerOnly&&account==='cash'?'Broker cash':'Total cash for this account'}: <strong data-cash-total="${esc(prefix)}">${money(total)}</strong></p>`;
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
  let state=initialState,history=empty(),alive=true,busy=false,loaded=false,error='',notice='',scope='cash',basis='broker',metric='value',period='reconciled',customStart='',customEnd=todaySG();
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
  function range(){return performanceRange(history,{scope,basis,period,customStart,customEnd,today:todaySG()});}
  function render(){
    if(!alive)return;
    const [start,end]=range();let result,partial=false;
    const progress=snapshotProgress(history,scope,basis,start,end,state);
    const preset=['1M','3M','6M','YTD','1Y'].includes(period);
    try{
      result=calculate(history,scope,basis,start,end,{allowUnconfirmedTail:period==='YTD'&&progress.paused.length===0});
      if(preset&&result.points.length>1&&result.netFlow==null){
        const confirmed=confirmedPerformanceRange(history,scope,basis);
        if(confirmed){
          const from=confirmed[0]>start?confirmed[0]:start,through=confirmed[1]<end?confirmed[1]:end;
          if(from<through){
            const covered=calculate(history,scope,basis,from,through);
            if(covered.points.length>1&&covered.netFlow!=null){result=covered;partial=true;}
          }
        }
      }
    }catch(e){result={points:[],message:e.message};}
    const returnMessage=basis==='invested'&&result.points.length>1&&result.netFlow==null
      ? 'Holdings values are available. Reconcile dated purchases, sales and dividends for this period to calculate investment gain and return.'
      : result.message;
    const openSections=new Set([...root.querySelectorAll('details[data-performance-section][open]')].map(el=>el.dataset.performanceSection));
    const section=(id,title)=>`<details data-performance-section="${id}"${openSections.has(id)?' open':''}><summary>${title}</summary>`;
    const privacy=state.privacyMode;
    const show=n=>privacy?'S$•••':money(n);
    const options=(values,selected)=>values.map(([v,label])=>'<option value="'+v+'" '+(v===selected?'selected':'')+'>'+label+'</option>').join('');
    root.innerHTML=`<div class="pf-title"><div><h2>Portfolio performance</h2><p>Investment performance after accounting for contributions and withdrawals.</p></div></div>
      <div class="pf-controls"><label>Portfolio<select data-filter="scope">${options([['cash','Investment'],['retirement','Retirement'],['srs','SRS'],['cpf','CPF investment'],['combined','Combined']],scope)}</select></label>
      <label>Measure<select data-filter="basis">${options([['broker','Holdings + broker cash'],['invested','Invested holdings only']],basis)}</select></label>
      <label>Chart<select data-filter="metric">${options([['value','Value (SGD)'],['twrPct','TWR (%)']],metric)}</select></label>
      <label>Period<select data-filter="period">${options(['reconciled','1M','3M','6M','YTD','1Y','All','custom'].map(x=>[x,x==='custom'?'Custom':x==='reconciled'?'Confirmed period':x]),period)}</select></label>
      ${period==='custom'?`<form data-custom-dates><label>From<input name="start" type="date" min="1900-01-01" max="${todaySG()}" value="${esc(customStart||start)}" required></label><label>To<input name="end" type="date" min="1900-01-01" max="${todaySG()}" value="${esc(customEnd)}" required></label><button type="submit">Apply dates</button></form>`:''}</div>
      ${error?'<p class="pf-error" role="alert">'+esc(error)+'</p>':''}
      ${notice?'<p class="pf-caption" role="status">'+esc(notice)+'</p>':''}
      <div class="pf-stats pf-stats-primary"><div><span>Money-weighted return (XIRR, annualized)</span><strong>${result.xirrPct==null?'—':result.xirrPct.toFixed(2)+'%'}</strong></div><div><span>${esc(result.twrMethod||'Time-weighted return (TWR)')}</span><strong>${result.twrPct==null?'—':result.twrPct.toFixed(2)+'%'}</strong></div><div><span>Investment gain / loss (SGD)</span><strong>${show(result.gain)}</strong></div></div><div class="pf-stats pf-stats-secondary"><div><span>Opening value</span><strong>${show(result.opening)}</strong></div><div><span>Net external flows</span><strong>${show(result.netFlow)}</strong></div></div>
      ${chart(result.points||[],metric,privacy)}
      ${result.provisionalThrough?`<p class="pf-caption" role="status">Provisional YTD. Assumes zero unrecorded cash movements after ${esc(result.provisionalThrough)}.</p>`:''}
      ${preset&&result.start&&result.points.length>1?`<p class="pf-caption">${partial||(period==='YTD'&&result.start>start)?'Partial '+esc(period)+'. ':''}Valuations used: ${esc(result.start)} to ${esc(result.end)}.</p>`:''}
      ${result.returnPct==null&&returnMessage?`<p class="pf-caption" role="status">${esc(returnMessage)}</p>`:''}
      <div class="pf-actions"><button data-action="monthly">Monthly update</button><button data-action="money">Money movements</button></div>
      ${section('status','Performance details')}
      <p class="pf-caption">${progress.dates.length} saved snapshot date${progress.dates.length===1?'':'s'} for this view${progress.dates.length?': '+esc(progress.dates[0])+(progress.dates.length>1?' to '+esc(progress.dates.at(-1)):''):''}. ${progress.dates.length===1?(metric==='value'?'Your saved value is shown as one point. ':'Percentage returns need a later snapshot date. ')+'Confirming twice on the same date updates the same saved value; a later date supplies the trend. ':''}${progress.paused.length?'Capture needs reconciliation for: '+progress.paused.map(a=>esc(names[a])).join(', ')+'.':progress.dailyEnabled&&progress.configured?'Daily capture is scheduled for 08:30 Singapore time.':'Confirm reconciliation for each account in this view to configure daily capture.'} ${progress.missing.length?'Latest saved date lacks verified values for: '+progress.missing.map(a=>esc(names[a])).join(', ')+'. Combined views need all selected accounts on the same date.':''}</p>
      <p class="pf-caption">${result.returnPct!=null?esc(result.message)+' ':''}${result.start?'Valuations used: '+esc(result.start)+' to '+esc(result.end)+'.':''}</p>
      ${metric==='value'?'<p class="pf-caption">Blue shows portfolio value. Gold shows opening value plus net flows during this period.</p>':''}
      <p class="pf-caption">XIRR is annualized for the selected dates; TWR is cumulative. When cash flows fall between saved valuations, TWR is an estimate. Short periods can produce unusually large annualized XIRR figures. Performance includes broker or investment-account cash; bank money set aside is allocation-only. YTD starts a fresh comparison each January (including January 2027) without deleting earlier history.</p>
      <p class="pf-caption">${ACCOUNTS.map(a=>{const c=history.settings.checks?.[a];if(!c)return esc(names[a])+': not checked';const raw={holdings:state.holdings,cashPositions:{...state.cash,cpf:state.cash.cpfIs}};return esc(names[a])+': checked '+esc(c.date)+(c.sourceSignature!==sourceSignature(raw,a)?' (balances or holdings changed since)':'');}).join(' · ')}</p>
      </details>
      ${section('advanced','Recovery & corrections')}
      <p class="pf-caption">Use the top bar to back up or restore the dashboard, including performance history.</p>
      ${section('movements','Recorded dashboard cash movements')}
      <p class="pf-caption">Review deposits, withdrawals and transfers already used in dashboard returns. Void an incorrect dashboard entry here. Import corrected external cash movements from StocksCafe under Monthly update.</p>
      <div class="pf-scroll"><table><thead><tr><th>Date</th><th>Account</th><th>Movement</th><th>Amount</th><th></th></tr></thead><tbody>${Object.values(history.flows).filter(f=>!f.voided).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(f=>`<tr><td>${esc(f.date)}</td><td>${esc(names[f.account])}</td><td>${esc(f.kind==='bank_to_broker'?'Bank → IBKR funding':f.kind==='cash_to_oa'?'CPF investment cash → OA':f.kind)}</td><td>${show(f.amount??Math.abs(f.total||f.invested))}</td><td><button data-void="${esc(f.id)}">Void entry</button></td></tr>`).join('')}</tbody></table></div>
      </details>
      ${history.settings.dailyEnabled?`<div class="pf-actions"><button data-action="stop-daily">Pause automatic snapshots</button></div>`:''}
      </details>
      <div class="pf-dialog-host"></div>`;
    root.querySelectorAll('[data-filter]').forEach(el=>el.onchange=()=>{const k=el.dataset.filter;if(k==='scope')scope=el.value;else if(k==='basis')basis=el.value;else if(k==='metric')metric=el.value;else if(k==='period')period=el.value;error='';render();});
    const dates=root.querySelector('[data-custom-dates]');if(dates)dates.onsubmit=e=>{e.preventDefault();if(!dates.reportValidity())return;const from=dates.elements.start.value,to=dates.elements.end.value;if(from>to){dates.elements.end.setCustomValidity('The end date must be on or after the start date.');dates.elements.end.reportValidity();return;}customStart=from;customEnd=to;error='';render();};
    if(dates)dates.oninput=()=>dates.elements.end.setCustomValidity('');
    bindChart(root);
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
  function dialog(title,body,onSubmit,buttonLabel='Save'){
    const host=root.querySelector('.pf-dialog-host');host.innerHTML=`<dialog open class="pf-dialog"><form><h3>${esc(title)}</h3>${body}<p class="pf-error" role="alert"></p><div class="pf-actions"><button type="button" data-cancel>Cancel</button><button type="submit">${esc(buttonLabel)}</button></div></form></dialog>`;
    const form=host.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>host.replaceChildren();
    form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await onSubmit(new FormData(form));if(host.contains(form)){host.replaceChildren();render();}}catch(err){form.querySelector('[role=alert]').textContent=err.message;submit.disabled=false;}};
  }
  function reviewCashLedger(entries,excluded,outsideWindow){
    const {candidates,existing}=reconcileLedgerEntries(entries,history.flows);
    const rows=candidates.map(entry=>`<tr><td><label><input type="checkbox" name="include" value="${entry.id}" aria-label="Include ${esc(entry.date+' '+entry.portfolio+' '+entry.kind+(state.privacyMode?'':' '+entry.currency+' '+entry.amount))}"></label></td><td>${esc(entry.date)}</td><td>${esc(names[entry.account])}<br><small>${esc(entry.portfolio)}</small></td><td>${entry.kind==='contribution'?'Deposit':'Withdrawal'}</td><td>${state.privacyMode?'•••':esc(entry.currency+' '+entry.amount.toLocaleString('en-SG'))}</td><td>${state.privacyMode?'Hidden':esc(entry.note)}</td><td>${entry.currency==='SGD'?'Already SGD':`<input type="number" min="0.01" step="0.01" name="sgd-${entry.id}" aria-label="Statement SGD amount for ${esc(entry.date+' '+entry.portfolio+' '+entry.kind)}" placeholder="Statement SGD">`}</td></tr>`).join('');
    const table=candidates.length?`<div class="pf-scroll"><table><thead><tr><th>Include</th><th>Date</th><th>Account</th><th>Type</th><th>Amount</th><th>StocksCafe details</th><th>SGD for returns</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p>There are no new candidates in this date range.</p>';
    dialog('Review StocksCafe cash movements',`<p>${existing} already recorded or previously voided. ${excluded} outside the supported accounts or movement types. ${outsideWindow} outside the date range.</p><p>Select only actual funding and withdrawals for the tracked accounts. Leave balance corrections, FX swaps, interest, fees and transfers within one tracked account unchecked. For transfers between tracked accounts, include both legs. For foreign-currency rows, enter the SGD equivalent from your records. Finishing saves the latest transaction date reviewed for each account, including rows you leave unchecked.</p>${state.privacyMode?'<p>Turn off privacy mode to review amounts and StocksCafe details.</p>':''}${table}`,async fd=>{
      const selected=new Set(fd.getAll('include'));
      if(!entries.length)return;
      const reviewed=entries.map(entry=>selected.has(entry.id)&&entry.currency!=='SGD'?
        {...entry,sgd:number(fd.get('sgd-'+entry.id))}:entry);
      const latest=await storage.load();
      const {patch,added,reviewed:checkpointSaved}=ledgerPatch(reviewed,selected,latest);
      if(added||checkpointSaved)await save(patch);
      notice=added?`Imported ${added} cash movement${added===1?'':'s'}. Confirm reconciliation after updating the account TSVs.`:'Review complete. No cash movements added.';
    },entries.length?'Finish review':'Done');
  }
  async function action(which){
    if(which==='monthly'){
      const items=[['cash-ledger','Import StocksCafe cash ledger','Review deposits and withdrawals when money moved into or out of a tracked account.'],['coverage','Confirm reconciliation','Confirm actual cash and complete money movements. Saves today’s snapshot and enables daily cloud snapshots.'],['unchanged','No holdings or cash changes','Skip an identical TSV upload. Saves today’s snapshot using updated prices and unchanged cash, and enables daily snapshots.']];
      if(state.accountImportVersion!==1&&!Object.keys(history.settings.capture||{}).length)items.unshift(['valuation','Complete initial account setup','One-time check of account-specific holdings and actual cash before daily recording can start.']);
      actionMenu('Monthly update','Import current account TSVs and review any external cash movements before confirming reconciliation. No changes is for a previously confirmed account.',items);return;
    }
    if(which==='cash-ledger'){
      dialog('Import StocksCafe cash ledger',`<label>StocksCafe cash transaction export<input type="file" name="ledger" accept=".csv,.tsv,.txt" required></label><label>From date (optional)<input type="date" name="from" max="${todaySG()}"></label><p>Upload the full export. The dashboard picks up new rows since each account’s last ledger review. For the first import, it starts after confirmed cash coverage, or at the beginning of this year if none exists. Use From date for older or backdated entries. Import your usual account TSVs separately to refresh holdings and balances.</p>`,async fd=>{
        const file=fd.get('ledger'),from=fd.get('from');
        if(!file?.size||file.size>4*1024*1024)throw Error('Choose a cash transaction export smaller than 4 MB.');
        const {entries,excluded}=await readCashLedger(await file.text());
        const recent=ledgerReviewWindow(entries,history,from);
        reviewCashLedger(recent,excluded,entries.length-recent.length);
      },'Review movements');return;
    }
    if(which==='money'){
      actionMenu('Money movements','Record actual money entering or leaving investment accounts. Update money set aside for allocation planning in Settings.',[
        ['bank-transfer','Move earmarked money to IBKR','Money entering IBKR is broker funding. Record it once after updating the actual balances.'],
        ['cpf-to-oa','CPF investment cash → OA','Record the dated return of cash already held in CPF-IS. Import the reduced cash from StocksCafe; this records the transfer for performance only.'],
        ['flow','Other money movements','Record withdrawals, direct contributions, CPF transfers to OA or other movements needed for return calculations. Do not duplicate dividends handled by StocksCafe.']
      ]);return;
    }
    if(which==='stop-daily'){await save({settings:{dailyEnabled:false}});render();return;}
    if(which==='unchanged'){
      dialog('Monthly check: unchanged',`<label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><input name="date" type="hidden" value="${todaySG()}"><p>Snapshot date: ${todaySG()} (today)</p><label><input type="checkbox" required> I checked the source account: holdings and actual cash are unchanged. There are no unrecorded deposits, withdrawals, dividends, interest, fees, FX conversions or corporate actions.</label><p>This saves today’s calculated holdings value and unchanged cash, then enables daily cloud snapshots. Existing confirmed broker-return coverage is extended across a period with no activity. It does not invent earlier values. Use Confirm reconciliation for the first check or whenever holdings/cash changed.</p>`,async fd=>{
        const date=dateKey(fd.get('date')),a=fd.get('account');if(date>todaySG()||!ACCOUNTS.includes(a))throw Error('Invalid account or check date.');
        await save(confirmationSnapshot(history,state,{account:a,date,cash:cashParts(state,a).reduce((sum,p)=>sum+p.value,0),unchanged:true}));
      });return;
    }
    if(which==='bank-transfer'){
      dialog('Record bank → IBKR transfer',`<p>First reduce bank cash set aside in the dashboard settings and import the updated StocksCafe TSV (or reconcile broker cash). Then record this transfer. This is funding into the broker portfolio, so it creates no investment gain. Bank money remains allocation information.</p><label>Transfer date<input name="date" type="date" value="${todaySG()}" required></label><label>Amount transferred (SGD)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Bank cash before transfer (SGD)<input name="bankBefore" type="number" min="0" step="0.01" required></label><label>Broker cash before transfer (SGD)<input name="brokerBefore" type="number" step="0.01" required></label><label>Note<input name="note" maxlength="500"></label><p>Use matching SGD cash movements before any later currency conversion or trading. Record fees separately as expenses. If other activity has already changed the balances, reconcile the dated statements first. In StocksCafe this is a broker deposit. This transfer entry accounts for it once in the broker view; do not add a second contribution.</p><label><input type="checkbox" required> The updated bank and broker balances include this transfer exactly once.</label><p>This saves a transfer record only. It does not change balances or send money.</p>`,async fd=>{
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

      dialog('Confirm reconciliation',`<p>Confirm actual cash and complete money movements. For today, this also saves a snapshot and enables daily cloud snapshots. Earlier period confirmations never backdate today’s prices.</p><label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><label>View<select name="basis"><option value="broker">Holdings + broker cash</option><option value="invested">Invested holdings only</option></select></label><label>From<input name="start" type="date" value="${Object.keys(history.snapshots).sort()[0]||todaySG()}" required></label><label>Through<input name="end" type="date" value="${todaySG()}" required></label><div data-cash-review>${cashFields(state,'cash','reconcile',true,true)}</div><p>Balances come from the dashboard. Correct broker cash through its TSV import or Advanced cash settings; update money set aside in Settings. Returns use broker cash only. Bank money set aside remains in allocation planning and does not affect performance.</p><label><input type="checkbox" required> Actual cash and account split are correct; all relevant money movements for this view and period are recorded.</label><p>For holdings + cash: check contributions, withdrawals and CPF transfers to OA. Retained dividends are already reflected in cash, not contributions. Invested-only returns also need dated purchases, sales and dividends from StocksCafe records. Historical period confirmation changes return coverage only; it needs existing dated values. Performance cash means actual broker cash for Investment, actual SRS cash for SRS, and actual investment-account cash for CPF.</p>`,async fd=>{
        const start=dateKey(fd.get('start')),end=dateKey(fd.get('end')),a=fd.get('account'),b=fd.get('basis');
        if(start>end||end>todaySG()||!ACCOUNTS.includes(a)||!['broker','invested'].includes(b))throw Error('Invalid reconciliation period.');
        if(end===todaySG())await save(confirmationSnapshot(history,state,{account:a,date:end,cash:readCashParts(fd,a,'reconcile'),coverage:{start,basis:b}}));
        else {
          if(!history.snapshots[end]?.accounts?.[a]?.verified)throw Error('An earlier period needs a verified snapshot from that date’s source data. Today’s prices cannot supply it.');
          await save({coverage:{[a]:{[b]:{start,end}}}});
        }
      });
      const form=root.querySelector('.pf-dialog form');const showCash=()=>{const host=form.querySelector('[data-cash-review]');host.innerHTML=cashFields(state,form.elements.account.value,'reconcile',true,true);host.hidden=form.elements.end.value!==todaySG();};form.elements.account.onchange=showCash;form.elements.end.onchange=showCash;
      return;
    }
    if(which==='valuation'){
      let positions=null;try{if(state.accountImportVersion===1||Object.keys(history.trades).length)positions=capturePositions(history,state);}catch{}
      const rows=ACCOUNTS.map(account=>{let value='';try{value=amount(state,account,positions?.[account]).toFixed(2);}catch{}return `<fieldset><legend>${names[account]}</legend>${positions?'<details><summary>Holdings included</summary><p>'+esc(positions[account].map(p=>p.ticker+' × '+p.shares).join(', ')||'none')+'</p></details>':'<p>Initial setup needed: check the Cash/SRS/CPF split. Import Cash, SRS and CPF account TSVs together to establish the split.</p>'}<details><summary>Holdings value: ${value===''?'unavailable — sync prices':money(Number(value))} (calculated)</summary><p>Calculated from holdings quantities, prices and FX. No manual price calculation is needed. Review the value when confirming the initial account split.</p><label>Holdings value (SGD)<input name="${account}-invested" type="number" step="0.01" min="0" value="${value}"></label></details>${cashFields(state,account,account,true)}<label><input name="${account}-verified" type="checkbox"> The account split and actual cash are correct; cash excludes historical dividends already paid out.</label></fieldset>`;}).join('');
      dialog('Initial account setup',`<p>Snapshot date: ${todaySG()} (today)</p><p>Normal monthly updates only need Confirm reconciliation, including the first confirmation after account TSV import. Use this form for one-time setup of older dashboard accounts. Holdings values are calculated automatically where prices are available; review actual cash and the Cash/SRS/CPF split. Cash defaults to the current dashboard balances, including your StocksCafe cash import. Check actual investment-account cash and exclude money returned to OA.</p>${rows}<details><summary>Automatic daily snapshots (enabled after setup)</summary><label><input name="daily" type="checkbox" checked> Record daily closing-price snapshots in the cloud after this account setup. Reconfirm actual cash after changes.</label><p>Uses calculated holdings values and the last confirmed cash balance. A later automatic snapshot can provide the chart’s second date. It does not sync new trades or cash activity from your broker.</p></details>`,async fd=>{
        const date=todaySG();
        const accounts={};let count=0;
        for(const a of ACCOUNTS)if(fd.has(a+'-verified')){const invested=number(fd.get(a+'-invested')),cash=readCashParts(fd,a,a);if(invested<0)throw Error('Holdings value cannot be negative.');accounts[a]={invested,cash,cashVerified:true,verified:true,...(a==='cash'?{brokerCash:number(fd.get(a+'-broker')),bankCash:number(fd.get(a+'-bank'))}:{}),source:'manual reconciliation'};count++;}
        if(!count)throw Error('Verify at least one account.');
        const patch={snapshots:{[date]:{accounts,recordedAt:new Date().toISOString()}}};
        const rawCheck={holdings:state.holdings,cashPositions:{...state.cash,cpf:state.cash.cpfIs}};
        patch.settings={checks:{}};for(const a of Object.keys(accounts))patch.settings.checks[a]={date,sourceSignature:sourceSignature(rawCheck,a),recordedAt:new Date().toISOString()};
        if(fd.has('daily')){
          if(!positions)throw Error('Import and reconcile the account-specific TSVs to establish holdings before daily capture.');
          const raw={holdings:state.holdings,cashPositions:{brokers:state.cash.brokers,growth:state.cash.growth,dividend:state.cash.dividend,srs:state.cash.srs,cpf:state.cash.cpfIs}};
          const capture={...history.settings.capture};for(const a of ACCOUNTS)if(fd.has(a+'-verified'))capture[a]={cash:accounts[a].cash,...(a==='cash'?{brokerCash:accounts[a].brokerCash,bankCash:accounts[a].bankCash}:{}),holdings:positions[a],positionSignature:JSON.stringify(positions[a]),sourceSignature:sourceSignature(raw,a),reconciledOn:date,needsReconciliation:false};
          patch.settings={...patch.settings,dailyEnabled:true,capture};
        }
        await save(patch);
      });
      return;
    }
    if(which==='earmark'){
      dialog('Set aside money for investing',`<p>Record additional money newly earmarked in your bank. It enters the Cash investment portfolio on this date and remains excluded from the invested-holdings-only return until invested.</p><label>Date set aside<input name="date" type="date" value="${todaySG()}" required></label><label>Additional amount (SGD)<input name="amount" type="number" min="0.01" step="0.01" required></label><label><input name="dateApproximate" type="checkbox"> The date is approximate (historical entry).</label><label>Note<input name="note" maxlength="500" placeholder="For example, money reserved in a savings account"></label><p>This records contribution history only. If this amount is already included in your bank cash balance, do not add it to the balance again. Otherwise update the actual bank cash balance and record a verified valuation. Moving this same money to your broker later is an internal transfer, not another contribution. An opening valuation already includes money earmarked before tracking began.</p>`,async fd=>{const flow=makeFlow({id:crypto.randomUUID(),...Object.fromEntries(fd),account:'cash',kind:'earmark'});if(flow.date>todaySG())throw Error('Future movements cannot be recorded.');const patch={flows:{[flow.id]:flow}};const c=history.settings.capture?.cash;if(c)patch.settings={capture:{cash:{...c,needsReconciliation:true}}};await save(patch);});return;
    }
    if(which==='flow'){
      dialog('Record a dated cash movement',`<label>Date<input name="date" type="date" value="${todaySG()}" required></label><label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><label>Movement<select name="kind"><option value="contribution">New money added</option><option value="withdrawal">Money withdrawn</option><option value="buy">Investment purchase (including fees)</option><option value="sale">Investment sale (net proceeds retained)</option><option value="dividend">Dividend paid into account cash</option><option value="cash_to_oa">CPF investment cash transferred to OA (income/sale recorded earlier)</option><option value="dividend_to_oa">CPF dividend paid directly to OA (not recorded earlier)</option><option value="sale_to_oa">CPF sale paid directly to OA (not recorded earlier)</option><option value="transfer_in">Transfer from another tracked account</option><option value="transfer_out">Transfer to another tracked account</option></select></label><label>Amount in SGD<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Note<input name="note" maxlength="500"></label><p>Money entering your broker is funding for performance. Use the bank → IBKR action or a direct contribution once; do not record the same transfer twice. Between tracked accounts, record matching transfer-out and transfer-in entries. Dividends are income, not contributions. Movement entries adjust performance only; reconcile the actual cash balance separately.</p>`,async fd=>{const flow=makeFlow({id:crypto.randomUUID(),...Object.fromEntries(fd)});if(flow.date>todaySG())throw Error('Future movements cannot be recorded.');const patch={flows:{[flow.id]:flow}};const c=history.settings.capture?.[flow.account];if(c)patch.settings={capture:{[flow.account]:{...c,needsReconciliation:true}}};await save(patch);});return;
    }
  }
  storage.load().then(h=>{if(alive){history={...empty(),...h};loaded=true;render();}}).catch(e=>{if(alive){error='Could not load history: '+e.message;render();}});
  return {update(s){const changedPrivacy=s.privacyMode!==state.privacyMode;state=s;if(alive&&loaded&&(changedPrivacy||(!root.querySelector('dialog')&&!root.querySelector('[data-custom-dates]')?.contains(document.activeElement))))render();},destroy(){alive=false;root.replaceChildren();}};
}
