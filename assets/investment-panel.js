import {renderPlanBreakdown} from './investment-plan-breakdown.js?v=support-allocation-20261114';
import {money,amount,quantityText} from './investment-format.js?v=compact-price-20261114';
import {recordPlanReview,reviewText,NOTION_REVIEW_URL} from './investment-review.js?v=compact-price-20261114';
import {planDraft,preferredPlanSymbol,entryDraft} from './investment-plan-defaults.js?v=compact-price-20261114';
import {STRATEGY_CATEGORIES} from './strategy-categories.js?v=entry-sizing-20261114';
import {fundingSignature,strategyFunding,createPurchasePlan,recordStageFill,reviewPurchasePlan} from './investment-strategy.js?v=compact-price-20261114';
import {resolvedCompany,buildCommandCentre,addDecision,settleOrder} from './investment-command-centre.js?v=compact-price-20261114';
import {renderCommandCentre,renderPublicCommandCentre} from './investment-command-view.js?v=compact-price-20261114';
export {resolvedCompany} from './investment-command-centre.js?v=compact-price-20261114';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function createInvestmentComponent(React,jsx){
  return function InvestmentPanel({uid,state,research,storage,onCategoryChange}){
    const root=React.useRef(null),controller=React.useRef(null);
    React.useEffect(()=>{controller.current=mountInvestmentPanel(root.current,{state,research,storage,onCategoryChange});return()=>controller.current?.destroy();},[uid]);
    React.useEffect(()=>controller.current?.update(state,research,onCategoryChange),[state,research,onCategoryChange]);
    return jsx.jsx('section',{ref:root,className:'pf-panel investment-panel','aria-label':'Investment Command Centre'});
  };
}
export function mountInvestmentPanel(root,{state:initial,research:initialResearch,storage,onCategoryChange}){
  let state=initial,research=initialResearch,config={plans:{},funding:{},decisions:{}},loaded=false,alive=true,busy=false,error='',notice='',filter='opportunities',categoryFilter='all',categorySort='none',categoryChange=onCategoryChange,selectedSymbol='',draftEdits={};
  const show=n=>state.privacyMode?'S$•••':n==null?'—':'S$'+new Intl.NumberFormat('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const field=(name,label,value='',attrs='')=>`<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
  async function reload(){
    if(busy)return;
    try{const saved=await storage.load();if(alive){config={plans:{},funding:{},decisions:{},...saved};loaded=true;error='';render();}}catch(e){if(alive){loaded=false;error='Could not load saved plans: '+e.message;render();}}
  }
  async function save(next){
    if(!loaded||busy)throw Error('Wait for strategy data to finish loading or saving.');
    busy=true;
    try{await storage.save(next);if(alive){config=next;notice='Saved. Preview only; no order or notification sent.';}}finally{busy=false;}
  }
  function render(){
    if(!alive)return;
    const model=buildCommandCentre(state,research,config,{today:today()});
    if(state.privacyMode){
      root.innerHTML='<h2>Investment Command Centre</h2>'+renderPublicCommandCentre(model,{categoryFilter,categorySort});
      root.querySelector('[data-opportunity-category]').onchange=e=>{categoryFilter=e.target.value;render();};
      root.querySelector('[data-opportunity-sort]').onchange=e=>{categorySort=e.target.value;render();};
      return;
    }
    const {displayFunding:funding,fundingError}=model;
    const open=new Set([...root.querySelectorAll('details[open]')].map(x=>x.dataset.section));
    const symbols=[...new Set([...(state.holdings||[]).filter(h=>h.accountType==='Cash'&&!h.exited).map(h=>h.ticker),...(state.watchlist||[]).map(h=>h.symbol)])].filter(Boolean);
    selectedSymbol=preferredPlanSymbol(symbols,state,config.plans,selectedSymbol);
    root.innerHTML=`<div class="ic-title"><div><h2>Investment Command Centre</h2><p>Your next investment decisions, using current holdings and the watchlist.</p></div><button type="button" class="ic-secondary" data-reload-command>Reload saved decisions</button></div>
      <p>Anchor: equal nibbles at every approved support. Core: 1.5% + 1.5% + up to 3% at the deepest three (6% ceiling). Selective: reassess 2–4% per eligible entry at the deepest two (4% company ceiling); buy less or skip when cash or alternatives warrant it. Anchor ceiling: 10%.</p>
      ${!loaded?'<p>Loading saved plans and decisions…</p>':''}${error?`<p class="pf-error" role="alert">${esc(error)}</p>`:''}${notice?`<p role="status">${esc(notice)}</p>`:''}
      ${fundingError?`<p class="pf-error">${esc(fundingError)} Known values remain visible below; purchase amounts require refreshed inputs.</p>`:''}${funding?`<p>${funding.complete?'Strategy base':'Known portfolio subtotal (incomplete)'} <strong>${show(funding.base)}</strong> · holdings ${show(funding.invested)} + broker cash ${show(funding.broker)} + bank set aside ${show(funding.bank)} − liabilities ${show(funding.liabilities)}. Recorded order reservations: ${show(model.reserved)}. Available after all pending orders: <strong>${show(funding.available)}</strong>.</p>`:''}
      ${renderCommandCentre(model,{show,today:today(),filter,categoryFilter,categorySort})}
      <details data-section="funding" ${open.has('funding')?'open':''}><summary>Confirm strategy funding</summary>
        <form data-funding>${field('liabilities','Related liabilities (SGD)',config.funding.liabilities??0,'type="number" min="0" step="0.01" required')}${field('pending','External pending orders / reserved cash (SGD)',config.funding.pending??0,'type="number" min="0" step="0.01" required')}
        <label><input type="checkbox" name="confirmed" ${config.funding.confirmed?'checked':''} required> I reviewed holdings and FX. All recorded broker cash and bank set-aside cash are committed to this strategy; liabilities and pending orders above are current.</label><button ${!loaded?'disabled':''}>Save funding confirmation</button></form>
        <p>Enter pending orders not already recorded in My decisions, so cash is counted once. CPF/SRS are excluded. Pending orders reduce available cash, not the portfolio base. Refresh this confirmation when commitments change. Bank cash may need transferring before an order can be funded.</p></details>
      <details data-section="plan" ${open.has('plan')?'open':''}><summary>Create or review a company plan</summary>
        <form data-plan class="ic-compact-plan">
        <label>Company<select name="symbol">${symbols.map(s=>`<option value="${esc(s)}" ${s===selectedSymbol?'selected':''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Support<select name="stage"></select></label>
        ${field('entry','Entry price','','type="text" inputmode="decimal" required')}
        ${field('quantity','Quantity (shares)','','type="text" inputmode="numeric" required')}
        <label class="ic-native-estimate">Estimated purchase<output data-native-estimate>—</output><small data-sgd-estimate></small></label>
        <label class="ic-plan-remarks-field">Decision / remarks<textarea name="remarks" maxlength="2000" rows="1" placeholder="Thesis, alternatives or reason to wait"></textarea></label>
        ${field('reviewedAt','Reviewed',today(),`type="date" max="${today()}" required`)}
        <label class="ic-plan-approval" title="I reviewed the business, IV, trading currency, support ladder and ceiling. Any material news has been resolved."><input type="checkbox" name="approved" required> Plan reviewed</label>
        <button ${!loaded?'disabled':''}>Save plan</button>
        <details class="ic-plan-settings" data-section="plan-settings" ${open.has('plan-settings')?'open':''}><summary>Plan settings</summary><div class="ic-settings-body">
          ${field('ceiling','Company ceiling (%)','','type="number" min="0.01" max="100" step="0.01" required')}
          ${field('budget','Total Anchor addition budget (SGD)','','type="text" inputmode="decimal"')}
          ${field('lot','Order increment (shares)',1,'type="number" min="1" step="1" required')}
          <p>Defaults follow your game plan. Quantity is editable; use an increment of 1 for whole-share orders when supported.</p>
          <div data-plan-levels></div><div class="ic-plan-prefill" data-plan-prefill></div>
          <p class="ic-footnote">Saving a plan records your proposed entry, quantity and remarks. Cash is reserved only when you record a committed order. Dated reviews are in My decisions, with Copy for Notion for the <a href="${NOTION_REVIEW_URL}" target="_blank" rel="noopener">Stocks Plan Review log</a>.</p>
        </div></details></form>
        <p class="ic-meta" data-plan-feedback></p>
        </details>
`;
    const selector=root.querySelector('[name="symbol"]');
    const get=name=>root.querySelector('[data-plan] [name="'+name+'"]');
    const currentDraft=()=>{
      const company=resolvedCompany(state,research,selector.value),saved=config.plans[selector.value];
      return {company,saved,draft:planDraft(company,saved,funding,{ceiling:get('ceiling').value,addBudget:amount(get('budget').value),selectivePercents:[4,4],lotSize:get('lot').value})};
    };
    const executionNow=()=>{const {company,draft}=currentDraft();return entryDraft(draft,company,funding,{stageKey:get('stage').value,entryPrice:amount(get('entry').value),quantity:amount(get('quantity').value),increment:draft.lotSize,useStageAllowance:true});};
    const showDraftDetails=()=>{
      const {company,saved,draft}=currentDraft(),stageSelector=get('stage');
      if(stageSelector.dataset.symbol!==selector.value){
        stageSelector.innerHTML=draft.stages.map(s=>`<option value="${esc(s.key)}">${esc(s.key.toUpperCase())} · ${esc(money(s.price,company.currency))}${s.completed?' · completed':''}</option>`).join('');stageSelector.dataset.symbol=selector.value;
        stageSelector.value=(draft.stages.some(s=>s.key===saved?.plannedEntryKey)?saved.plannedEntryKey:entryDraft(draft,company,funding).stage?.key)||'';
      }
      const initial=executionNow();
      if(get('entry').value==='')get('entry').value=initial.entry==null?'':money(initial.entry,company.currency);
      const execution=executionNow();
      if(get('quantity').value==='')get('quantity').value=quantityText(execution.units);
      const sized=executionNow();
      root.querySelector('[data-native-estimate]').textContent=sized.spend==null?'—':money(sized.units*sized.entry,company.currency);
      root.querySelector('[data-sgd-estimate]').textContent=company.currency==='SGD'||sized.spend==null?'':'≈ '+money(sized.spend,'SGD');
      root.querySelector('[data-plan-feedback]').textContent=[...sized.issues,...(draft.missing.length?draft.missing:[])].join(' ');
      root.querySelector('[data-plan-prefill]').innerHTML=`<dl class="ic-plan-facts"><div><dt>Portfolio base</dt><dd>${show(draft.base)}</dd></div><div><dt>Current holding · ${quantityText(company.shares)} shares</dt><dd>${show(draft.holding)}</dd></div><div><dt>Room below ceiling</dt><dd>${show(draft.room)}</dd></div><div><dt>IV</dt><dd>${esc(money(company.iv,company.currency))}</dd></div></dl><p class="ic-meta">${esc(draft.budgetSource)}. Remaining stage allowance and shared cash cap the quantity.</p>${renderPlanBreakdown(draft,company,funding,sized)}`;
      return sized;
    };
    const showLevels=()=>{
      try{
        selectedSymbol=selector.value;
        const company=resolvedCompany(state,research,selectedSymbol),saved=config.plans[selectedSymbol],draft=planDraft(company,saved,funding);
        root.querySelector('[data-plan-levels]').textContent=`${STRATEGY_CATEGORIES[company.category]||'Unassigned'} · IV ${money(company.iv,company.currency)} · `+company.levels.map(l=>`${l.key.toUpperCase()} ${money(l.price,company.currency)}`).join(' · ');
        get('ceiling').value=draft.ceiling??'';get('ceiling').max=({anchor:10,core:6,selective:4}[company.category]||100);
        get('budget').value=draft.addBudget==null?'':money(draft.addBudget,'SGD');get('budget').disabled=company.category!=='anchor';get('budget').required=company.category==='anchor';get('budget').readOnly=company.category==='anchor'&&saved?.category==='anchor';get('budget').closest('label').hidden=company.category!=='anchor';
        get('lot').value=draft.lotSize??'';get('remarks').value=saved?.remarks||'';get('entry').value='';get('quantity').value='';get('stage').dataset.symbol='';
        get('approved').checked=false;showDraftDetails();
        const edits=draftEdits[selectedSymbol];if(edits)for(const[key,value]of Object.entries(edits)){if(get(key)){if(get(key).type==='checkbox')get(key).checked=value;else get(key).value=value;}}
        root.querySelector('[data-plan] button').disabled=!loaded||!company.category;
        showDraftDetails();
        if(!draft.lotSize)root.querySelector('.ic-plan-settings').open=true;
      }catch(e){root.querySelector('[data-plan-feedback]').textContent=e.message;}
    };
    const rememberDraft=()=>{draftEdits[selectedSymbol]=Object.fromEntries([...root.querySelectorAll('[data-plan] input:not([readonly]),[data-plan] textarea,[data-plan] select[name="stage"]')].filter(input=>input.name).map(input=>[input.name,input.type==='checkbox'?input.checked:input.value]));};
    selector.onchange=showLevels;showLevels();
    get('stage').onchange=()=>{get('entry').value='';get('quantity').value='';showDraftDetails();rememberDraft();};
    root.querySelectorAll('[data-plan] input,[data-plan] textarea').forEach(input=>{
      input.oninput=()=>{if(['entry','ceiling','budget','lot'].includes(input.name))get('quantity').value='';try{showDraftDetails();rememberDraft();}catch(e){root.querySelector('[data-plan-feedback]').textContent=e.message;}};
      input.onchange=()=>{showDraftDetails();rememberDraft();};
      input.onblur=()=>{const sized=executionNow();if(input.name==='entry'&&amount(input.value)!==null)input.value=money(amount(input.value),currentDraft().company.currency);if(input.name==='budget'&&amount(input.value)!==null)input.value=money(amount(input.value),'SGD');if(input.name==='quantity'&&sized.requestedUnits!==null&&sized.requestedUnits<=sized.maximumUnits)input.value=quantityText(sized.units);showDraftDetails();rememberDraft();};
    });
    const action=fn=>async e=>{e.preventDefault();error='';notice='';try{if(!loaded||busy)throw Error('Wait for saved decisions to load or finish saving.');await fn(new FormData(e.target),e.target);}catch(err){error=err.message;}render();};
    root.querySelector('[data-funding]').onsubmit=action(async fd=>{
      const next={...config,funding:{liabilities:Number(fd.get('liabilities')),pending:Number(fd.get('pending')),confirmed:fd.get('confirmed')==='on',confirmedAt:new Date().toISOString(),basisSignature:fundingSignature(state)}};
      strategyFunding(state,next.funding);await save(next);
    });
    root.querySelector('[data-plan]').onsubmit=action(async fd=>{
      if(!funding||!funding.complete)throw Error(fundingError||'Complete the missing holding valuations before approving a plan.');
      if(fd.get('approved')!=='on')throw Error('Review the company before saving.');
      const symbol=fd.get('symbol'),c=resolvedCompany(state,research,symbol),previous=config.plans[symbol];
      let fresh=createPurchasePlan({symbol,category:c.category,selectivePercents:[4,4],levels:c.levels,base:funding.base,ceilingPct:fd.get('ceiling'),addBudget:previous?.category==='anchor'?previous.stages.reduce((n,s)=>n+s.budget,0):amount(fd.get('budget')),iv:c.iv,currency:c.currency,reviewedAt:fd.get('reviewedAt'),id:previous?.id||crypto.randomUUID()});
      if(fresh.reviewedAt>today())throw Error('A review cannot be dated in the future.');
      fresh=reviewPurchasePlan(previous,fresh);
      fresh.lotSize=Number(fd.get('lot'));fresh.oddLots=false;fresh.rounding='down';fresh.remarks=String(fd.get('remarks')||'').slice(0,2000);
      if(!Number.isInteger(fresh.lotSize)||fresh.lotSize<1)throw Error('Confirm the share increment for this order.');
      const approvedDraft=planDraft(c,fresh,funding,{lotSize:fresh.lotSize}),execution=entryDraft(approvedDraft,c,funding,{stageKey:fd.get('stage'),entryPrice:amount(fd.get('entry')),quantity:amount(fd.get('quantity')),increment:fresh.lotSize,useStageAllowance:true});
      if(amount(fd.get('entry'))===null||amount(fd.get('quantity'))===null)throw Error('Enter a valid entry price and whole-share quantity.');
      if(execution.issues.length)throw Error(execution.issues.join(' '));
      if(!execution.stage||execution.units===null)throw Error('Review the selected support and calculated purchase quantity.');
      fresh.plannedEntryKey=execution.stage.key;
      fresh.stages=fresh.stages.map(s=>s.key===execution.stage.key?{...s,entryPrice:execution.entry,purchaseQuantity:execution.units,purchaseBudget:s.spent+Math.min(execution.capacity,Math.ceil((execution.spend-1e-9)*100)/100)}:s);
      await save(recordPlanReview(config,fresh,{id:crypto.randomUUID(),now:new Date().toISOString(),holding:funding.byCompany[symbol]??0,base:funding.base,shares:c.shares}));delete draftEdits[symbol];
    });
    root.querySelectorAll('[data-fill]').forEach(form=>form.onsubmit=action(async(fd,form)=>{
      if(fd.get('date')>today())throw Error('A fill cannot be dated in the future.');
      const symbol=form.dataset.fill;
      if(Object.values(config.decisions||{}).some(d=>d.status==='ordered'&&d.symbol===symbol&&d.stageId===form.dataset.stage))throw Error('Record this fill through the pending order in My decisions so its reservation is reconciled.');
      const plan=recordStageFill(config.plans[symbol],form.dataset.stage,{spent:fd.get('spent'),completed:fd.get('completed')==='on',date:fd.get('date')});
      // Fill and funding invalidation must persist atomically.
      await save({...config,plans:{...config.plans,[symbol]:plan},funding:{...config.funding,confirmed:false}});
      notice='Stage fill saved. Import updated holdings and broker cash, then confirm funding before using another preview.';
    }));
    root.querySelector('[data-reload-command]').onclick=()=>reload();
    root.querySelectorAll('[data-copy-review]').forEach(button=>button.onclick=async()=>{
      const record=config.decisions[button.dataset.copyReview],text=reviewText(record);
      try{await navigator.clipboard.writeText(text);button.textContent='Copied — paste into Stocks Plan Review';}
      catch{const area=document.createElement('textarea');area.value=text;area.readOnly=true;button.after(area);area.focus();area.select();button.textContent='Select and copy this review';}
    });
    if(root.querySelector('[data-opportunity-category]'))root.querySelector('[data-opportunity-category]').onchange=e=>{categoryFilter=e.target.value;render();};
    if(root.querySelector('[data-opportunity-sort]'))root.querySelector('[data-opportunity-sort]').onchange=e=>{categorySort=e.target.value;render();};
    root.querySelectorAll('[data-command-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.commandFilter;render();});
    root.querySelectorAll('[data-review-plan]').forEach(button=>button.onclick=()=>{
      const details=root.querySelector('[data-section="plan"]');details.open=true;selector.value=button.dataset.reviewPlan;selectedSymbol=button.dataset.reviewPlan;showLevels();details.scrollIntoView?.({behavior:'smooth',block:'start'});
    });
    root.querySelectorAll('[data-open-decision]').forEach(button=>button.onclick=()=>{
      const card=button.closest('[data-opportunity]'),form=card.querySelector('[data-decision-form]'),kind=button.dataset.openDecision;
      form.hidden=false;form.elements.kind.value=kind;
      form.querySelectorAll('[data-defer-field]').forEach(el=>{el.hidden=kind!=='deferred';});
      form.querySelectorAll('[data-order-field]').forEach(el=>{el.hidden=kind!=='ordered';});
      form.elements.until.disabled=kind!=='deferred';form.elements.until.required=kind==='deferred';
      form.elements.amount.disabled=kind!=='ordered';form.elements.amount.required=kind==='ordered';
    });
    root.querySelectorAll('[data-close-decision]').forEach(button=>button.onclick=()=>{button.closest('form').hidden=true;});
    root.querySelectorAll('[data-decision-form]').forEach(form=>form.onsubmit=action(async(fd,form)=>{
      const latest=buildCommandCentre(state,research,config,{today:today()});
      const row=latest.rows.find(r=>r.symbol===form.dataset.decisionForm);if(!row)throw Error('This company is no longer active. Reload the Command Centre.');
      await save(addDecision(config,row,{kind:fd.get('kind'),amount:fd.get('amount'),until:fd.get('until'),note:fd.get('note'),id:crypto.randomUUID(),now:new Date().toISOString(),today:today()}));
      notice=fd.get('kind')==='ordered'?'Pending order recorded and cash reserved. No broker order was sent.':'Decision saved. Changes to the company’s inputs will bring it back for review.';
    }));
    root.querySelectorAll('[data-cancel-order]').forEach(button=>button.onclick=async()=>{
      error='';try{await save(settleOrder(config,button.dataset.cancelOrder,{kind:'cancelled',now:new Date().toISOString(),today:today()}));notice='Cancellation recorded; the reservation is released. No broker order was cancelled by this application.';}catch(e){error=e.message;}render();
    });
    root.querySelectorAll('[data-settle-order]').forEach(form=>form.onsubmit=action(async(fd,form)=>{
      await save(settleOrder(config,form.dataset.settleOrder,{kind:'filled',spent:fd.get('spent'),completed:fd.get('completed')==='on',date:fd.get('date'),now:new Date().toISOString(),today:today()}));
      notice='Final fill recorded and reservation closed. Import updated holdings/cash, then confirm funding before another purchase preview.';
    }));
    if(!loaded)root.querySelectorAll('button:not([data-reload-command])').forEach(button=>button.disabled=true);
  }
  render();
  reload();
  return {update(next,nextResearch,nextCategoryChange=categoryChange){state=next;research=nextResearch;categoryChange=nextCategoryChange;render();},destroy(){alive=false;root.innerHTML='';}};
}
