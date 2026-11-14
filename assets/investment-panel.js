import {recordPlanReview,reviewText,NOTION_REVIEW_URL} from './investment-review.js?v=plan-review-20261114';
import {planDraft,preferredPlanSymbol} from './investment-plan-defaults.js?v=plan-review-20261114';
import {STRATEGY_CATEGORIES} from './strategy-categories.js';
import {fundingSignature,strategyFunding,createPurchasePlan,recordStageFill,reviewPurchasePlan} from './investment-strategy.js?v=plan-review-20261114';
import {resolvedCompany,buildCommandCentre,addDecision,settleOrder} from './investment-command-centre.js?v=plan-review-20261114';
import {renderCommandCentre} from './investment-command-view.js?v=plan-review-20261114';
export {resolvedCompany} from './investment-command-centre.js?v=plan-review-20261114';
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
  let state=initial,research=initialResearch,config={plans:{},funding:{},decisions:{}},loaded=false,alive=true,busy=false,error='',notice='',filter='opportunities',categoryChange=onCategoryChange,selectedSymbol='',draftEdits={};
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
    if(state.privacyMode){root.innerHTML='<h2>Investment Command Centre</h2><p>Turn off privacy mode to view opportunities and decisions.</p>';return;}
    const model=buildCommandCentre(state,research,config,{today:today()});
    const {displayFunding:funding,fundingError}=model;
    const open=new Set([...root.querySelectorAll('details[open]')].map(x=>x.dataset.section));
    const symbols=[...new Set([...(state.holdings||[]).filter(h=>h.accountType==='Cash'&&!h.exited).map(h=>h.ticker),...(state.watchlist||[]).map(h=>h.symbol)])].filter(Boolean);
    selectedSymbol=preferredPlanSymbol(symbols,state,config.plans,selectedSymbol);
    root.innerHTML=`<div class="ic-title"><div><h2>Investment Command Centre</h2><p>Your next investment decisions, using current holdings and the watchlist.</p></div><button type="button" class="ic-secondary" data-reload-command>Reload saved decisions</button></div>
      <p>Anchor: equal nibbles at every approved support. Core: 1.5% + 1.5% + up to 3% at the deepest three (6% ceiling). Selective: reassess 2–4% per eligible entry at the deepest two (4% company ceiling); buy less or skip when cash or alternatives warrant it. Anchor ceiling: 10%.</p>
      ${!loaded?'<p>Loading saved plans and decisions…</p>':''}${error?`<p class="pf-error" role="alert">${esc(error)}</p>`:''}${notice?`<p role="status">${esc(notice)}</p>`:''}
      ${fundingError?`<p class="pf-error">${esc(fundingError)} Known values remain visible below; purchase amounts require refreshed inputs.</p>`:''}${funding?`<p>${funding.complete?'Strategy base':'Known portfolio subtotal (incomplete)'} <strong>${show(funding.base)}</strong> · holdings ${show(funding.invested)} + broker cash ${show(funding.broker)} + bank set aside ${show(funding.bank)} − liabilities ${show(funding.liabilities)}. Recorded order reservations: ${show(model.reserved)}. Available after all pending orders: <strong>${show(funding.available)}</strong>.</p>`:''}
      ${renderCommandCentre(model,{show,today:today(),filter})}
      <details data-section="funding" ${open.has('funding')?'open':''}><summary>Confirm strategy funding</summary>
        <form data-funding>${field('liabilities','Related liabilities (SGD)',config.funding.liabilities??0,'type="number" min="0" step="0.01" required')}${field('pending','External pending orders / reserved cash (SGD)',config.funding.pending??0,'type="number" min="0" step="0.01" required')}
        <label><input type="checkbox" name="confirmed" ${config.funding.confirmed?'checked':''} required> I reviewed holdings and FX. All recorded broker cash and bank set-aside cash are committed to this strategy; liabilities and pending orders above are current.</label><button ${!loaded?'disabled':''}>Save funding confirmation</button></form>
        <p>Enter pending orders not already recorded in My decisions, so cash is counted once. CPF/SRS are excluded. Pending orders reduce available cash, not the portfolio base. Refresh this confirmation when commitments change. Bank cash may need transferring before an order can be funded.</p></details>
      <details data-section="plan" ${open.has('plan')?'open':''}><summary>Create or review a company plan</summary>
        <form data-plan><label>Company<select name="symbol">${symbols.map(s=>`<option value="${esc(s)}" ${s===selectedSymbol?'selected':''}>${esc(s)}</option>`).join('')}</select></label>
        ${field('ceiling','Company purchase ceiling (%)','','type="number" min="0.01" max="100" step="0.01" required')}
        ${field('budget','Anchor: draft / approved addition budget (SGD)','','type="number" min="0" step="0.01"')}
        ${field('lot','Exchange board lot (shares)',1,'type="number" min="1" step="1" required')}
        <label><input type="checkbox" name="oddLots"> My broker supports buying odd lots in whole shares</label>
        <label>Decision / remarks<textarea name="remarks" maxlength="2000" rows="3" placeholder="Thesis, competing opportunities, reasons to reduce, defer or skip"></textarea></label>
        ${field('reviewedAt','Thesis and IV reviewed',today(),`type="date" max="${today()}" required`)}
        <label><input type="checkbox" name="approved" required> I reviewed the business, IV, trading currency, support ladder and ceiling. Any material news has been resolved.</label>
        <div data-plan-levels></div><div class="ic-plan-prefill" data-plan-prefill></div><button ${!loaded?'disabled':''}>Save reviewed plan</button></form>
        <p>Known rules and current dashboard values are prefilled for review. The Anchor draft budget is the remaining room below 10%; you may reduce it to what you actually intend to add. Core and Selective ceilings default to 6% and 4%. Selective previews show a spending range; choose the actual committed order amount after comparing opportunities. Shares are calculated from the capped planned amount and maximum entry price, using the board lot or whole shares if odd lots are supported. No fee/FX reserve is deducted. Anchor and Core stage budgets freeze in SGD on first approval. Selective budgets are maximums, not commitments. Routine reviews keep stage budgets and fills. An approved category or support-ladder change revises the schedule and preserves fills; removed stages remain in the history below. Remarks and a dated plan snapshot are retained in My decisions. <a href="${NOTION_REVIEW_URL}" target="_blank" rel="noopener">Stocks Plan Review in Notion</a> — copy a saved review there using My decisions.</p></details>
      <p class="ic-footnote">Removing watchlist-only tickers retires their active cards and preserves plans, fills and decisions. Holdings remain monitored even if removed from the watchlist. Written game-plan changes need an explicit rule update and plan review; Notion edits do not silently change the configured rules. Retirement and LEAPS remain later steps.</p>`;
    const selector=root.querySelector('[name="symbol"]');
    const showDraftDetails=()=>{
      const company=resolvedCompany(state,research,selector.value),saved=config.plans[selector.value];
      const draft=planDraft(company,saved,funding,{ceiling:root.querySelector('[name="ceiling"]').value,addBudget:root.querySelector('[name="budget"]').value,
        selectivePercents:[4,4],lotSize:root.querySelector('[name="oddLots"]').checked?1:root.querySelector('[name="lot"]').value});
      const boardLot=root.querySelector('[name="oddLots"]').checked?1:draft.lotSize;
      const available=funding?.available??null;
      const formatPrice=n=>n>0?esc(company.currency)+' '+Number(n).toLocaleString('en-SG',{maximumFractionDigits:2}):'—';
      root.querySelector('[data-plan-prefill]').innerHTML=`<p><strong>Prefilled from your game plan and dashboard</strong></p><dl class="ic-plan-facts"><div><dt>Portfolio base</dt><dd>${show(draft.base)}</dd></div><div><dt>Current holding · ${company.shares} shares</dt><dd>${show(draft.holding)}</dd></div><div><dt>Room below ceiling</dt><dd>${show(draft.room)}</dd></div><div><dt>Current IV</dt><dd>${formatPrice(company.iv)}</dd></div></dl>
        ${draft.stages.length?`<div class="ic-plan-stages">${draft.stages.map(stage=>`<div><strong>${esc(stage.key.toUpperCase())} · ${formatPrice(stage.price)}</strong><span>${draft.category==='anchor'?'Equal nibble':stage.portfolioPct!==null?(draft.category==='selective'?'2–4% dynamic; max ':'' )+stage.portfolioPct+'%':'Choose 2–4%'} · ${show(stage.budget)}${stage.frozen?' · saved budget':''}</span>${(()=>{const fx=company.currency==='SGD'?1:state.fxRates?.[company.currency],cap=Math.min(stage.budget??0,draft.room??0,available??0),raw=cap/(stage.price*fx);return boardLot>0&&fx>0&&stage.budget!==null&&draft.room!==null?`<span>${Math.floor(raw/boardLot)*boardLot} shares · ${show(Math.floor(raw/boardLot)*boardLot*stage.price*fx)} at entry · ${raw.toFixed(2)} before lot rounding</span>`:'<span>Quantity needs current funding and a confirmed trading lot.</span>';})()}</div>`).join('')}</div>`:''}
        <p class="ic-meta">${esc(draft.budgetSource)}. Stage budgets are capped by company room and shared available cash when a buy is reviewed. Lot size: ${esc(draft.lotSource)}.</p>
        ${draft.missing.length?`<p><strong>Still needs your input</strong></p><ul>${draft.missing.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'<p>Plan amounts and execution inputs are populated. Review the business, valuation and intended spending before approving.</p>'}`;
    };
    const showLevels=()=>{
      try{
        selectedSymbol=selector.value;
        const company=resolvedCompany(state,research,selectedSymbol),saved=config.plans[selectedSymbol],draft=planDraft(company,saved,funding);
        root.querySelector('[data-plan-levels]').textContent=`${STRATEGY_CATEGORIES[company.category]||'Unassigned — choose in Holdings or Watchlist'} · ${company.currency||'Currency missing'} · IV ${company.iv||'missing'} · `+company.levels.map(l=>`${l.key.toUpperCase()} ${l.price}`).join(' · ');
        const set=(key,value)=>{root.querySelector('[name="'+key+'"]').value=value??'';};
        set('ceiling',draft.ceiling);set('budget',draft.addBudget);set('lot',draft.lotSize);
        root.querySelector('[name="oddLots"]').checked=saved?.oddLots===true;root.querySelector('[name="lot"]').required=!saved?.oddLots;set('remarks',saved?.remarks||'');
        root.querySelector('[name="ceiling"]').max=({anchor:10,core:6,selective:4}[company.category]||100);
        const budget=root.querySelector('[name="budget"]');budget.disabled=company.category!=='anchor';budget.readOnly=company.category==='anchor'&&saved?.category==='anchor';budget.required=company.category==='anchor';
        budget.title=draft.budgetSource;
        root.querySelector('[name="ceiling"]').placeholder=company.category==='anchor'?'10% from game plan':'Set company ceiling';
        root.querySelector('[name="lot"]').placeholder='Confirm exchange board lot';
        root.querySelector('[data-plan] button').disabled=!loaded||!company.category;
        const edits=draftEdits[selectedSymbol];
        if(edits)for(const [key,value]of Object.entries(edits)){const input=root.querySelector('[data-plan] [name="'+key+'"]');if(input){if(input.type==='checkbox')input.checked=value;else input.value=value;}}
        root.querySelector('[name="lot"]').required=!root.querySelector('[name="oddLots"]').checked;
        showDraftDetails();
      }catch(e){root.querySelector('[data-plan-levels]').textContent=e.message;}
    };
    selector.onchange=showLevels;showLevels();
    root.querySelector('[name="oddLots"]').onchange=()=>{root.querySelector('[name="lot"]').required=!root.querySelector('[name="oddLots"]').checked;showDraftDetails();};
    const rememberDraft=()=>{draftEdits[selectedSymbol]=Object.fromEntries([...root.querySelectorAll('[data-plan] input,[data-plan] textarea')].filter(input=>input.name).map(input=>[input.name,input.type==='checkbox'?input.checked:input.value]));};
    root.querySelectorAll('[data-plan] input,[data-plan] textarea').forEach(input=>{
      const previous=input.onchange;
      input.oninput=()=>{rememberDraft();try{showDraftDetails();}catch(e){root.querySelector('[data-plan-prefill]').textContent=e.message;}};
      input.onchange=()=>{rememberDraft();previous?.();};
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
      let fresh=createPurchasePlan({symbol,category:c.category,selectivePercents:[4,4],levels:c.levels,base:funding.base,ceilingPct:fd.get('ceiling'),addBudget:previous?.category==='anchor'?previous.stages.reduce((n,s)=>n+s.budget,0):fd.get('budget'),iv:c.iv,currency:c.currency,reviewedAt:fd.get('reviewedAt'),id:previous?.id||crypto.randomUUID()});
      if(fresh.reviewedAt>today())throw Error('A review cannot be dated in the future.');
      fresh=reviewPurchasePlan(previous,fresh);
      fresh.lotSize=fd.get('oddLots')==='on'?1:Number(fd.get('lot'));fresh.oddLots=fd.get('oddLots')==='on';fresh.rounding='down';fresh.remarks=String(fd.get('remarks')||'').slice(0,2000);
      if(!Number.isInteger(fresh.lotSize)||fresh.lotSize<1)throw Error('Confirm the exchange board lot.');
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
    root.querySelectorAll('[data-clear-category]').forEach(button=>{button.disabled=!categoryChange;button.onclick=()=>categoryChange?.(button.dataset.clearCategory,'');});
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
