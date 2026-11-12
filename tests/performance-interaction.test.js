import test from 'node:test';
import assert from 'node:assert/strict';
import {chart,bindChart,mount} from '../assets/performance-panel.js';
import {performanceRange} from '../assets/performance-view.js';
import {calculate,makeFlow,todaySG} from '../assets/performance-core.js';

test('confirmed period intersects account coverage instead of using newer unchecked snapshots',()=>{
  const history={snapshots:{'2015-12-31':{},'2026-11-05':{}},coverage:{cash:{broker:{start:'2025-12-31',end:'2026-11-03'}},srs:{total:{start:'2025-12-31',end:'2026-09-30'}},cpf:{broker:{start:'2026-01-01',end:'2026-10-31'}}}};
  const options={basis:'broker',period:'reconciled',today:'2026-11-05'};
  assert.deepEqual(performanceRange(history,{...options,scope:'cash'}),['2025-12-31','2026-11-03']);
  assert.deepEqual(performanceRange(history,{...options,scope:'combined'}),['2026-01-01','2026-09-30']);
  assert.deepEqual(performanceRange(history,{...options,scope:'cash',period:'All'}),['2015-12-31','2026-11-05']);
  assert.deepEqual(performanceRange(history,{...options,scope:'cash',period:'custom',customStart:'2025-12-31',customEnd:'2026-06-30'}),['2025-12-31','2026-06-30']);
  assert.deepEqual(performanceRange({...history,coverage:{}},{...options,scope:'combined'}),['2015-12-31','2026-11-05']);
});

test('Investment YTD includes year-end and calculates beyond confirmed cash coverage when opted in',()=>{
  const snapshot=value=>({accounts:{cash:{invested:value,cash:0,brokerCash:0,verified:true}}});
  const withdrawal=makeFlow({id:'gsh',date:'2026-01-26',account:'cash',kind:'withdrawal',amount:10});
  const history={snapshots:{'2025-12-31':snapshot(100),'2026-01-26':snapshot(90),'2026-11-05':snapshot(99)},flows:{withdrawal},coverage:{cash:{broker:{start:'2023-10-31',end:'2026-11-04'}}}};
  const [start,end]=performanceRange(history,{scope:'cash',basis:'broker',period:'YTD',today:'2026-11-05'});
  assert.deepEqual([start,end],['2025-12-31','2026-11-05']);
  assert.equal(calculate(history,'cash','broker',start,end).returnPct,null);
  const allow={allowUnconfirmedTail:true};
  const result=calculate(history,'cash','broker',start,end,allow);
  assert.equal(result.provisionalThrough,'2026-11-04');
  assert.equal(result.netFlow,-10);
  assert.equal(result.gain,9);
  assert.ok(Math.abs(result.returnPct-10)<1e-10);
  assert.equal(calculate(history,'cash','invested',start,end,allow).returnPct,null);
  history.coverage.cash.broker.end='2026-11-05';
  history.snapshots['2026-11-06']=snapshot(100);
  const afterReconciliation=calculate(history,'cash','broker',start,'2026-11-06',allow);
  assert.equal(afterReconciliation.provisionalThrough,'2026-11-05');
  assert.equal(afterReconciliation.netFlow,-10);
  history.coverage.cash.broker.start='2026-01-01';
  assert.equal(calculate(history,'cash','broker',start,'2026-11-06',allow).returnPct,null);
});

test('YTD uses Friday when year-end falls on a weekend without a snapshot or intervening movement',()=>{
  const options={scope:'cash',basis:'broker',period:'YTD',today:'2024-01-15'};
  const history={snapshots:{'2023-12-29':{accounts:{cash:{invested:100,cash:0,brokerCash:0,verified:true}}}}};
  assert.deepEqual(performanceRange(history,options),['2023-12-29','2024-01-15']);
  history.flows={contribution:makeFlow({id:'c',date:'2023-12-31',account:'cash',kind:'contribution',amount:10})};
  assert.deepEqual(performanceRange(history,options),['2023-12-31','2024-01-15']);
  assert.deepEqual(performanceRange({},options),['2023-12-31','2024-01-15']);
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
    await Promise.resolve();
    assert.doesNotMatch(html,/Historical trade evidence/);
    c.update({...state,accountImportVersion:1});
    assert.doesNotMatch(html,/Historical trade evidence/);
    assert.match(html,/Recorded dashboard cash movements/);
    filters[3].value='custom';filters[3].onchange();
    assert.doesNotMatch(html,/option value="total"|Holdings \+ broker \+ bank/);
    const editing=form,renderCount=renders;globalThis.document.activeElement=editing.elements.start;
    for(const year of ['0002','0020','0202','2025']){editing.elements.start.value=year+'-12-31';c.update({...state});assert.equal(renders,renderCount);assert.equal(form,editing);}
    editing.onsubmit({preventDefault(){}});assert.equal(renders,renderCount+1);assert.match(html,/name="start"[^>]*value="2025-12-31"/);
    c.destroy();
  }finally{globalThis.document=previousDocument;}
});

test('preset returns use the overlap with confirmed coverage and label the actual dates',async()=>{
  const today=todaySG(),date=offset=>new Date(Date.parse(today)-offset*864e5).toISOString().slice(0,10);
  const [older,start,mid,end]=[340,300,120,30].map(date);
  const snapshot=invested=>({accounts:{cash:{invested,verified:true}}});
  const history={
    snapshots:{[older]:snapshot(80),[start]:snapshot(100),[mid]:snapshot(110),[end]:snapshot(121),[today]:snapshot(150)},
    flows:{},coverage:{cash:{invested:{start,end}}},settings:{}
  };
  const filters=['scope','basis','metric','period'].map(filter=>({dataset:{filter},value:''}));
  const root={innerHTML:'',replaceChildren(){},querySelector(){return null;},querySelectorAll:s=>s==='[data-filter]'?filters:[]};
  const state={holdings:[],cash:{},privacyMode:false,accountImportVersion:1};
  const mounted=mount(root,'sample',state,{load:async()=>history});
  await Promise.resolve();
  filters[1].value='invested';filters[1].onchange();
  filters[3].value='6M';filters[3].onchange();
  assert.ok(root.innerHTML.includes('Partial 6M. Valuations used: '+mid+' to '+end));
  assert.match(root.innerHTML,/>10\.00%<\/strong>/);
  filters[3].value='1Y';filters[3].onchange();
  assert.ok(root.innerHTML.includes('Partial 1Y. Valuations used: '+start+' to '+end));
  assert.match(root.innerHTML,/TWR \(cumulative\)<\/span><strong>21\.00%<\/strong>/);
  filters[3].value='All';filters[3].onchange();
  assert.match(root.innerHTML,/TWR \(cumulative\)<\/span><strong>—<\/strong>/);
  assert.doesNotMatch(root.innerHTML,/TWR \(annualized\)/);
  mounted.destroy();
});


test('All shows estimated annualized TWR in the summary and cumulative TWR in the chart',async()=>{
  const start='2022-01-01',end='2024-01-01';
  const snapshot=invested=>({accounts:{cash:{invested,cash:0,brokerCash:0,verified:true}}});
  const contribution=makeFlow({id:'c',date:'2023-01-01',account:'cash',kind:'contribution',amount:20});
  const history={
    snapshots:{[start]:snapshot(100),[end]:snapshot(143.1)},flows:{contribution},
    coverage:{cash:{broker:{start,end}}},settings:{}
  };
  const filters=['metric','period'].map(filter=>({dataset:{filter},value:''}));
  const root={innerHTML:'',replaceChildren(){},querySelector(){return null;},querySelectorAll:s=>s==='[data-filter]'?filters:[]};
  const state={holdings:[],cash:{},privacyMode:false,accountImportVersion:1};
  const mounted=mount(root,'sample',state,{load:async()=>history});
  await Promise.resolve();
  filters[0].value='twrPct';filters[0].onchange();
  filters[1].value='All';filters[1].onchange();
  assert.match(root.innerHTML,/title="Estimated TWR \(linked Modified Dietz\)">TWR \(annualized\)<\/span><strong>10\.01%<\/strong>/);
  assert.match(root.innerHTML,/Estimated TWR\. A cash-flow date/);
  assert.match(root.innerHTML,/TWR \(cumulative\): 21\.00%/);
  mounted.destroy();
});

test('performance summary shows five metrics in a single row',async()=>{
  const {readFileSync}=await import('node:fs');
  const {fileURLToPath}=await import('node:url');
  const {resolve,dirname}=await import('node:path');
  const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const panel=readFileSync(resolve(dir,'assets/performance-panel.js'),'utf8');
  const css=readFileSync(resolve(dir,'assets/performance.css'),'utf8');
  const bundle=readFileSync(resolve(dir,'assets/index-CUEh86Kk.js'),'utf8');
  assert.match(panel,/pf-stats-five/);
  assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(panel,/performance-core\.js\?v=twr-basis-20261106/);
  assert.match(bundle,/performance-panel\.js\?v=twr-basis-20261106/);
  assert.match(bundle,/dashboard-backup\.js\?v=research-backup-20261112/);
});
