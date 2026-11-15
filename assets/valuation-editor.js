import {VALUATION_METHODS,VALUATION_NUMBERS,VALUATION_RATES,normalizeValuationSettings} from './valuation-settings.js';

export function createValuationEditor(React) {
  const h=React.createElement;
  function draftFrom(record) {
    const values={...(record?.valuation||{})};
    for(const [key] of VALUATION_RATES)if(values[key]!==undefined)values[key]=String(Number((values[key]*100).toPrecision(12)));
    values.growthEstimates=(values.growthEstimates||[]).map(rate=>Number((rate*100).toPrecision(12))).join(', ');
    return values;
  }
  return function ValuationEditor({record,row,research}) {
    const [draft,setDraft]=React.useState(()=>draftFrom(record));
    const [error,setError]=React.useState('');
    const [busy,setBusy]=React.useState(false);
    React.useEffect(()=>{setDraft(draftFrom(record));},[JSON.stringify(record?.valuation||{})]);
    const update=(key,value)=>setDraft(previous=>({...previous,[key]:value}));
    const save=async reset=>{
      setError('');setBusy(true);
      try {
        const config={};
        if(!reset){
          for(const [key,value] of Object.entries(draft)){
            if(value===''||value===undefined)continue;
            if([...VALUATION_NUMBERS,...VALUATION_RATES].some(([id])=>id===key))
              config[key]=Number(value)/(VALUATION_RATES.some(([id])=>id===key)?100:1);
            else if(['capexYears','flowYears'].includes(key))config[key]=Number(value);
            else if(key==='growthEstimates'){
              if(value.split(',').some(v=>!v.trim()))throw Error('Remove empty entries from the forecast list.');
              config[key]=value.split(',').map(v=>Number(v.trim())/100);
            }
            else config[key]=value;
          }
        }
        await research.request(row,{force:true,valuation:normalizeValuationSettings(config)});
        if(reset)setDraft({});
      } catch(problem){setError(problem.message||'Valuation settings could not be saved.');}
      finally{setBusy(false);}
    };
    const select=(key,label,options)=>h('label',null,label,h('select',{'aria-label':label+' for '+row.symbol,
      value:draft[key]??options[0][0],onChange:e=>update(key,e.target.value)},
      ...options.map(([value,text])=>h('option',{key:value,value},text))));
    const field=(key,label,type='number')=>h('label',{key},label,h('input',{type,
      'aria-label':label+' for '+row.symbol,step:type==='number'?'any':undefined,
      value:draft[key]??'',onChange:e=>update(key,e.target.value)}));
    return h('details',{className:'research-details valuation-editor'},h('summary',null,'IV inputs'),
      h('p',null,'Blank fields use provider data or the disclosed automatic assumptions. Rates use percentages. Financial amounts and shares use full units, not millions.'),
      h('div',{className:'valuation-fields'},
        select('method','Valuation method',VALUATION_METHODS),
        select('capexYears','CapEx normalization',[['','Automatic CapEx policy'],['0','Current CapEx'],['3','3-year average'],['5','5-year average']]),
        select('flowYears','Starting flow normalization',[['0','Current / TTM'],['3','3-year average'],['5','5-year average']]),
        select('growthSelection','Forecast selection',[['historical','Historical proxy unless forecasts supplied'],['average','Average supplied forecasts'],['lowest','Lowest supplied forecast'],['highest','Highest supplied forecast']]),
        field('growthEstimates','Forward growth estimates (%, comma-separated)','text'),
        ...VALUATION_RATES.map(([key,label])=>field(key,label)),
        ...VALUATION_NUMBERS.map(([key,label])=>field(key,label)),
        field('source','Input source / scenario rationale','text'),field('inputsAsOf','Input date','date')),
      h('p',null,'Forward growth must describe revenue for sales-growth valuation and earnings/cash flow for discounted valuation. Shares must match the listing (including any ADR ratio). NAV/book per unit uses financial currency. Dividend per unit uses listing currency.'),
      h('button',{type:'button',className:'research-track',disabled:busy||!research?.request,onClick:()=>save(false)},busy?'Saving…':'Save inputs & recalculate'),
      h('button',{type:'button',className:'research-track',disabled:busy||!research?.request,onClick:()=>save(true)},'Reset to automatic'),
      error?h('p',{role:'alert',className:'research-error'},error):null);
  };
}
