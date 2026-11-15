import {AK_SOURCES} from './ak-sheet-sources.js?v=ak-cost-headers-20261115';
import {savedViewerLinks} from './ak-viewer.js';

export function createAkSheetControls(React) {
  const h = React.createElement;
  const active = AK_SOURCES.filter(source => source.key !== 'closed_positions');
  const fields = [['iv','IV'],['cost','AK average cost'], ...[1,2,3,4,5].map(n => ['s'+n,'S'+n])];
  function TickerEditor({research, symbol, source}) {
    const reference = research.records[symbol]?.reference;
    const entry = reference?.entries?.find(row => row.source === source);
    const ivKey = entry?.methodFamily === 'bank' ? 'adjustedPbIV' : entry?.methodFamily === 'reit' ? 'historicalPbIV' : 'baseIV';
    const [version,setVersion] = React.useState(reference?.snapshotId ?? '');
    const [values,setValues] = React.useState(() => ({
      currency:entry?.currency ?? reference?.currency ?? research.records[symbol]?.instrument?.currency ?? '',
      asOf:entry?.asOf ?? '', iv:entry?.variants?.find(v => v.key === ivKey)?.value ?? '', cost:entry?.averageCost ?? '',
      ...Object.fromEntries((entry?.supports ?? []).map((v,i) => ['s'+(i+1),v]))
    }));
    const [busy,setBusy] = React.useState(false), [message,setMessage] = React.useState('');
    const input = (key,label,type) => h('label',{key,style:{display:'inline-grid',margin:'4px'}},label,
      h('input',{type,value:values[key] ?? '',disabled:busy,step:type==='number'?'any':undefined,
        onChange:e => setValues({...values,[key]:e.target.value}),style:{width:type==='date'?'10em':'7em'}}));
    const save = async () => {
      setBusy(true);setMessage('');
      try {
        const result = await research.saveManualReference(symbol,source,values,version);
        setVersion(result.id);setMessage('Saved AK reference for '+symbol+'.');
      } catch (error) {setMessage(error.message);}
      finally {setBusy(false);}
    };
    return h('div',null,input('asOf','Sheet date','date'),input('currency','Currency','text'),
      ...fields.map(([key,label]) => input(key,label,'number')),
      h('button',{type:'button',className:'research-track',onClick:save,disabled:busy || !research.hydrated},'Save ticker values'),
      h('small',{role:'status'},message));
  }
  return function AkSheetControls({research,renderLayout}) {
    const [draft,setDraft] = React.useState(null),[message,setMessage] = React.useState(''),[busy,setBusy] = React.useState(false);
    const [symbol,setSymbol] = React.useState(''),[source,setSource] = React.useState('capital_gains');
    const links = savedViewerLinks(research), urls = draft ?? links;
    const save = async () => {
      setBusy(true);setMessage('');
      try {await research.saveSheetSources(urls);setDraft(null);setMessage('Viewer links saved.');}
      catch (error) {setMessage(error.message);}
      finally {setBusy(false);}
    };
    const open = (key,label) => h('a',{href:links[key] || AK_SOURCES.find(s=>s.key===key).portal,target:'_blank',rel:'noopener noreferrer'},label);
    const settings = h('div',null,h('details',null,h('summary',null,'AK sheet links'),
      ...AK_SOURCES.map(s=>h('div',{key:s.key},h('label',null,s.label,
        h('input',{type:'url',value:urls[s.key] || '',disabled:busy,'aria-label':s.label+' sheet URL',
          onChange:e=>setDraft({...urls,[s.key]:e.target.value}),style:{display:'block',width:'100%'}})),open(s.key,'Open sheet'))),
      h('button',{type:'button',className:'research-track',onClick:save,disabled:busy || !draft || !research.hydrated},'Save sheet links')),
      h('details',null,h('summary',null,'Update tracked ticker'),h('label',null,'AK list ',
        h('select',{value:source,onChange:e=>setSource(e.target.value)},...active.map(s=>h('option',{key:s.key,value:s.key},s.label)))),
      ' ',open(source,'Open sheet'),' ',h('label',null,'Ticker ',h('select',{value:symbol,onChange:e=>setSymbol(e.target.value)},
        h('option',{value:''},'Choose ticker'),...[...(research.trackedSymbols ?? [])].sort().map(s=>h('option',{key:s,value:s},s)))),
      symbol && h(TickerEditor,{key:symbol+'/'+source,research,symbol,source})));
    const messages = h('small',{role:'status'},message);
    return renderLayout ? renderLayout({settings,messages}) : h('div',null,settings,messages);
  };
}
