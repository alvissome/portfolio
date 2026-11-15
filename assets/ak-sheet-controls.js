import {AK_SOURCES} from './ak-sheet-sources.js?v=ak-cost-headers-20261115';
import {savedViewerLinks} from './ak-viewer.js';

export function createAkSheetControls(React) {
  const h = React.createElement;
  const inputClass='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
  const labelClass='block text-xs font-medium text-gray-500';
  const buttonClass='bg-[#1a3a5c] text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50';
  const sectionClass='border-t border-gray-100 pt-3';
  const summaryClass='cursor-pointer text-sm font-medium text-gray-700';
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
    const input = (key,label,type) => h('label',{key,className:labelClass},label,
      h('input',{type,value:values[key] ?? '',disabled:busy,step:type==='number'?'any':undefined,
        onChange:e => setValues({...values,[key]:e.target.value}),className:inputClass}));
    const save = async () => {
      setBusy(true);setMessage('');
      try {
        const result = await research.saveManualReference(symbol,source,values,version);
        setVersion(result.id);setMessage('Saved AK reference for '+symbol+'.');
      } catch (error) {setMessage(error.message);}
      finally {setBusy(false);}
    };
    return h('div',{className:'space-y-3 mt-3'},h('div',{className:'grid grid-cols-2 gap-3'},input('asOf','Sheet date','date'),input('currency','Currency','text'),
      ...fields.map(([key,label]) => input(key,label,'number'))),
      h('button',{type:'button',className:buttonClass,onClick:save,disabled:busy || !research.hydrated},'Save ticker values'),
      message && h('p',{className:'text-xs text-gray-600',role:'status'},message));
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
    const open = (key,label) => h('a',{className:'text-xs font-medium text-blue-700',href:links[key] || AK_SOURCES.find(s=>s.key===key).portal,target:'_blank',rel:'noopener noreferrer'},label);
    const status = research.sheetSyncStatus;
    const latestDate = key => {
      const dates = Object.values(research.records ?? {}).flatMap(record =>
        (record.reference?.entries ?? []).filter(e=>e.source===key).map(e=>e.asOf));
      return [status?.sources?.[key]?.asOf,...dates].filter(Boolean).sort().at(-1);
    };
    const settings = h('div',{className:'space-y-3'},
      h('div',{className:'flex items-center justify-between gap-3'},
        h('button',{type:'button',className:buttonClass,disabled:busy||research.sheetSyncBusy||!research.hydrated||!!draft,
          onClick:async()=>{setMessage('');try {
            const result=await research.syncAkSheets();
            setMessage(result.matched+' of '+result.tracked+' tracked tickers found in '+result.readable+' readable lists.');
          } catch(e){setMessage(e.message);}}},research.sheetSyncBusy?'Syncing…':'Sync AK sheets'),
        status?.checkedAt && h('span',{className:'text-xs text-gray-500'},'Last checked '+new Date(status.checkedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore'}))),
      h('div',{className:'space-y-2'},...AK_SOURCES.map(list=>{
        const checked=status?.sources?.[list.key],date=latestDate(list.key);
        const state={updated:'Updated',unchanged:'Checked · No changes',unavailable:'Refresh failed',not_configured:'Link missing'}[checked?.status] ?? (links[list.key]?'Ready to sync':'Link missing');
        return h('div',{key:list.key,className:'flex items-center justify-between gap-3'},
          h('div',null,h('div',{className:'text-sm text-gray-800'},list.label),
            h('p',{className:'text-xs text-gray-500',title:checked?.message ?? ''},state+(date?(checked?.status==='unavailable'?' · Last saved date ':checked?.dateBasis==='sale'?' · Latest imported sale ':' · Sheet dated ')+date:'')),
            checked?.status==='unavailable' && h('p',{className:'text-xs text-gray-500'},checked.message),
            checked?.skippedRows>0 && h('p',{className:'text-xs text-gray-500'},checked.skippedRows+' rows omitted: check listing, currency or sale date.')),
          open(list.key,'Open sheet'));
      })),
      h('details',{className:sectionClass},h('summary',{className:summaryClass},'Edit sheet links'),
        h('div',{className:'space-y-3 mt-3'},...AK_SOURCES.map(list=>h('label',{key:list.key,className:labelClass},list.label,
          h('input',{className:inputClass,type:'url',value:urls[list.key] || '',disabled:busy,'aria-label':list.label+' sheet URL',
            onChange:e=>setDraft({...urls,[list.key]:e.target.value})}))),
          h('button',{type:'button',className:buttonClass,onClick:save,disabled:busy||!draft||!research.hydrated},'Save sheet links'))),
      h('details',{className:sectionClass},h('summary',{className:summaryClass},'Manual reference entry'),
        h('div',{className:'grid grid-cols-2 gap-3 mt-3'},
          h('label',{className:labelClass},'AK list',h('select',{className:inputClass,value:source,onChange:e=>setSource(e.target.value)},
            ...active.map(list=>h('option',{key:list.key,value:list.key},list.label)))),
          h('label',{className:labelClass},'Ticker',h('select',{className:inputClass,value:symbol,onChange:e=>setSymbol(e.target.value)},
            h('option',{value:''},'Choose ticker'),...[...(research.trackedSymbols ?? [])].sort().map(t=>h('option',{key:t,value:t},t))))),
        symbol && h(TickerEditor,{key:symbol+'/'+source,research,symbol,source})));
    const messages = message && h('p',{className:'text-xs text-gray-600',role:'status'},message);
    return renderLayout ? renderLayout({settings,messages}) : h('div',null,settings,messages);
  };
}
