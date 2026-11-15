import {entryDraft} from './investment-plan-defaults.js?v=redistribution-20261115';
import {money,quantityText} from './investment-format.js?v=compact-price-20261114';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderPlanBreakdown(draft,company,funding,selected){
 if(!draft.stages.length)return '';
 const count=draft.stages.length,equal=draft.stages.every(s=>s.budget===draft.stages[0].budget);
 const explanation=draft.redistribution?`Redistributed remaining budget ${money(draft.redistribution.budget,'SGD')} from ${draft.redistribution.startKey.toUpperCase()}. ${draft.category==='core'?'Core retains the relative 1:1:2 weights.':draft.category==='selective'?'Selective allowances are independent alternatives within one shared remaining budget.':'Anchor divides equally across remaining supports.'}`:draft.category==='anchor'
  ?equal?`Total addition budget ${money(draft.addBudget,'SGD')} split equally across ${count} support${count===1?'':'s'}: ${money(draft.stages[0].budget,'SGD')} per support.`:'Saved addition allowances by support are shown below.'
  :draft.category==='core'?'Core uses the deepest three supports: 1.5% + 1.5% + up to 3%, within the 6% company ceiling.'
  :'Selective uses the deepest two supports. Reassess 2–4% per entry, within the 4% company ceiling; the 4% ceiling applies across both supports, so the allowances do not add to an 8% commitment.';
 const rows=draft.stages.map(stage=>{
  const chosen=stage.key===selected?.stage?.key;
  const sized=entryDraft(draft,company,funding,{stageKey:stage.key,entryPrice:chosen?selected.entry:undefined,increment:draft.lotSize,useStageAllowance:true});
  const remaining=draft.stages.filter(s=>!s.completed&&!s.skipped&&s.budget>s.spent),weight=remaining.reduce((n,s)=>n+(s.portfolioPct??0),0);
  const rule=draft.redistribution?(stage.skipped?'Skipped':stage.completed?'Completed':draft.category==='anchor'?`1/${remaining.length} of remaining budget`:draft.category==='core'?`Weight ${(stage.portfolioPct??0)/1.5} of ${weight/1.5}`:'2–4% independent · shared cap'):draft.category==='anchor'?`1/${count} of addition budget`:draft.category==='core'?`${stage.portfolioPct}%`:'2–4% dynamic';
  const capped=sized.entry>0&&sized.entry<stage.price;
  const reason=capped?(Math.abs(sized.entry-company.iv)<.00001?'Entry capped by reviewed IV':'Saved / chosen entry below support'):'';
  return `<article class="ic-support-box" data-support-allocation="${esc(stage.key)}" ${chosen?'data-selected="true" aria-current="true"':''}><h5>${esc(stage.key.toUpperCase())}${chosen?' <small>Selected</small>':''}${stage.completed?' <small>Completed</small>':''}${stage.skipped?' <small>Skipped</small>':''}</h5><dl><div><dt>Support price</dt><dd>${esc(money(stage.price,company.currency))}</dd></div><div><dt>Planned entry (limit)</dt><dd>${esc(money(sized.entry,company.currency))}</dd></div><div><dt>Rule allocation</dt><dd>${esc(rule)}</dd></div><div><dt>Stage allowance</dt><dd>${esc(money(stage.budget,'SGD'))}</dd></div><div><dt>Available now</dt><dd>${esc(money(sized.capacity,'SGD'))}</dd></div><div><dt>Max. shares</dt><dd>${sized.maximumUnits==null?'—':quantityText(sized.maximumUnits)}</dd></div></dl>${reason?`<p class="ic-entry-cap">${esc(reason)}</p>`:''}</article>`;
 }).join('');
 let selectedExplanation='';
 if(selected?.stage){
  const label=esc(selected.stage.key.toUpperCase());
  if(selected.stage.completed)selectedExplanation=`${label} is completed; no further purchase is allocated to this stage.`;
  else if(selected.capacity!=null&&selected.entry>0&&selected.fx>0&&selected.maximumUnits!=null){
   const cost=selected.entry*selected.fx,raw=selected.capacity/cost,rounded=Number(raw.toFixed(2));
   const rawText=rounded>raw&&Math.floor(rounded/selected.increment)*selected.increment>selected.maximumUnits?'just under '+quantityText(rounded):raw.toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2});
   selectedExplanation=`${label}: ${money(selected.capacity,'SGD')} available ÷ approximately ${money(cost,'SGD')} per share = ${rawText} shares → up to ${quantityText(selected.maximumUnits)} after rounding to ${selected.increment===1?'whole shares':`increments of ${quantityText(selected.increment)} shares`}.`;
   if(selected.requestedUnits!=null&&selected.units!==selected.maximumUnits)selectedExplanation+=` Your selected quantity: ${quantityText(selected.units)}.`;
  }else selectedExplanation=`${label}: current portfolio values, FX and the order increment are needed to calculate shares.`;
 }
 return `<section class="ic-support-breakdown" aria-label="Allocation by support"><h4>Allocation by support</h4><p>${esc(explanation)}</p><div class="ic-support-table-wrap"><div class="ic-support-boxes" style="--support-count:${count}">${rows}</div></div>${selectedExplanation?`<p class="ic-support-calculation">${esc(selectedExplanation)}</p>`:''}<p class="ic-meta">Available now subtracts recorded stage spend and is capped by company room and shared cash. Each row is an independent preview, not a cash reservation.${draft.stages.some(s=>s.frozen)?' Saved stage allowances remain fixed unless explicitly redistributed.':''}</p></section>`;
}
