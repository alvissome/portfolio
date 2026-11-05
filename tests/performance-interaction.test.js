import test from 'node:test';
import assert from 'node:assert/strict';
import {chart,bindChart,mount} from '../assets/performance-panel.js';
import {performanceRange} from '../assets/performance-view.js';

test('confirmed period intersects account coverage instead of using newer unchecked snapshots',()=>{
  const history={snapshots:{'2015-12-31':{},'2026-11-05':{}},coverage:{cash:{broker:{start:'2025-12-31',end:'2026-11-03'}},srs:{total:{start:'2025-12-31',end:'2026-09-30'}},cpf:{broker:{start:'2026-01-01',end:'2026-10-31'}}}};
  const options={basis:'broker',period:'reconciled',today:'2026-11-05'};
  assert.deepEqual(performanceRange(history,{...options,scope:'cash'}),['2025-12-31','2026-11-03']);
  assert.deepEqual(performanceRange(history,{...options,scope:'combined'}),['2026-01-01','2026-09-30']);
  assert.deepEqual(performanceRange(history,{...options,scope:'cash',period:'All'}),['2015-12-31','2026-11-05']);
  assert.deepEqual(performanceRange(history,{...options,scope:'cash',period:'custom',customStart:'2025-12-31',customEnd:'2026-06-30'}),['2025-12-31','2026-06-30']);
  assert.deepEqual(performanceRange({...history,coverage:{}},{...options,scope:'combined'}),['2015-12-31','2026-11-05']);
});

test('chart has readable, accessible dates and values without leaking hidden money',()=>{
  const points=[{date:'2025-12-31',value:1234.56,capital:1000,returnPct:12.34}];
  const markup=chart(points,'value',false);
  assert.match(markup,/data-chart-readout/);assert.match(markup,/2025-12-31 · Portfolio value: \$1,234\.56/);assert.match(markup,/tabindex="0" role="button"/);assert.match(markup,/r="12"/);
  const hidden=chart(points,'value',true);assert.doesNotMatch(hidden,/1,234|1234\.56|1,000/);assert.match(hidden,/2025-12-31 · Portfolio value: Hidden/);
  assert.match(chart(points,'returnPct',false),/Return: 12\.34%/);
});

test('chart hover and click show the nearest point, keyboard navigation shows focused points',()=>{
  const readout={textContent:''};
  const points=[80,480,880].map((x,i)=>({dataset:{label:'date '+i+' · value '+i},getAttribute:()=>String(x),classList:{toggle(){}},focus(){this.onfocus();}}));
  const svg={getBoundingClientRect:()=>({left:100,width:450})};
  const figure={querySelector:s=>s==='svg'?svg:readout,querySelectorAll:()=>points};
  bindChart({querySelector:()=>figure});
  svg.onpointermove({clientX:340,pointerType:'mouse'});assert.equal(readout.textContent,points[1].dataset.label);
  svg.onclick({clientX:540});assert.equal(readout.textContent,points[2].dataset.label);
  svg.onclick({clientX:0,target:{closest:()=>points[1]}});assert.equal(readout.textContent,points[1].dataset.label);
  points[2].onkeydown({key:'ArrowLeft',preventDefault(){}});assert.equal(readout.textContent,points[1].dataset.label);
  points[1].onkeydown({key:'Home',preventDefault(){}});assert.equal(readout.textContent,points[0].dataset.label);
  svg.onpointermove({clientX:540,pointerType:'touch'});assert.equal(readout.textContent,points[0].dataset.label);
});

test('date edits survive partial years and background state updates until Apply dates',async()=>{
  const previousDocument=globalThis.document;
  const filters=['scope','basis','metric','period'].map(k=>({dataset:{filter:k},value:k==='period'?'reconciled':''}));
  let html='',renders=0,form=null;
  const root={replaceChildren(){html="";},set innerHTML(value){html=value;renders++;if(value.includes('data-custom-dates'))form={elements:{start:{value:'2025-12-31'},end:{value:'2026-09-30',setCustomValidity(){}}},contains:e=>e===form.elements.start||e===form.elements.end,reportValidity:()=>true};},get innerHTML(){return html;},querySelectorAll:s=>s==='[data-filter]'?filters:[],querySelector:s=>s==='[data-custom-dates]'&&html.includes('data-custom-dates')?form:null};
  const state={holdings:[],cash:{growth:0,dividend:0,brokers:0,srs:0,cpfIs:0},privacyMode:false};
  globalThis.document={activeElement:null};
  try{
    const c=mount(root,'sample',state,{load:async()=>({snapshots:{},flows:{},trades:{},coverage:{},settings:{}})});
    await Promise.resolve();filters[3].value='custom';filters[3].onchange();
    assert.doesNotMatch(html,/option value="total"|Holdings \+ broker \+ bank/);
    const editing=form,renderCount=renders;globalThis.document.activeElement=editing.elements.start;
    for(const year of ['0002','0020','0202','2025']){editing.elements.start.value=year+'-12-31';c.update({...state});assert.equal(renders,renderCount);assert.equal(form,editing);}
    editing.onsubmit({preventDefault(){}});assert.equal(renders,renderCount+1);assert.match(html,/name="start"[^>]*value="2025-12-31"/);
    c.destroy();
  }finally{globalThis.document=previousDocument;}
});
