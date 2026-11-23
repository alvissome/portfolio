import {activeWatchlist} from './active-watchlist.js';
import {openPriceChart} from './ticker-chart.js';
import {researchProcessingLabel,researchComparisonLabel} from './research-panel.js?v=plan-research-20261115';
import {redistributeBudget} from './budget-redistribution.js?v=redistribution-20261115';
import {planAction,saveActionPlan,planWatchlistAddition,validateResearchOverrides,nextHoldSupport} from './investment-actions.js?v=hold-support-20261118';
import {cashImportBasis,recordStageCashFill,correctStageCashFill,reconcileCashUse,cashUseCanBeIncluded} from './cc-cash-allowance.js?v=stage-history-20261118';
import {renderPlanBreakdown} from './investment-plan-breakdown.js?v=compact-settings-20261115';
import {money,amount,quantityText} from './investment-format.js?v=compact-price-20261114';
import {recordPlanReview,companyDecisionText,NOTION_REVIEW_URL} from './investment-review.js?v=hold-support-20261118';
import {planDraft,preferredPlanSymbol,entryDraft} from './investment-plan-defaults.js?v=redistribution-20261115';
import {STRATEGY_CATEGORIES} from './strategy-categories.js?v=entry-sizing-20261114';
import {fundingSignature,strategyFunding,createPurchasePlan,pricedFill,recordStageFill,reviewPurchasePlan} from './investment-strategy.js?v=stage-history-20261118';
import {resolvedCompany,buildCommandCentre,addDecision,settleOrder} from './investment-command-centre.js?v=stage-history-20261118';
import {renderCommandCentre,renderCommandOverview,renderPublicCommandCentre} from './investment-command-view.js?v=decision-stage-status-20261123';
export {resolvedCompany} from './investment-command-centre.js?v=stage-history-20261118';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function revisitDate(date,months=1){
  const [year,month,day]=date.split('-').map(Number),last=new Date(Date.UTC(year,month-1+months+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month-1+months,Math.min(day,last))).toISOString().slice(0,10);
}
export function supportSourceLabel(company){
  const levels=company.levels||[];
  if(!levels.length)return 'unavailable';
  const sources=levels.map(l=>company.sources?.[l.key]||'unavailable');
  return new Set(sources).size===1?sources[0]+' ('+levels.map(l=>l.key.toUpperCase()).join(', ')+')':levels.map((l,i)=>l.key.toUpperCase()+': '+sources[i]).join(' · ');
}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function createInvestmentComponent(React,jsx){
  return function InvestmentPanel({uid,overviewRoot,state,research,storage,onCategoryChange,researchPanel,onWatchlistAdd,onWatchlistRemove,onPlansChange,onRebalance}){
    const root=React.useRef(null),controller=React.useRef(null),[view,setView]=React.useState('opportunities');
    React.useEffect(()=>{controller.current=mountInvestmentPanel(root.current,{overview:overviewRoot?.current,state,research,storage,onCategoryChange,onViewChange:setView,onWatchlistAdd,onWatchlistRemove,onPlansChange,onRebalance});return()=>controller.current?.destroy();},[uid]);
    React.useEffect(()=>controller.current?.update(state,research,onCategoryChange,onWatchlistAdd,onWatchlistRemove),[state,research,onCategoryChange,onWatchlistAdd,onWatchlistRemove]);
    return jsx.jsxs('section',{id:'investment-command-centre',className:'ic-cc-shell','aria-label':'Investment Command Centre',children:[jsx.jsx('div',{ref:root,className:'pf-panel investment-panel'})]});
  };
}
export function mountInvestmentPanel(root,{overview,state:initial,research:initialResearch,storage,onCategoryChange,onViewChange=()=>{},onWatchlistAdd,onWatchlistRemove,onPlansChange,onRebalance}){
  let state=initial,research=initialResearch,config={plans:{},funding:{},decisions:{}},loaded=false,alive=true,busy=false,error='',notice='',watchStop=null,pendingCloud=null,cloudSnapshot='',draftDirty=false,filter='opportunities',expandedDecision='',categoryFilter='all',categorySort='none',actionFilter=['buy','hold','sell'],categoryChange=onCategoryChange,selectedSymbol='',draftEdits={},addWatchlist=onWatchlistAdd,removeWatchlist=onWatchlistRemove;
  let chartDialog=null;
  let marketContext=null,alertStatus=null,marketError='',marketBusy=false,renderedOn='';
  function renderOverview(model){
    if(!overview)return;
    const detailsOpen=overview.querySelector('details')?.open;
    const restoreFocus=overview.ownerDocument.activeElement?.matches('[data-refresh-market]');
    overview.innerHTML=renderCommandOverview(model,{show,categoryFilter,marketContext,privacyMode:state.privacyMode,
      marketState:{error:marketError,busy:marketBusy,refreshable:true,workerCheckedAt:alertStatus?.checkedAt,marketAvailable:alertStatus?.marketAvailable}});
    const details=overview.querySelector('details');
    if(details&&detailsOpen)details.open=true;
    const refresh=overview.querySelector('[data-refresh-market]');
    refresh.onclick=()=>void refreshMarket();
    if(restoreFocus)refresh.focus({preventScroll:true});
    overview.querySelectorAll('[data-command-filter]').forEach(button=>button.onclick=()=>{
      if(draftDirty){root.querySelector('[data-plan]')?.scrollIntoView();return;}
      filter=button.dataset.commandFilter;
      onViewChange(filter);
      render();
      const tab=root.querySelector(`.ic-tabs [data-command-filter="${filter}"]`);
      tab?.focus({preventScroll:true});
      root.scrollIntoView({block:'start'});
    });
  }
  function updateOverview(){
    if(overview)renderOverview(buildCommandCentre(state,research,config,{today:today()}));
  }
  async function refreshMarket(){
    if(!alive||marketBusy||globalThis.document?.visibilityState==='hidden')return;
    const previousAlert=JSON.stringify(alertStatus);
    marketBusy=true;
    updateOverview();
    const [market,alerts]=await Promise.allSettled([storage.loadMarketContext?.(),storage.loadAlertStatus?.()]);
    if(!alive)return;
    marketBusy=false;
    if(market.status==='fulfilled')marketContext=market.value||null;
    marketError=market.status==='rejected'?'Could not read the saved SPX check. Reload to retry.':'';
    alertStatus=alerts.status==='fulfilled'?alerts.value||null:{mode:'Status unavailable'};
    if(!draftDirty&&(!overview||renderedOn!==today()||previousAlert!==JSON.stringify(alertStatus)))render();
    else updateOverview();
  }
  const marketTimer=setInterval(()=>void refreshMarket(),5*60000);
  globalThis.window?.addEventListener('focus',refreshMarket);
  const onChartClick=e=>{
    const button=e.target.closest?.('[data-price-chart]');
    if(button)chartDialog=openPriceChart(button,symbol=>storage.loadChart(symbol));
  };
  root.addEventListener('click',onChartClick);
  const stableJSON=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const show=n=>state.privacyMode?'S$•••':n==null?'—':'S$'+new Intl.NumberFormat('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const field=(name,label,value='',attrs='')=>`<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
  const mergeCloud=cloud=>{
    if(!alive)return;
    storage.acceptCloud?.(cloud);
    pendingCloud=null;draftDirty=false;
    const saved=cloud.strategy||{};
    cloudSnapshot=stableJSON(saved);
    config={plans:{},funding:{},decisions:{},...saved};
    loaded=true;error='';
    onPlansChange?.(config.plans);
    notice='CC changes updated automatically from cloud.';
    render();
  };
  const cloudWarning=()=>{
    if(!pendingCloud||!alive||state.privacyMode)return;
    let warning=root.querySelector('[data-cc-cloud-conflict]');
    if(!warning){
      warning=root.ownerDocument.createElement('div');
      warning.className='ic-cloud-conflict';
      warning.setAttribute('data-cc-cloud-conflict','');
      warning.setAttribute('role','alert');
      warning.innerHTML='<strong>Newer CC decisions are available in the cloud.</strong> Your unsaved edits are preserved. <button type="button" data-cc-accept-cloud>Discard draft and load cloud changes</button>';
      root.querySelector('.ic-title')?.after(warning);
    }
    warning.querySelector('[data-cc-accept-cloud]').onclick=()=>{
      if(!globalThis.confirm||globalThis.confirm('Discard unsaved CC form edits and load the newest saved decisions?'))mergeCloud(pendingCloud);
    };
  };
  const onDraftInput=event=>{
    if(event.target?.closest?.('[data-plan],[data-decision-form],[data-settle-order],[data-fill],[data-correct-fill],[data-cash-use],[data-alert-settings]'))draftDirty=true;
  };
  root.addEventListener('input',onDraftInput);
  root.addEventListener('change',onDraftInput);
  function handleCloud(cloud){
    if(!alive||busy)return;
    const signature=stableJSON(cloud.strategy||{});
    if(signature===cloudSnapshot){storage.acceptCloud?.(cloud);return;}
    if(draftDirty){pendingCloud=cloud;cloudWarning();return;}
    mergeCloud(cloud);
  }
  async function reload(){
    if(busy)return;
    try{
      const saved=await storage.load();
      if(!alive)return;
      cloudSnapshot=stableJSON(saved);
      pendingCloud=null;draftDirty=false;
      config={plans:{},funding:{},decisions:{},...saved};
      loaded=true;error='';onPlansChange?.(config.plans);render();
      watchStop?.();
      watchStop=storage.watch?.(handleCloud,cloudError=>{if(alive)console.warn('CC cloud synchronization interrupted:',cloudError.message);});
    }catch(e){if(alive){loaded=false;error='Could not load saved plans: '+e.message;render();}}
  }
  async function save(next){
    if(!loaded||busy)throw Error('Wait for strategy data to finish loading or saving.');
    if(pendingCloud)throw Error('A newer CC plan was saved elsewhere. Your draft is preserved; review the cloud-change warning before saving.');
    busy=true;
    try{await storage.save(next);if(alive){config=next;cloudSnapshot=stableJSON(next);draftDirty=false;onPlansChange?.(config.plans);notice='Saved to cloud. Preview only; no order or notification sent.';}}catch(e){if(alive&&/unconfirmed|another tab|another action|changed in/i.test(e.message||'')){try{pendingCloud=await storage.readLatest?.();}catch{}cloudWarning();}throw e;}finally{busy=false;}
  }
  async function clearRebalancing(symbol){if(state.rebalancingSymbols?.[symbol]&&onRebalance){await onRebalance(symbol,false);state={...state,rebalancingSymbols:{...state.rebalancingSymbols,[symbol]:false}};}}
  function renderCashAllowance(model){
    const rows=model.allowance.entries;
    if(!rows.length)return '<p class="ic-meta">CC cash tracking only affects planning. Imported StocksCafe holdings, balances and performance history remain unchanged.</p>';
    const pending=rows.filter(e=>cashUseCanBeIncluded(e,state));
    return `<details data-section="cash-use" ${model.allowance.needsReconciliation?'open':''}><summary>CC cash used since import · ${show(model.allowance.spent)}</summary><p>These planning deductions do not post ledger transactions or change imported holdings/balances. Keep them until a new StocksCafe cash import reflects the spending.</p>${pending.length||model.allowance.needsReconciliation?`<form data-cash-reconcile><p>Reconcile against your latest StocksCafe cash import. Select only spending already included in that balance; unselected records carry forward.</p>${pending.map(e=>`<label><input type="checkbox" name="included" value="${esc(e.id)}"> ${esc(e.date)} · ${esc(e.symbol)} · ${show(e.amount)} is included in StocksCafe</label>`).join('')}<label><input type="checkbox" name="confirmed" required> I checked these against the imported StocksCafe cash balance.</label><button>Reconcile CC cash use</button></form>`:''}<div class="ic-support-table-wrap"><table><thead><tr><th>Date</th><th>Company</th><th>Cash used (SGD)</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(e.date)}</td><td>${esc(e.symbol)}</td><td>${show(e.amount)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function render(){
    if(!alive)return;
    renderedOn=today();
    const model=buildCommandCentre(state,research,config,{today:renderedOn});
    renderOverview(model);
    if(state.privacyMode){
      root.innerHTML='<h2>Investment Command Centre</h2>'+renderPublicCommandCentre(model,{categoryFilter,categorySort});
      root.querySelector('[data-opportunity-category]').onchange=e=>{categoryFilter=e.target.value;render();};
      root.querySelector('[data-opportunity-sort]').onchange=e=>{categorySort=e.target.value;render();};
      return;
    }
    const {displayFunding:funding,fundingError}=model;
    const open=new Set([...root.querySelectorAll('details[open]')].map(x=>x.dataset.section));
    const oldDialog=root.querySelector('[data-watchlist-dialog]');
    const popup=oldDialog?.hasAttribute('open')?{ticker:oldDialog.querySelector('[name="ticker"]').value,category:oldDialog.querySelector('[name="category"]').value,focus:root.ownerDocument.activeElement?.name}:null;
    const symbols=[...new Set([...(state.holdings||[]).filter(h=>h.accountType==='Cash'&&!h.exited).map(h=>h.ticker),...(state.watchlist||[]).map(h=>h.symbol)])].filter(Boolean);
    selectedSymbol=preferredPlanSymbol(symbols,state,config.plans,selectedSymbol);
    root.innerHTML=`<div class="ic-title"><div><h2>Investment Command Centre</h2><p>Your next investment decisions, using current holdings and the watchlist.</p></div></div>
      <details data-section="strategy-rules" ${open.has('strategy-rules')?'open':''}><summary>Strategy rules</summary><p>Anchor: equal nibbles at every approved support. Core: 1.5% + 1.5% + up to 3% at the deepest three (6% ceiling). Selective: reassess 2–4% per eligible entry at the deepest two (4% company ceiling); buy less or skip when cash or alternatives warrant it. Anchor ceiling: 10%.</p></details>
      ${!loaded?'<p>Loading saved plans and decisions… <button type="button" data-retry-cloud>Retry</button></p>':''}${error?`<p class="pf-error" role="alert">${esc(error)}</p>`:''}${notice?`<p role="status">${esc(notice)}</p>`:''}
      ${fundingError?`<p class="pf-error">${esc(fundingError)} Known values remain visible below; purchase amounts require refreshed inputs.</p>`:''}${funding?`<details data-section="funding-breakdown" ${open.has('funding-breakdown')?'open':''}><summary>Portfolio and cash basis</summary><p>${funding.complete?'Strategy base':'Known portfolio subtotal (incomplete)'} <strong>${show(funding.base)}</strong> · holdings ${show(funding.invested)} + broker cash ${show(funding.broker)} + bank set aside ${show(funding.bank)} − liabilities ${show(funding.liabilities)}. CC cash used since import: ${show(model.allowance.spent)}. Pending order reservations: ${show(model.reserved)}. Available for other buys: <strong>${show(funding.available)}</strong>.</p></details>`:''}
      ${model.incompleteSales?'<p class="ic-meta">Some planned sales lack FX and are excluded from potential cash.</p>':''}
      ${renderCommandCentre(model,{show,today:today(),filter,categoryFilter,categorySort,actionFilter,expandedSymbol:expandedDecision,marketContext,includeOverview:!overview})}
      <details data-section="email-alerts" ${open.has('email-alerts')?'open':''}><summary>Email alerts · ${esc(config.alerts?.enabled===false?'Paused':alertStatus?.mode||'Setup pending')}</summary><p>Daily checks follow all current Cash holdings and Watchlist tickers, including tickers in My decisions and Opportunities. Approaching: within 5% above the nearest support. Each support price is notified once; new daily drops below 3% and 5% can each notify once. Every email includes SPX context, with recent ticker headlines on drop alerts.</p><p class="ic-meta">${alertStatus?.checkedAt?'Last worker check: '+esc(new Date(alertStatus.checkedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore'}))+' SGT. ':''}${alertStatus?.lastAcceptedAt?'Last email accepted by provider: '+esc(new Date(alertStatus.lastAcceptedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore'}))+' SGT. ':''}${esc(alertStatus?.lastError||'')}${alertStatus?.tickers!=null?' Quotes checked: '+esc(alertStatus.quoted)+'/'+esc(alertStatus.tickers)+'. '+esc(alertStatus.unavailable||0)+' input(s) need review.':''}</p>${alertStatus?.warnings?.length?'<ul class="ic-meta">'+alertStatus.warnings.map(w=>'<li>'+esc(w.symbol)+': '+esc(w.reason)+'</li>').join('')+'</ul>':''}<form data-alert-settings><label><input type="checkbox" name="enabled" ${config.alerts?.enabled===false?'':'checked'}> Enable personal email alerts once delivery is configured</label><button ${!loaded?'disabled':''}>Save alert preference</button></form><p class="ic-meta">Existing breached levels are baselined at startup. Pausing does not build an email backlog. SPX uses completed daily closes; ticker quotes may be delayed. One email groups all new alerts by ticker. Delivery is scheduled for 8 am Singapore time. If the early check runs late, the digest may arrive later.</p></details>
      ${renderCashAllowance(model)}
      <details data-section="funding" ${open.has('funding')||model.allowance.legacyReviewRequired?'open':''}><summary>Confirm strategy funding</summary>
        <form data-funding>${field('liabilities','Related liabilities (SGD)',config.funding.liabilities??0,'type="number" min="0" step="0.01" required')}${field('pending','Other unavailable cash: external orders or unrecorded spending (SGD)',config.funding.pending??0,'type="number" min="0" step="0.01" required')}
        <label><input type="checkbox" name="confirmed" ${config.funding.confirmed?'checked':''} required> I reviewed holdings and FX. All recorded broker cash and bank set-aside cash are committed to this strategy; liabilities and pending orders above are current.</label><button ${!loaded?'disabled':''}>Save funding confirmation</button></form>
        <p>Enter only amounts not already tracked in CC. New fill cash use stays deducted until you reconcile it against a StocksCafe import. Earlier history-only fills are not charged retrospectively. CPF/SRS are excluded. Pending orders reduce available cash, not the portfolio base. Refresh this confirmation when commitments change. Bank cash may need transferring before an order can be funded.</p></details>
      <details data-section="plan" ${open.has('plan')?'open':''}><summary>Create or review a company plan</summary>
        <form data-plan class="ic-compact-plan">
        <label>Company<select name="symbol">${symbols.map(s=>`<option value="${esc(s)}" ${s===selectedSymbol?'selected':''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Action<select name="action"><option value="buy">Buy</option><option value="sell">Sell</option><option value="hold">Hold</option></select></label>
        <div class="ic-revisit-field"><label for="ic-revisit-on">Revisit on</label><div class="ic-revisit-picker"><input id="ic-revisit-on" type="date" name="revisitOn"><button type="button" class="ic-secondary" data-revisit-months="1">1M</button><button type="button" class="ic-secondary" data-revisit-months="3">3M</button></div><label>Skip support level<select name="skipSupportKey"><option value="">None</option></select></label></div>
        <label>Support<select name="stage"></select></label>
        ${field('entry','Entry price','','type="text" inputmode="decimal" required')}
        ${field('quantity','Quantity (shares)','','type="text" inputmode="numeric" required')}
        <label class="ic-native-estimate">Estimated purchase<output data-native-estimate>—</output><small data-sgd-estimate></small></label>
        <label class="ic-plan-remarks-field">Decision / remarks<textarea name="remarks" maxlength="2000" rows="1" placeholder="Thesis, alternatives or reason to wait"></textarea></label>
        ${field('reviewedAt','Reviewed',today(),`type="date" max="${today()}" required`)}
        <div class="ic-plan-approval" title="I reviewed the business, IV, trading currency, support ladder and ceiling. Any material news has been resolved."><input id="ic-plan-approved" type="checkbox" name="approved" required><label for="ic-plan-approved">Plan reviewed</label></div>
        <button ${!loaded?'disabled':''}>Save plan</button>
        <details class="ic-plan-settings" data-section="plan-settings" ${open.has('plan-settings')?'open':''}><summary>Plan settings</summary><div class="ic-settings-body">
          <label class="ic-redistribute" data-rebase-control><input type="checkbox" name="redistribute"><strong>Redistribute remaining budget from selected support</strong></label>${field('rebaseBudget','Remaining budget to redistribute (SGD)','','type="text" inputmode="decimal"')}<p data-rebase-control>Explicit review only. Anchor: equal remaining shares; Core: retain 1:1:2 weights; Selective: independent 2–4% proposals within one total budget. Higher unfilled supports are skipped. Resolve pending orders first. Saving the plan approves this redistribution.</p>
          <label class="ic-sale-completed"><input type="checkbox" name="saleCompleted"> Sale completed · exclude potential proceeds</label>
          <div class="ic-plan-research">${field('budget','Total Anchor addition budget (SGD)','','type="text" inputmode="decimal"')}${field('ceiling','Company ceiling (%)','','type="number" min="0.01" max="100" step="0.01" required')}<label>Level source<select name="levelSource"><option value="ak">AK sheets · independent fallback</option><option value="independent">Independent reconstruction</option></select></label><label>IV method<select name="methodFamily">${[['auto','Auto method'],['stock','Company DCF'],['bank','Bank'],['reit','REIT'],['fund','Fund / ETF']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><button type="button" data-recalculate>Recalculate</button><p data-plan-research-status></p></div><div class="ic-plan-facts-host" data-plan-facts></div><div class="ic-research-overrides"><p>IV and supports: blank values follow AK sheets, then independent calculation. Enter a value to override it for this plan.</p>${['iv','s1','s2','s3','s4','s5','refCost'].map(key=>field('override-'+key,key==='iv'?'IV':key==='refCost'?'Ref cost':key.toUpperCase(),'','type="text" inputmode="decimal"')).join('')}</div>
          <div class="ic-plan-prefill" data-plan-prefill></div>
          <p class="ic-footnote">Saving a plan records your proposed entry, quantity and remarks. Cash is reserved only when you record a committed order. Dated reviews are in My decisions, with a per-ticker sync to the <a href="${NOTION_REVIEW_URL}" target="_blank" rel="noopener">Stocks Plan Review log</a>.</p>
        </div></details></form>
        <p class="ic-meta" data-plan-feedback></p>
        </details>
`;
    root.querySelectorAll('[data-command-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.commandFilter;onViewChange(filter);render();});
    root.querySelector('[data-retry-cloud]')?.addEventListener('click',()=>reload());
    root.querySelector('[data-alert-settings]')?.addEventListener('submit',async event=>{
      event.preventDefault();error='';
      const enabled=new FormData(event.currentTarget).get('enabled')==='on';
      try{await save({...config,alerts:{...config.alerts,enabled}});notice=enabled?'Alert preference enabled. The personal email worker must be configured before it sends.':'Email alerts paused. The worker will discard pending emails on its next check.';}catch(e){error=e.message;}render();
    });

    const selector=root.querySelector('[name="symbol"]');
    const get=name=>root.querySelector('[data-plan] [name="'+name+'"]');
    const overrides=()=>({...Object.fromEntries(['iv','s1','s2','s3','s4','s5','refCost'].map(key=>[key,get('override-'+key).value.trim()===''?'':String(amount(get('override-'+key).value)??get('override-'+key).value)])),levelSource:get('levelSource').value});
    const currentDraft=()=>{
      const saved=config.plans[selector.value],company=resolvedCompany(state,research,selector.value,{...saved,action:get('action').value,researchOverrides:overrides()});
      let draft=planDraft(company,saved,funding,{ceiling:get('ceiling').value,addBudget:amount(get('budget').value),selectivePercents:[4,4],lotSize:1});
      if(get('action').value==='buy'&&get('redistribute').checked&&get('stage').value&&amount(get('rebaseBudget').value)!==null)draft=redistributeBudget(draft,{startKey:get('stage').value,budget:amount(get('rebaseBudget').value),room:draft.room,base:draft.base,hasPending:Object.values(config.decisions||{}).some(d=>d.symbol===selector.value&&d.status==='ordered'),now:today()});
      return {company,saved,draft};
    };
    const executionNow=()=>{const {company,draft}=currentDraft();return entryDraft(draft,company,funding,{stageKey:get('stage').value,entryPrice:amount(get('entry').value),quantity:amount(get('quantity').value),increment:draft.lotSize,useStageAllowance:true});};
    const showDraftDetails=()=>{
      const {company,saved,draft}=currentDraft(),stageSelector=get('stage'),action=get('action').value;
      const buy=action==='buy',hold=action==='hold';
      root.querySelector('[data-plan-facts]').innerHTML=`<dl class="ic-plan-facts"><div><dt>Current holding · ${quantityText(company.shares)} shares</dt><dd>${show(draft.holding)}</dd></div><div><dt>Room below ceiling</dt><dd>${show(draft.room)}</dd></div><div><dt>Current price</dt><dd>${esc(money(company.quote?.close,company.currency))}</dd></div><div><dt>IV</dt><dd>${esc(money(company.iv,company.currency))}</dd></div></dl>`;
      const record=research?.records?.[company.symbol];root.querySelector('[data-plan-research-status]').textContent='IV: '+researchProcessingLabel(record,'iv')+' · '+researchComparisonLabel(record,'iv').text+' | SL: '+researchProcessingLabel(record,'supports')+' · '+researchComparisonLabel(record,'supports').text+' | Displayed IV: '+(company.sources.iv||'unavailable')+' | Displayed SL: '+supportSourceLabel(company)+'; numeric overrides take precedence. Ref cost: '+company.refCostLabel;
      root.querySelectorAll('[data-rebase-control]').forEach(el=>el.hidden=!buy);get('redistribute').closest('label').hidden=!buy;get('redistribute').disabled=!buy;get('rebaseBudget').closest('label').hidden=!buy||!get('redistribute').checked;get('rebaseBudget').disabled=!buy||!get('redistribute').checked;
      get('entry').closest('label').firstChild.textContent=action==='sell'?'Sale price':'Entry price';
      for(const key of ['stage','ceiling','budget']){get(key).disabled=!buy||(key==='budget'&&company.category!=='anchor');get(key).required=buy&&key!=='stage'&&(key!=='budget'||company.category==='anchor');get(key).closest('label').hidden=!buy||(key==='budget'&&company.category!=='anchor');}
      for(const key of ['entry','quantity']){get(key).required=!hold;get(key).disabled=hold;get(key).closest('label').hidden=hold;}
      const skipSupport=get('skipSupportKey');
      const selectedSkip=skipSupport.value;
      skipSupport.innerHTML='<option value="">None</option>'+company.levels.map(level=>`<option value="${esc(level.key)}">${esc(level.key.toUpperCase())} · ${esc(money(level.price,company.currency))}</option>`).join('');
      skipSupport.value=company.levels.some(level=>level.key===selectedSkip)?selectedSkip:'';
      skipSupport.disabled=!hold;
      get('revisitOn').closest('.ic-revisit-field').hidden=!hold;get('revisitOn').required=hold;get('revisitOn').disabled=!hold;
      get('saleCompleted').closest('label').hidden=action!=='sell';root.querySelector('.ic-native-estimate').hidden=hold;
      root.querySelector('[data-plan] > button').disabled=!loaded||(buy&&!company.category);
      if(!buy){
        if(!hold&&get('entry').value==='')get('entry').value=money(saved?.currency&&saved.currency!==company.currency?company.quote?.close:saved?.sale?.price??company.quote?.close,company.currency);
        if(!hold&&get('quantity').value==='')get('quantity').value=quantityText(saved?.sale?.quantity??Math.floor(company.shares));
        const units=amount(get('quantity').value),entry=amount(get('entry').value),spend=units!==null&&entry!==null?units*entry:null;
        root.querySelector('[data-native-estimate]').textContent=spend===null?'—':money(spend,company.currency);root.querySelector('[data-sgd-estimate]').textContent=spend!==null&&company.fx>0&&company.currency!=='SGD'?'Potential ≈ '+money(spend*company.fx,'SGD'):'';
        root.querySelector('.ic-native-estimate').firstChild.textContent='Estimated sale proceeds';
        const next=hold?nextHoldSupport(company.levels,skipSupport.value):null;
        const holdFeedback=next?`Returns to Opportunities when price approaches within 5% of ${next.key.toUpperCase()} (${money(next.price,company.currency)}), reaches it, or the revisit date arrives.`
          :skipSupport.value?'No lower support is available. Returns to Opportunities on the revisit date.'
          :'Choose a support to skip if you want this Hold to return to Opportunities.';
        root.querySelector('[data-plan-feedback]').textContent=hold?holdFeedback:'Planned proceeds are conditional; they do not increase cash available to commit.';
        root.querySelector('[data-plan-prefill]').innerHTML='';return {units,entry,spend,issues:[]};
      }
      root.querySelector('.ic-native-estimate').firstChild.textContent='Estimated purchase';
      const stageSignature=JSON.stringify([selector.value,company.levels]);
      if(stageSelector.dataset.symbol!==stageSignature){
        stageSelector.innerHTML=draft.stages.map(s=>`<option value="${esc(s.key)}">${esc(s.key.toUpperCase())} · ${esc(money(s.price,company.currency))}${s.completed?' · completed':''}</option>`).join('');stageSelector.dataset.symbol=stageSignature;
        stageSelector.value=(draft.stages.some(s=>s.key===saved?.plannedEntryKey)?saved.plannedEntryKey:entryDraft(draft,company,funding).stage?.key)||'';
      }
      if(get('entry').value==='')get('entry').value=company.quote?.close>0?money(company.quote.close,company.currency):'';
      const execution=executionNow();
      if(get('quantity').value==='')get('quantity').value=quantityText(execution.units);
      const sized=executionNow();
      root.querySelector('[data-native-estimate]').textContent=sized.spend==null?'—':money(sized.units*sized.entry,company.currency);
      root.querySelector('[data-sgd-estimate]').textContent=company.currency==='SGD'||sized.spend==null?'':'≈ '+money(sized.spend,'SGD');
      root.querySelector('[data-plan-feedback]').textContent=[...sized.issues,...(draft.missing.length?draft.missing:[])].join(' ');
      root.querySelector('[data-plan-prefill]').innerHTML=`<p class="ic-meta">${esc(draft.budgetSource)}. Remaining stage allowance and shared cash cap the quantity.</p>${renderPlanBreakdown(draft,company,funding,sized)}`;
      return sized;
    };
    const showLevels=()=>{
      try{
        selectedSymbol=selector.value;
        const saved=config.plans[selectedSymbol],company=resolvedCompany(state,research,selectedSymbol,saved),draft=planDraft(company,saved,funding);
        get('levelSource').value=saved?.researchOverrides?.levelSource||activeWatchlist(state.holdings,state.watchlist).find(w=>w.symbol===selectedSymbol)?.levelSource||'ak';const record=research?.records?.[selectedSymbol];get('methodFamily').value=record?.methodFamilySource==='user'?record.methodFamily:'auto';get('action').value=saved?planAction(saved):'buy';get('revisitOn').value=saved?.revisitOn||revisitDate(today());get('revisitOn').min=new Date(Date.parse(today()+'T00:00:00Z')+86400000).toISOString().slice(0,10);get('saleCompleted').checked=saved?.sale?.completed===true;
        for(const key of ['iv','s1','s2','s3','s4','s5','refCost']){const input=get('override-'+key);input.value=company.manualValues[key]??'';input.placeholder=key==='priceCurrency'?company.currency||'Auto':key==='refCost'?(company.refCost>0?money(company.refCost,company.currency):'AK reference unavailable'):money(key==='iv'?company.iv:company.levels.find(l=>l.key===key)?.price,company.currency);}
        get('ceiling').value=draft.ceiling??'';get('ceiling').max=({anchor:10,core:6,selective:4}[company.category]||100);
        get('budget').value=draft.addBudget==null?'':money(draft.addBudget,'SGD');get('budget').disabled=company.category!=='anchor';get('budget').required=company.category==='anchor';get('budget').readOnly=company.category==='anchor'&&saved?.category==='anchor'&&saved.stages.length>0;get('budget').closest('label').hidden=company.category!=='anchor';
        get('remarks').value=saved?.remarks||'';get('entry').value=saved&&planAction(saved)==='buy'&&saved.currency===company.currency&&saved.stages?.find(s=>s.key===saved.plannedEntryKey)?.entryPrice>0?money(saved.stages.find(s=>s.key===saved.plannedEntryKey).entryPrice,company.currency):'';get('quantity').value='';get('stage').dataset.symbol='';
        get('redistribute').checked=false;get('rebaseBudget').value=draft.room==null?'':money(draft.room,'SGD');get('approved').checked=false;get('skipSupportKey').value='';showDraftDetails();get('skipSupportKey').value=saved?.skipSupportKey||'';
        const edits=draftEdits[selectedSymbol];if(edits)for(const[key,value]of Object.entries(edits)){if(get(key)){if(get(key).type==='checkbox')get(key).checked=value;else get(key).value=value;}}
        root.querySelector('[data-plan] > button').disabled=!loaded||(get('action').value==='buy'&&!company.category);
        showDraftDetails();
      }catch(e){root.querySelector('[data-plan-feedback]').textContent=e.message;}
    };
    const rememberDraft=()=>{draftEdits[selectedSymbol]=Object.fromEntries([...root.querySelectorAll('[data-plan] input:not([readonly]),[data-plan] textarea,[data-plan] select[name="stage"],[data-plan] select[name="action"],[data-plan] select[name="levelSource"],[data-plan] select[name="skipSupportKey"]')].filter(input=>input.name).map(input=>[input.name,input.type==='checkbox'?input.checked:input.value]));};
    selector.onchange=showLevels;showLevels();
    get('levelSource').onchange=()=>{get('stage').dataset.symbol='';get('entry').value='';get('quantity').value='';showDraftDetails();rememberDraft();};
    const requestResearch=async()=>{try{if(!research?.request)throw Error('Research is not ready. Reload and retry.');await research.request({symbol:selector.value,securityId:selector.value,currency:currentDraft().company.currency},{force:true,methodFamily:get('methodFamily').value});notice='Research requested; previous values remain until results arrive.';}catch(e){error=e.message;}render();};get('methodFamily').onchange=requestResearch;root.querySelector('[data-recalculate]').onclick=requestResearch;
    root.querySelectorAll('[data-revisit-months]').forEach(button=>button.onclick=()=>{get('revisitOn').value=revisitDate(today(),Number(button.dataset.revisitMonths));rememberDraft();});
    get('action').onchange=()=>{get('entry').value='';get('quantity').value='';get('stage').dataset.symbol='';showDraftDetails();rememberDraft();};
    get('skipSupportKey').onchange=()=>{showDraftDetails();rememberDraft();};
    get('stage').onchange=()=>{get('entry').value='';get('quantity').value='';showDraftDetails();rememberDraft();};
    root.querySelectorAll('[data-plan] input,[data-plan] textarea').forEach(input=>{
      input.oninput=()=>{if(['entry','ceiling','budget','redistribute','rebaseBudget'].includes(input.name)||input.name.startsWith('override-'))get('quantity').value='';try{showDraftDetails();rememberDraft();}catch(e){root.querySelector('[data-plan-feedback]').textContent=e.message;}};
      input.onchange=()=>{showDraftDetails();rememberDraft();};
      input.onblur=()=>{const sized=get('action').value==='buy'?executionNow():{};if(input.name==='entry'&&amount(input.value)!==null)input.value=money(amount(input.value),currentDraft().company.currency);if(input.name==='budget'&&amount(input.value)!==null)input.value=money(amount(input.value),'SGD');if(input.name==='quantity'&&sized.requestedUnits!==null&&sized.requestedUnits<=sized.maximumUnits)input.value=quantityText(sized.units);showDraftDetails();rememberDraft();};
    });
    const action=fn=>async e=>{e.preventDefault();error='';notice='';try{if(!loaded||busy)throw Error('Wait for saved decisions to load or finish saving.');await fn(new FormData(e.target),e.target);}catch(err){error=err.message;}render();};
    const addDialog=root.querySelector('[data-watchlist-dialog]');
    if(addDialog){root.querySelector('[data-open-watchlist]').onclick=()=>{if(addDialog.showModal)addDialog.showModal();else addDialog.setAttribute('open','');addDialog.querySelector('[name="ticker"]').focus();};root.querySelector('[data-close-watchlist]').onclick=()=>{if(addDialog.close)addDialog.close();else addDialog.removeAttribute('open');root.querySelector('[data-open-watchlist]').focus();};}
    if(root.querySelector('[data-add-watchlist]'))root.querySelector('[data-add-watchlist]').onsubmit=action(async fd=>{
      if(!addWatchlist)throw Error('Reload the dashboard to add tickers.');
      const patch=planWatchlistAddition(state,{symbol:fd.get('ticker'),category:fd.get('category'),id:crypto.randomUUID()});
      busy=true;try{await addWatchlist(patch);state={...state,...patch};}finally{busy=false;}const dialog=root.querySelector('[data-watchlist-dialog]');if(dialog?.close)dialog.close();else dialog?.removeAttribute('open');notice='Ticker added. AK sheets are the default; independent results are used when AK values are unavailable.';
    });
    root.querySelectorAll('[data-remove-watchlist]').forEach(button=>button.onclick=async()=>{error='';if(!loaded||busy){error='Wait for the current save.';render();return;}try{if(!removeWatchlist)throw Error('Reload the dashboard to edit Watchlist.');busy=true;await removeWatchlist(button.dataset.removeWatchlist);state={...state,watchlist:state.watchlist.filter(w=>w.symbol!==button.dataset.removeWatchlist)};notice='Removed from Watchlist. Holdings and saved plans remain.';}catch(e){error=e.message;}finally{busy=false;}render();});
    root.querySelectorAll('[data-card-category]').forEach(select=>select.onchange=async()=>{error='';try{await categoryChange?.(select.dataset.cardCategory,select.value);}catch(e){error=e.message;}render();});
    root.querySelectorAll('[data-decision-column]').forEach(input=>input.onchange=async()=>{error='';try{await save({...config,decisionColumns:{...state.watchlistColumnVisibility,...config.decisionColumns,[input.dataset.decisionColumn]:input.checked}});}catch(e){error=e.message;}render();});
    root.querySelector('[data-funding]').onsubmit=action(async fd=>{
      const next={...config,cashTrackingVersion:1,funding:{liabilities:Number(fd.get('liabilities')),pending:Number(fd.get('pending')),confirmed:fd.get('confirmed')==='on',confirmedAt:new Date().toISOString(),basisSignature:fundingSignature(state)}};
      strategyFunding(state,next.funding);await save(next);
    });
    root.querySelector('[data-plan]').onsubmit=action(async fd=>{
      if(fd.get('action')==='buy'&&(!funding||!funding.complete))throw Error(fundingError||'Complete the missing holding valuations before approving a plan.');
      if(fd.get('approved')!=='on')throw Error('Review the company before saving.');
      const symbol=fd.get('symbol'),previous=config.plans[symbol],researchOverrides=overrides(),c=resolvedCompany(state,research,symbol,{...previous,action:fd.get('action'),researchOverrides});
      validateResearchOverrides(researchOverrides);
      if(Object.values(config.decisions||{}).some(d=>d.symbol===symbol&&d.status==='ordered')&&fd.get('action')!==(previous?planAction(previous):'buy'))throw Error('Resolve the pending order before changing this plan action.');
      if(fd.get('action')!=='buy'){
        const fresh=saveActionPlan(previous,{action:fd.get('action'),entry:amount(fd.get('entry')),quantity:amount(fd.get('quantity')),reviewedAt:fd.get('reviewedAt'),revisitOn:fd.get('revisitOn'),skipSupportKey:fd.get('skipSupportKey'),remarks:fd.get('remarks'),saleCompleted:fd.get('saleCompleted')==='on',researchOverrides},c,{today:today(),id:crypto.randomUUID()});
        await save(recordPlanReview(config,fresh,{id:crypto.randomUUID(),now:new Date().toISOString(),holding:funding?.byCompany?.[symbol]??null,base:funding?.base??null,shares:c.shares}));await clearRebalancing(symbol);delete draftEdits[symbol];return;
      }
      let fresh=createPurchasePlan({symbol,category:c.category,selectivePercents:[4,4],levels:c.levels,base:funding.base,ceilingPct:fd.get('ceiling'),addBudget:previous?.category==='anchor'&&previous.stages.length>0?previous.stages.reduce((n,s)=>n+s.budget,0):amount(fd.get('budget')),iv:c.iv,currency:c.currency,reviewedAt:fd.get('reviewedAt'),id:previous?.id||crypto.randomUUID()});
      if(fresh.reviewedAt>today())throw Error('A review cannot be dated in the future.');
      fresh=reviewPurchasePlan(previous,fresh);
      if(fd.get('redistribute')==='on'){const draft=planDraft(c,fresh,funding);fresh=redistributeBudget(fresh,{startKey:fd.get('stage'),budget:amount(fd.get('rebaseBudget')),room:draft.room,base:funding.base,hasPending:Object.values(config.decisions||{}).some(d=>d.symbol===symbol&&d.status==='ordered'),now:new Date().toISOString()});}
      fresh.action='buy';fresh.researchOverrides=researchOverrides;
      fresh.lotSize=1;fresh.oddLots=false;fresh.rounding='down';fresh.remarks=String(fd.get('remarks')||'').slice(0,2000);
      const approvedDraft=planDraft(c,fresh,funding,{lotSize:fresh.lotSize}),execution=entryDraft(approvedDraft,c,funding,{stageKey:fd.get('stage'),entryPrice:amount(fd.get('entry')),quantity:amount(fd.get('quantity')),increment:fresh.lotSize,useStageAllowance:true});
      if(amount(fd.get('entry'))===null||amount(fd.get('quantity'))===null)throw Error('Enter a valid entry price and whole-share quantity.');
      if(execution.issues.length)throw Error(execution.issues.join(' '));
      if(!execution.stage||execution.units===null)throw Error('Review the selected support and calculated purchase quantity.');
      fresh.plannedEntryKey=execution.stage.key;
      fresh.stages=fresh.stages.map(s=>s.key===execution.stage.key?{...s,entryPrice:execution.entry,purchaseQuantity:execution.units,purchaseBudget:s.spent+Math.min(execution.capacity,Math.ceil((execution.spend-1e-9)*100)/100)}:s);
      await save(recordPlanReview(config,fresh,{id:crypto.randomUUID(),now:new Date().toISOString(),holding:funding.byCompany[symbol]??0,base:funding.base,shares:c.shares}));await clearRebalancing(symbol);delete draftEdits[symbol];
    });
    const executionFor=(fd,form)=>{
      const currency=form.querySelector('[data-fill-preview]').dataset.currency;
      const fx=currency==='SGD'?1:state.fxRates?.[currency];
      if(!(fx>0))throw Error('Refresh prices to load the exchange rate for '+currency+'.');
      return pricedFill({quantity:fd.get('quantity'),price:fd.get('price'),currency,fx});
    };
    root.querySelectorAll('[data-fill-preview]').forEach(output=>{
      const form=output.closest('form');
      form.addEventListener('input',()=>{
        try{
          const fill=executionFor(new FormData(form),form),total=Number(output.dataset.spent)+fill.amount;
          output.textContent='This fill '+show(fill.amount)+' · Total '+show(total)+(output.dataset.budget?' of '+show(Number(output.dataset.budget)):'');
        }catch{output.textContent='';}
      });
    });
    root.querySelectorAll('[data-fill]').forEach(form=>{
      const syncRequired=()=>{
        const onlyComplete=form.elements.completeStage.checked&&!form.elements.quantity.value&&!form.elements.price.value;
        form.elements.quantity.required=form.elements.price.required=!onlyComplete;
        form.querySelector('button').textContent=onlyComplete?'Save stage':'Save fill';
      };
      form.oninput=syncRequired;
      syncRequired();
    });
    root.querySelectorAll('[data-fill]').forEach(form=>form.onsubmit=action(async(fd,form)=>{
      if(fd.get('date')>today())throw Error('A fill cannot be dated in the future.');
      const symbol=form.dataset.fill;
      if(Object.values(config.decisions||{}).some(d=>d.status==='ordered'&&d.symbol===symbol&&d.stageId===form.dataset.stage))throw Error('Record this fill through the pending order in My decisions so its reservation is reconciled.');
      const stage=config.plans[symbol].stages.find(s=>s.id===form.dataset.stage);
      const completed=fd.get('completeStage')==='on';
      const onlyComplete=completed&&!fd.get('quantity')&&!fd.get('price');
      if(onlyComplete&&!stage.spent)throw Error('Record a fill before completing this stage.');
      const fill=onlyComplete?{spent:stage.spent,completed,date:stage.fillDate||fd.get('date')}:{execution:executionFor(fd,form),completed,date:fd.get('date')};
      const next=recordStageCashFill(config,symbol,form.dataset.stage,fill,{id:crypto.randomUUID(),now:new Date().toISOString(),state});
      await save(next);
      notice=onlyComplete?'Stage completed. Previously recorded spend retained.':'Fill saved. CC cash available for other buys is reduced; StocksCafe holdings, cash balances and ledger are unchanged.';
    }));
    root.querySelectorAll('[data-correct-fill]').forEach(form=>form.onsubmit=async event=>{
      event.preventDefault();
      const feedback=form.querySelector('[data-correction-feedback]');
      try{
        const fd=new FormData(form);
        await save(correctStageCashFill(config,form.dataset.correctFill,form.dataset.stage,Number(form.dataset.index),{
          quantity:fd.get('quantity'),price:fd.get('price'),date:fd.get('date'),today:today(),now:new Date().toISOString(),
        }));
      }catch(err){feedback.textContent=err.message;return;}
      error='';notice='Fill correction saved.';render();
    });
    if(root.querySelector('[data-cash-reconcile]'))root.querySelector('[data-cash-reconcile]').onsubmit=action(async(fd,form)=>{
      const includedIds=[...form.querySelectorAll('[name="included"]')].filter(input=>input.checked).map(input=>input.value);
      await save(reconcileCashUse(config,state,{includedIds,confirmed:fd.get('confirmed')==='on',now:new Date().toISOString()}));
      notice='CC spending reconciled against the imported balance. Included spending is no longer deducted; unselected entries remain deducted.';
    });
    root.querySelectorAll('[data-company-details]').forEach(button=>button.onclick=()=>{expandedDecision=expandedDecision===button.dataset.companyDetails?'':button.dataset.companyDetails;render();if(expandedDecision)root.querySelector('.ic-decision-table-wrap').scrollLeft=0;});
    root.querySelectorAll('[data-close-company-details]').forEach(button=>button.onclick=()=>{expandedDecision='';render();root.querySelector('[data-company-details="'+button.dataset.closeCompanyDetails+'"]')?.focus();});
    root.querySelectorAll('[data-sync-company]').forEach(button=>button.onclick=async()=>{
      const row=model.rows.find(r=>r.symbol===button.dataset.syncCompany);
      try{
        const sale=row.action==='sell',buy=row.action==='buy';
        const request={id:crypto.randomUUID(),status:'queued',queuedAt:new Date().toISOString(),action:row.action,
          stage:buy?row.entryStage?.key??'':'',quantity:sale?row.plan.sale?.quantity??null:buy?row.nextUnits:null,
          price:sale?row.plan.sale?.price??null:buy?row.nextEntry:null,currency:row.currency||'',
          reviewed:row.plan.reviewedAt||null,record:companyDecisionText(row,model.history)};
        await save({...config,notionExports:{...config.notionExports,[row.symbol]:request}});
        notice=row.symbol+' queued for the personal Notion worker.';
      }catch(e){error=e.message;}
      render();
    });
    root.querySelectorAll('[data-plan-action-filter]').forEach(input=>input.onchange=()=>{actionFilter=[...root.querySelectorAll('[data-plan-action-filter]')].filter(el=>el.checked).map(el=>el.dataset.planActionFilter);render();});
    if(root.querySelector('[data-opportunity-category]'))root.querySelector('[data-opportunity-category]').onchange=e=>{categoryFilter=e.target.value;render();};
    if(root.querySelector('[data-opportunity-sort]'))root.querySelector('[data-opportunity-sort]').onchange=e=>{categorySort=e.target.value;render();};
    root.querySelectorAll('[data-review-plan]').forEach(button=>button.onclick=()=>{
      const details=root.querySelector('[data-section="plan"]');details.open=true;selector.value=button.dataset.reviewPlan;selectedSymbol=button.dataset.reviewPlan;showLevels();
      if(button.dataset.reviewStage){
        const stage=get('stage');if([...stage.options].some(option=>option.value===button.dataset.reviewStage)){stage.value=button.dataset.reviewStage;stage.onchange();}
        details.querySelector('[data-section="plan-settings"]').open=true;
      }
      details.scrollIntoView?.({behavior:'smooth',block:'start'});
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
      const execution=executionFor(fd,form);
      await save(settleOrder(config,form.dataset.settleOrder,{kind:'filled',spent:execution.amount,execution,date:fd.get('date'),now:new Date().toISOString(),today:today(),cashBasis:cashImportBasis(state),cashId:crypto.randomUUID()}));
      notice='Final fill recorded. The reservation is replaced by cash actually used. CC can size other buys; StocksCafe remains the master record.';
    }));
    if(popup&&addDialog){addDialog.querySelector('[name="ticker"]').value=popup.ticker;addDialog.querySelector('[name="category"]').value=popup.category;if(addDialog.showModal)addDialog.showModal();else addDialog.setAttribute('open','');if(error){const message=root.ownerDocument.createElement('p');message.setAttribute('role','alert');message.className='pf-error';message.textContent=error;addDialog.querySelector('form').prepend(message);}addDialog.querySelector(popup.focus==='category'?'[name="category"]':'[name="ticker"]').focus();}
    if(!loaded)root.querySelectorAll('button:not([data-retry-cloud])').forEach(button=>button.disabled=true);
    cloudWarning();
  }
  render();
  reload();
  void refreshMarket();
  return {update(next,nextResearch,nextCategoryChange=categoryChange,nextAdd=addWatchlist,nextRemove=removeWatchlist){addWatchlist=nextAdd;removeWatchlist=nextRemove;state=next;research=nextResearch;categoryChange=nextCategoryChange;if(!draftDirty||state.privacyMode)render();},destroy(){clearInterval(marketTimer);globalThis.window?.removeEventListener('focus',refreshMarket);if(overview)overview.innerHTML='';chartDialog?.close();root.removeEventListener("click",onChartClick);alive=false;watchStop?.();root.removeEventListener('input',onDraftInput);root.removeEventListener('change',onDraftInput);root.innerHTML='';}};
}
