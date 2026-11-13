import {CORE_COMPANIES,fundingSignature,strategyFunding,createPurchasePlan,previewPurchase,recordStageFill} from './investment-strategy.js';
import {resolveWatchlistLevels} from './watchlist-levels.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function resolvedCompany(state,research,symbol){
  const rows=(state.watchlist||[]).filter(r=>r.symbol===symbol);
  if(rows.length>1)throw Error('Resolve duplicate watchlist rows for '+symbol+'.');
  const record=research?.records?.[symbol];
  const holding=(state.holdings||[]).find(h=>h.ticker===symbol&&h.accountType==='Cash'&&!h.exited);
  const row=rows[0]||{symbol};
  const resolved=resolveWatchlistLevels(row,record).row;
  const currency=row.priceCurrency||holding?.currency||record?.instrument?.currency||'';
  return {symbol,currency,iv:Number(resolved.iv),levels:['s1','s2','s3','s4','s5'].filter(k=>Number(resolved[k])>0).map(key=>({key,price:Number(resolved[key])})),quote:state.priceCache?.[symbol]};
}
export function createInvestmentComponent(React,jsx){
  return function InvestmentPanel({uid,state,research,storage}){
    const root=React.useRef(null),controller=React.useRef(null);
    React.useEffect(()=>{controller.current=mountInvestmentPanel(root.current,{state,research,storage});return()=>controller.current?.destroy();},[uid]);
    React.useEffect(()=>controller.current?.update(state,research),[state,research]);
    return jsx.jsx('section',{ref:root,className:'pf-panel investment-panel','aria-label':'Investment decision preview'});
  };
}
export function mountInvestmentPanel(root,{state:initial,research:initialResearch,storage}){
  let state=initial,research=initialResearch,config={plans:{},funding:{}},loaded=false,alive=true,busy=false,error='',notice='';
  const show=n=>state.privacyMode?'S$•••':n==null?'—':new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD'}).format(n);
  const field=(name,label,value='',attrs='')=>`<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
  async function save(next){
    if(!loaded||busy)throw Error('Wait for strategy data to finish loading or saving.');
    busy=true;
    try{await storage.save(next);if(alive){config=next;notice='Saved. Preview only; no order or notification sent.';}}finally{busy=false;}
  }
  function render(){
    if(!alive)return;
    if(state.privacyMode){root.innerHTML='<h2>Investment decision preview</h2><p>Turn off privacy mode to view or configure purchase plans.</p>';return;}
    let funding,fundingError='';
    try{funding=strategyFunding(state,config.funding);}catch(e){fundingError=e.message;}
    const open=new Set([...root.querySelectorAll('details[open]')].map(x=>x.dataset.section));
    const symbols=[...new Set([...CORE_COMPANIES,...(state.holdings||[]).filter(h=>h.accountType==='Cash'&&!h.exited).map(h=>h.ticker),...(state.watchlist||[]).map(h=>h.symbol)])].filter(Boolean);
    root.innerHTML=`<h2>Investment decision preview</h2><p>Core: ${CORE_COMPANIES.join(', ')}. Shares only · retirement lump-sum planning deferred.</p>
      <p>Top six: equal nibbles at every approved support. Other companies: 2.5% + 2.5% + up to 5% at the deepest three approved supports. Each company’s ceiling still applies.</p>
      ${!loaded?'<p>Loading saved plans…</p>':''}${error?`<p class="pf-error" role="alert">${esc(error)}</p>`:''}${notice?`<p role="status">${esc(notice)}</p>`:''}
      ${fundingError?`<p class="pf-error">${esc(fundingError)}</p>`:`<p>Strategy base <strong>${show(funding.base)}</strong> · holdings ${show(funding.invested)} + broker cash ${show(funding.broker)} + bank set aside ${show(funding.bank)} − liabilities ${show(funding.liabilities)}. Shared available cash after pending orders: <strong>${show(funding.available)}</strong>.</p>`}
      <details data-section="funding" ${open.has('funding')?'open':''}><summary>Confirm strategy funding</summary>
        <form data-funding>${field('liabilities','Related liabilities (SGD)',config.funding.liabilities??0,'type="number" min="0" step="0.01" required')}${field('pending','Pending orders / reserved cash (SGD)',config.funding.pending??0,'type="number" min="0" step="0.01" required')}
        <label><input type="checkbox" name="confirmed" ${config.funding.confirmed?'checked':''} required> I reviewed holdings and FX. All recorded broker cash and bank set-aside cash are committed to this strategy; liabilities and pending orders above are current.</label><button ${!loaded?'disabled':''}>Save funding confirmation</button></form>
        <p>CPF/SRS are excluded. Pending orders reduce available cash, not the portfolio base. Refresh this confirmation when commitments change. Bank cash may need transferring before an order can be funded.</p></details>
      <details data-section="plan" ${open.has('plan')?'open':''}><summary>Create or review a company plan</summary>
        <form data-plan><label>Company<select name="symbol">${symbols.map(s=>`<option>${esc(s)}</option>`).join('')}</select></label>
        ${field('ceiling','Company purchase ceiling (%)','','type="number" min="0.01" max="100" step="0.01" required')}
        ${field('budget','Core only: total intended addition (SGD)','','type="number" min="0" step="0.01"')}
        ${field('fees','Fee / FX reserve per order (SGD)','','type="number" min="0" step="0.01" required')}
        ${field('lot','Tradable lot size',1,'type="number" min="1" step="1" required')}
        ${field('reviewedAt','Thesis and IV reviewed',today(),`type="date" max="${today()}" required`)}
        <label><input type="checkbox" name="approved" required> I reviewed the business, IV, trading currency, support ladder and ceiling. Any material news has been resolved.</label>
        <p data-plan-levels></p><button ${!loaded?'disabled':''}>Save reviewed plan</button></form>
        <p>Core ceiling defaults to 10%; choose a ceiling for every other company. Core addition budget covers only what you still intend to add. Budgets freeze in SGD on first approval. Reviewing a plan keeps its original stage IDs, budgets and fills. A ladder that changes its stage keys needs manual review; no reset is performed.</p></details>
      <div data-decisions></div><p>These are current-level previews, not new-crossing alerts. Eligible companies share the same cash pool; their individual amounts must not be added together as funded orders. You approve and execute each transaction.</p>`;
    const selector=root.querySelector('[name="symbol"]');
    const showLevels=()=>{
      try{
        const c=resolvedCompany(state,research,selector.value),saved=config.plans[selector.value];
        root.querySelector('[data-plan-levels]').textContent=`${c.currency||'Currency missing'} · IV ${c.iv||'missing'} · `+c.levels.map(l=>`${l.key.toUpperCase()} ${l.price}`).join(' · ');
        root.querySelector('[name="ceiling"]').value=saved?.ceilingPct??(CORE_COMPANIES.includes(selector.value)?10:'');
        root.querySelector('[name="fees"]').value=saved?.feeReserve??'';
        root.querySelector('[name="lot"]').value=saved?.lotSize??1;
        root.querySelector('[name="budget"]').disabled=!!saved||!CORE_COMPANIES.includes(selector.value);
      }catch(e){root.querySelector('[data-plan-levels]').textContent=e.message;}
    };
    selector.onchange=showLevels;showLevels();
    const decisions=root.querySelector('[data-decisions]');
    if(!Object.keys(config.plans).length)decisions.innerHTML='<p>No purchase plans approved yet. Review a company above to start.</p>';
    let total=0;
    for(const plan of Object.values(config.plans)){
      let result;
      try{
        const c=resolvedCompany(state,research,plan.symbol);
        const changed=plan.stages.some(s=>!c.levels.some(l=>l.key===s.key&&l.price===s.price));
        result=funding?previewPurchase(plan,funding,{close:c.quote?.close,priceStale:c.quote?.priceStale||!c.quote?.timestamp||Date.now()-Number(c.quote.timestamp)>4*86400000,fx:c.currency==='SGD'?1:state.fxRates?.[c.currency],iv:c.iv,today:today(),feeReserve:plan.feeReserve,lotSize:plan.lotSize,levelsChanged:changed||c.currency!==plan.currency}):{status:'review',amount:null,reasons:[fundingError]};
      }catch(e){result={status:'review',amount:null,reasons:[e.message]};}
      if(result.status==='eligible')total+=result.amount;
      const card=document.createElement('article');card.className='investment-card';
      card.innerHTML=`<h3>${esc(plan.symbol)} · ${result.status==='eligible'?'Review buy up to '+show(result.amount)+(state.privacyMode?'':` (${result.portfolioPct.toFixed(2)}%)`):result.status==='review'?'Review first · amount pending':result.status==='paused'?'Pause additions':'Hold'}</h3>
        <p>${esc(result.reasons.join(' '))}</p>${result.status==='eligible'?`<p>Maximum entry ${esc(plan.currency)} ${result.maxEntry.toFixed(2)}${result.strictIV?' (must execute strictly below IV)':''} · estimated ${state.privacyMode?'•••':result.units} units after ${show(plan.feeReserve)} reserve · projected company weight ${state.privacyMode?'•••':result.projectedWeight.toFixed(2)+'%'} · limited by ${esc(result.limitedBy.join(', '))}.</p>`:''}
        ${result.next?`<p>Next unused support: ${esc(result.next.key.toUpperCase())} · ${esc(plan.currency)} ${result.next.price}.</p>`:''}
        <p>Plan reviewed ${esc(plan.reviewedAt)} · IV ${esc(plan.currency)} ${plan.iv} · company ceiling ${plan.ceilingPct}%.</p>
        <details data-section="${esc(plan.id)}" ${open.has(plan.id)?'open':''}><summary>Purchase stages and actual fills</summary>${plan.stages.map(s=>`<form data-fill="${esc(plan.symbol)}" data-stage="${esc(s.id)}"><strong>${esc(s.key.toUpperCase())} · budget ${show(s.budget)} · ${s.completed?'Completed':'Open'}</strong>${field('spent','Cumulative actual spend including fees (SGD)',state.privacyMode?'':s.spent,'type="number" min="0" step="0.01" required')}${field('date','Actual fill date',s.fillDate||today(),`type="date" max="${today()}" required`)}<label><input type="checkbox" name="completed" ${s.completed?'checked':''}> Mark this stage completed</label><button ${!loaded?'disabled':''}>Save fill</button></form>`).join('')}</details>`;
      decisions.append(card);
    }
    if(funding&&total>funding.available){const p=document.createElement('p');p.className='pf-error';p.textContent='Eligible previews total '+show(total)+' against shared cash of '+show(funding.available)+'. Select and reserve orders before executing; all previews cannot be funded together.';decisions.prepend(p);}
    const action=fn=>async e=>{e.preventDefault();error='';notice='';try{await fn(new FormData(e.target),e.target);}catch(err){error=err.message;}render();};
    root.querySelector('[data-funding]').onsubmit=action(async fd=>{
      const next={...config,funding:{liabilities:Number(fd.get('liabilities')),pending:Number(fd.get('pending')),confirmed:fd.get('confirmed')==='on',confirmedAt:new Date().toISOString(),basisSignature:fundingSignature(state)}};
      strategyFunding(state,next.funding);await save(next);
    });
    root.querySelector('[data-plan]').onsubmit=action(async fd=>{
      if(!funding)throw Error(fundingError);
      if(fd.get('approved')!=='on')throw Error('Review the company before saving.');
      const symbol=fd.get('symbol'),c=resolvedCompany(state,research,symbol),previous=config.plans[symbol];
      const fresh=createPurchasePlan({symbol,levels:c.levels,base:funding.base,ceilingPct:fd.get('ceiling'),addBudget:previous?previous.stages.reduce((n,s)=>n+s.budget,0):fd.get('budget'),iv:c.iv,currency:c.currency,reviewedAt:fd.get('reviewedAt'),id:previous?.id||crypto.randomUUID()});
      if(fresh.reviewedAt>today())throw Error('A review cannot be dated in the future.');
      if(previous){
        if(previous.stages.length!==fresh.stages.length||previous.stages.some((s,i)=>s.key!==fresh.stages[i].key))throw Error('The number or keys of approved stages changed. Keep the existing plan until its purchase history is reconciled.');
        fresh.baseAtApproval=previous.baseAtApproval;
        fresh.stages=fresh.stages.map((s,i)=>({...previous.stages[i],price:s.price}));
      }
      fresh.feeReserve=Number(fd.get('fees'));fresh.lotSize=Number(fd.get('lot'));
      if(!Number.isFinite(fresh.feeReserve)||fresh.feeReserve<0||!Number.isInteger(fresh.lotSize)||fresh.lotSize<1)throw Error('Enter valid fees and lot size.');
      await save({...config,plans:{...config.plans,[symbol]:fresh}});
    });
    root.querySelectorAll('[data-fill]').forEach(form=>form.onsubmit=action(async(fd,form)=>{
      if(fd.get('date')>today())throw Error('A fill cannot be dated in the future.');
      const symbol=form.dataset.fill,plan=recordStageFill(config.plans[symbol],form.dataset.stage,{spent:fd.get('spent'),completed:fd.get('completed')==='on',date:fd.get('date')});
      // Fill and funding invalidation must persist atomically.
      await save({...config,plans:{...config.plans,[symbol]:plan},funding:{...config.funding,confirmed:false}});
      notice='Stage fill saved. Import updated holdings and broker cash, then confirm funding before using another preview.';
    }));
  }
  render();
  storage.load().then(saved=>{if(alive){config={plans:{},funding:{},...saved};loaded=true;render();}}).catch(e=>{if(alive){error='Could not load saved plans: '+e.message;render();}});
  return {update(next,nextResearch){state=next;research=nextResearch;render();},destroy(){alive=false;root.innerHTML='';}};
}
