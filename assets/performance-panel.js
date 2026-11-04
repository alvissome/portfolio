import {ACCOUNTS,todaySG,dateKey,number,calculate,makeFlow,parseDelimited,importTrades,stableId,sourceSignature,derivePositions} from './performance-core.js';

const names={cash:'Cash investment',srs:'SRS',cpf:'CPF investment'};
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
function chart(points,metric,privateMode) {
  const data=points.filter(p=>p[metric]!=null);
  if(data.length<2)return '<div class="pf-empty">Your chart will appear after two verified valuations.</div>';
  const W=900,H=250,L=80,R=20,T=20,B=40;
  const values=data.map(p=>p[metric]);
  if(metric==='value')values.push(...data.map(p=>p.capital).filter(Number.isFinite));
  let lo=Math.min(...values),hi=Math.max(...values);if(hi===lo){hi+=1;lo-=1;}
  const pad=(hi-lo)*.1;lo-=pad;hi+=pad;
  const start=Date.parse(data[0].date),end=Date.parse(data.at(-1).date);
  const x=p=>L+(Date.parse(p.date)-start)/(end-start)*(W-L-R),y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  const line=(key,color)=>'<polyline fill="none" stroke="'+color+'" stroke-width="3" points="'+data.filter(p=>p[key]!=null).map(p=>x(p).toFixed(1)+','+y(p[key]).toFixed(1)).join(' ')+'"/>';
  let svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+(metric==='value'?'Portfolio value and opening value plus net flows':'Portfolio return percentage')+'">';
  for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,Y=y(v);svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y+'" y2="'+Y+'" stroke="#e5eaf0"/><text x="'+(L-10)+'" y="'+(Y+4)+'" text-anchor="end">'+esc(privateMode&&metric==='value'?'•••':metric==='value'?Math.round(v).toLocaleString('en-SG'):v.toFixed(1)+'%')+'</text>';}
  svg+=line(metric,'#167d9a');if(metric==='value')svg+=line('capital','#ab8b50');
  for(const p of data)svg+='<circle cx="'+x(p)+'" cy="'+y(p[metric])+'" r="3" fill="#167d9a"><title>'+esc(p.date+': '+(privateMode&&metric==='value'?'Hidden':metric==='value'?money(p.value):p.returnPct.toFixed(2)+'%'))+'</title></circle>';
  return svg+'<text x="'+L+'" y="'+(H-8)+'">'+data[0].date+'</text><text x="'+(W-R)+'" y="'+(H-8)+'" text-anchor="end">'+data.at(-1).date+'</text></svg>';
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
    const privacy=state.privacyMode;
    const show=n=>privacy?'S$•••':money(n);
    const options=(values,selected)=>values.map(([v,label])=>'<option value="'+v+'" '+(v===selected?'selected':'')+'>'+label+'</option>').join('');
    root.innerHTML=`<div class="pf-title"><div><h2>Portfolio performance</h2><p>Investment growth, with contributions kept separate.</p></div><button data-action="export">Export history</button></div>
      <div class="pf-controls"><label>Portfolio<select data-filter="scope">${options([['cash','Cash investment'],['retirement','Retirement'],['srs','SRS'],['cpf','CPF investment'],['combined','Combined']],scope)}</select></label>
      <label>Measure<select data-filter="basis">${options([['total','Holdings + available cash'],['invested','Invested holdings only']],basis)}</select></label>
      <label>Chart<select data-filter="metric">${options([['value','Value (SGD)'],['returnPct','Return (%)']],metric)}</select></label>
      <label>Period<select data-filter="period">${options(['1M','3M','6M','YTD','1Y','All','custom'].map(x=>[x,x==='custom'?'Custom':x]),period)}</select></label>
      ${period==='custom'?`<label>From<input data-filter="start" type="date" value="${esc(customStart||start)}"></label><label>To<input data-filter="end" type="date" value="${esc(customEnd)}"></label>`:''}</div>
      ${error?'<p class="pf-error" role="alert">'+esc(error)+'</p>':''}
      <div class="pf-stats"><div><span>Opening value</span><strong>${show(result.opening)}</strong></div><div><span>Net flows</span><strong>${show(result.netFlow)}</strong></div><div><span>Investment gain / loss</span><strong>${show(result.gain)}</strong></div><div><span>${esc(result.method||'Return')}</span><strong>${result.returnPct==null?'—':result.returnPct.toFixed(2)+'%'}</strong></div></div>
      ${chart(result.points||[],metric,privacy)}
      <p class="pf-caption">${esc(result.message)} ${result.start?'Actual coverage: '+result.start+' to '+result.end+'.':''}</p>
      ${metric==='value'?'<p class="pf-caption">Blue: portfolio value · Gold: opening value + net flows during this period (not lifetime contributions).</p>':''}
      <div class="pf-actions"><button data-action="valuation">Record valuation</button><button data-action="flow">Record cash movement</button><button data-action="coverage">Confirm reconciliation period</button><button data-action="import-valuations">Import valuation CSV</button><button data-action="import-trades">Import StocksCafe trades</button><button data-action="restore">Import history backup</button><button data-action="stop-daily">Pause daily capture</button></div>
      <p class="pf-caption">Dividends returned to CPF OA count as income and a transfer out. Historical dividend totals are never treated as available cash. The invested-only view requires dated buys, sales and paid dividends as well as valuations.</p>
      <details><summary>History and corrections</summary><p class="pf-caption">${Object.keys(history.snapshots).length} valuation dates · ${Object.values(history.flows).filter(f=>!f.voided).length} cash movements · ${Object.keys(history.trades).length} imported trades. Trade imports are staged for reconciliation; they do not invent historical valuations or cash flows.</p>
      <div class="pf-scroll"><table><thead><tr><th>Date</th><th>Account</th><th>Movement</th><th>Amount</th><th></th></tr></thead><tbody>${Object.values(history.flows).filter(f=>!f.voided).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(f=>`<tr><td>${esc(f.date)}</td><td>${esc(names[f.account])}</td><td>${esc(f.kind)}</td><td>${show(Math.abs(f.total||f.invested))}</td><td><button data-void="${esc(f.id)}">Void entry</button></td></tr>`).join('')}</tbody></table></div></details>
      <div class="pf-dialog-host"></div>`;
    root.querySelectorAll('[data-filter]').forEach(el=>el.onchange=()=>{const k=el.dataset.filter;if(k==='scope')scope=el.value;else if(k==='basis')basis=el.value;else if(k==='metric')metric=el.value;else if(k==='period')period=el.value;else if(k==='start')customStart=el.value;else customEnd=el.value;error='';render();});
    root.querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>run(()=>action(el.dataset.action)));
    root.querySelectorAll('[data-void]').forEach(el=>el.onclick=()=>run(async()=>{await save({flows:{[el.dataset.void]:{...history.flows[el.dataset.void],voided:true}}});render();}));
  }
  async function run(fn){try{error='';await fn();}catch(e){error=e.message;render();}}
  function dialog(title,body,onSubmit){
    const host=root.querySelector('.pf-dialog-host');host.innerHTML=`<dialog open class="pf-dialog"><form><h3>${esc(title)}</h3>${body}<p class="pf-error" role="alert"></p><div class="pf-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Save</button></div></form></dialog>`;
    const form=host.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>host.replaceChildren();
    form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await onSubmit(new FormData(form));host.replaceChildren();render();}catch(err){form.querySelector('[role=alert]').textContent=err.message;submit.disabled=false;}};
  }
  async function action(which){
    if(which==='stop-daily'){await save({settings:{dailyEnabled:false}});render();return;}
    if(which==='coverage'){
      dialog('Confirm the reconciled period',`<label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><label>View<select name="basis"><option value="total">Holdings + available cash</option><option value="invested">Invested holdings only</option></select></label><label>From<input name="start" type="date" required></label><label>Through<input name="end" type="date" value="${todaySG()}" required></label><label><input type="checkbox" required> Every movement across this view’s boundary is recorded, and valuations are complete and reconciled.</label><p>For holdings + cash: reconcile contributions, withdrawals and transfers to CPF OA. For invested holdings: also record purchases, sales and paid dividends. An unchanged portfolio with no movements can also be confirmed.</p>`,async fd=>{const start=dateKey(fd.get('start')),end=dateKey(fd.get('end')),a=fd.get('account'),b=fd.get('basis');if(start>end||end>todaySG())throw Error('Invalid reconciliation period.');await save({coverage:{[a]:{...history.coverage[a],[b]:{start,end}}}});});return;
    }
    if(which==='export'){
      const url=URL.createObjectURL(new Blob([JSON.stringify({schema:1,exportedAt:new Date().toISOString(),history},null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='portfolio-performance-'+todaySG()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    if(which==='valuation'){
      let positions=null;try{if(Object.keys(history.trades).length)positions=derivePositions(history.trades);}catch{}
      const rows=ACCOUNTS.map(account=>{let value='';try{value=amount(state,account,positions?.[account]).toFixed(2);}catch{}const cash=account==='cash'?state.cash.brokers+state.cash.growth+state.cash.dividend:account==='srs'?state.cash.srs:0;return `<fieldset><legend>${names[account]}</legend>${positions?'<p>Trade-derived holdings to check: '+esc(positions[account].map(p=>p.ticker+' × '+p.shares).join(', ')||'none')+'</p>':'<p>Account split is not yet verified. Import a complete trade export before enabling daily capture.</p>'}<label>Holdings value (SGD)<input name="${account}-invested" type="number" step="0.01" min="0" value="${value}"></label><label>Actual cash (SGD)<input name="${account}-cash" type="number" step="0.01" value="${cash.toFixed(2)}"></label><label><input name="${account}-verified" type="checkbox"> I reconciled the account-specific holdings and cash against statements; cash excludes historical dividends already paid out.</label></fieldset>`;}).join('');
      dialog('Record a verified valuation',`<label>Valuation date<input name="date" type="date" value="${todaySG()}" required></label><p>Values are prefilled from the dashboard where available. For earlier dates, replace them with values from that date’s statements. CPF cash defaults to zero: enter actual investment-account cash, excluding dividends already returned to OA.</p>${rows}<label><input name="daily" type="checkbox"> Capture daily valuations in the cloud for these accounts using these confirmed cash balances. Reconfirm after holdings or cash change.</label>`,async fd=>{
        const date=dateKey(fd.get('date'));if(date>todaySG())throw Error('Future valuations cannot be recorded.');
        const accounts={};let count=0;
        for(const a of ACCOUNTS)if(fd.has(a+'-verified')){const invested=number(fd.get(a+'-invested')),cash=number(fd.get(a+'-cash'));if(invested<0)throw Error('Holdings value cannot be negative.');accounts[a]={invested,cash,verified:true,source:'manual reconciliation'};count++;}
        if(!count)throw Error('Verify at least one account.');
        const patch={snapshots:{[date]:{accounts,recordedAt:new Date().toISOString()}}};
        if(fd.has('daily')){
          if(date!==todaySG())throw Error('Daily capture must start with today’s reconciliation.');
          if(!positions)throw Error('Import and reconcile a complete trade export to establish account-specific holdings before daily capture.');
          const raw={holdings:state.holdings,cashPositions:{brokers:state.cash.brokers,growth:state.cash.growth,dividend:state.cash.dividend,srs:state.cash.srs,cpf:state.cash.cpfIs}};
          const capture={...history.settings.capture};for(const a of ACCOUNTS)if(fd.has(a+'-verified'))capture[a]={cash:accounts[a].cash,holdings:positions[a],positionSignature:JSON.stringify(positions[a]),sourceSignature:sourceSignature(raw,a),reconciledOn:date};
          patch.settings={dailyEnabled:true,capture};
        }
        await save(patch);
      });return;
    }
    if(which==='flow'){
      dialog('Record a dated cash movement',`<label>Date<input name="date" type="date" value="${todaySG()}" required></label><label>Account<select name="account">${ACCOUNTS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><label>Movement<select name="kind"><option value="contribution">New money added</option><option value="withdrawal">Money withdrawn</option><option value="buy">Investment purchase (including fees)</option><option value="sale">Investment sale (net proceeds retained)</option><option value="dividend">Dividend paid into account cash</option><option value="dividend_to_oa">CPF dividend transferred to OA</option><option value="sale_to_oa">CPF sale proceeds transferred to OA</option><option value="transfer_in">Transfer from another tracked account</option><option value="transfer_out">Transfer to another tracked account</option></select></label><label>Amount in SGD<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Note<input name="note" maxlength="500"></label><p>Moving bank cash to your broker is internal to Cash investment: do not record it as a new contribution. Between tracked accounts, record matching transfer-out and transfer-in entries. Dividends are income, not contributions. Movement entries adjust performance only; reconcile the actual cash balance separately.</p>`,async fd=>{const flow=makeFlow({id:crypto.randomUUID(),...Object.fromEntries(fd)});if(flow.date>todaySG())throw Error('Future movements cannot be recorded.');await save({flows:{[flow.id]:flow}});});return;
    }
    const input=document.createElement('input');input.type='file';input.accept=which==='restore'?'.json':'.csv,.tsv,.txt';
    input.onchange=()=>run(async()=>{
      const file=input.files[0];if(!file)return;if(file.size>4*1024*1024)throw Error('Use an export smaller than 4 MB.');const text=await file.text();let patch,summary;
      if(which==='import-trades'){
        const parsed=importTrades(text),trades={};for(const t of parsed.trades){const id=await stableId(t.sourceKey);trades[id]=t;}
        patch={trades};summary=`Stage ${Object.keys(trades).length} investment and retirement trades for reconciliation. ${parsed.missingBase} trades need historical SGD conversion. Excluded portfolios: ${parsed.excluded.join(', ')||'none'}. Valuations and cash flows remain unchanged.`;
      }else if(which==='import-valuations'){
        const rows=parseDelimited(text),header=rows.shift()?.map(x=>x.trim().toLowerCase());
        if(header?.join(',')!=='date,account,invested_sgd,cash_sgd')throw Error('CSV columns must be: date,account,invested_sgd,cash_sgd. Accounts: cash,srs,cpf.');
        const snapshots={},seen=new Set();for(const cells of rows){if(cells.length!==4)throw Error('Each row needs exactly four columns.');const [date,account]=cells.map(x=>x.trim());dateKey(date);if(date>todaySG()||!ACCOUNTS.includes(account))throw Error('Invalid date or account.');const invested=number(cells[2]),cash=number(cells[3]);if(invested<0)throw Error('Holdings cannot be negative.');if(seen.has(date+account))throw Error('Duplicate account and date in this import.');seen.add(date+account);snapshots[date]||={accounts:{},recordedAt:new Date().toISOString()};snapshots[date].accounts[account]={invested,cash,verified:true,source:'statement CSV'};}
        patch={snapshots};summary=`Import ${rows.length} verified account valuations across ${Object.keys(snapshots).length} dates. Existing matching dates and accounts will be replaced.`;
      }else{
        const backup=JSON.parse(text);if(backup.schema!==1||!backup.history)throw Error('Use a performance history backup.');
        patch=validateBackup(backup.history);summary='Merge this performance history backup. Matching records will be replaced. Existing portfolio holdings and settings stay unchanged.';
      }
      pending=patch;dialog('Review import',`<p>${esc(summary)}</p><label><input name="verified" type="checkbox" required> I checked the source and confirm these records.</label>`,async()=>{await save(pending);pending=null;});
    });input.click();
  }
  function validateBackup(h){
    const patch={snapshots:{},flows:{},trades:{},coverage:{}};
    for(const [date,s]of Object.entries(h.snapshots||{})){dateKey(date);if(date>todaySG())throw Error('Future valuation in backup.');const accounts={};for(const a of ACCOUNTS)if(s.accounts?.[a]){const r=s.accounts[a],invested=number(r.invested),cash=number(r.cash);if(invested<0)throw Error('Invalid valuation.');accounts[a]={invested,cash,verified:r.verified===true,source:'history backup'};}patch.snapshots[date]={accounts};}
    for(const [id,f]of Object.entries(h.flows||{})){if(!/^[a-f0-9-]{16,100}$/.test(id)||!ACCOUNTS.includes(f.account))throw Error('Invalid flow.');dateKey(f.date);if(f.date>todaySG())throw Error('Future movement in backup.');patch.flows[id]={id,date:f.date,account:f.account,kind:String(f.kind),total:number(f.total),invested:number(f.invested),voided:!!f.voided,note:String(f.note||'').slice(0,500)};}
    // Trades remain source evidence; never execute or infer cash transactions.
    for(const [id,t]of Object.entries(h.trades||{})){if(!/^[a-f0-9]{64}$/.test(id)||!ACCOUNTS.includes(t.account))throw Error('Invalid trade evidence.');dateKey(t.date);patch.trades[id]=t;}
    for(const a of ACCOUNTS)for(const b of ['total','invested'])if(h.coverage?.[a]?.[b]){const c=h.coverage[a][b];dateKey(c.start);dateKey(c.end);if(c.start>c.end||c.end>todaySG())throw Error('Invalid reconciliation coverage.');patch.coverage[a]||={};patch.coverage[a][b]={start:c.start,end:c.end};}
    return patch;
  }
  storage.load().then(h=>{if(alive){history={...empty(),...h};loaded=true;render();}}).catch(e=>{if(alive){error='Could not load history: '+e.message;render();}});
  return {update(s){const changedPrivacy=s.privacyMode!==state.privacyMode;state=s;if(alive&&loaded&&(!root.querySelector('dialog')||changedPrivacy))render();},destroy(){alive=false;root.replaceChildren();}};
}
