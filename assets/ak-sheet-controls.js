import {AK_SOURCES,previousAkRows,akSourceDefaults} from './ak-sheet-sources.js';

export function createAkSheetControls(React){
  const h=React.createElement;
  return function AkSheetControls({research,onSynced}){
    const [urls,setUrls]=React.useState(()=>({...akSourceDefaults(research.referenceMeta),...research.sheetSources}));
    const [dirty,setDirty]=React.useState(false),[message,setMessage]=React.useState(''),[error,setError]=React.useState('');
    const [saving,setSaving]=React.useState(false);
    React.useEffect(()=>{if(!dirty)setUrls({...akSourceDefaults(research.referenceMeta),...research.sheetSources});},[research.sheetSources,research.referenceMeta,dirty]);
    const busy=research.sheetSyncBusy||saving;
    const run=async sync=>{setError('');setMessage('');setSaving(true);try{
      if(sync){const status=await research.syncAkSheets(urls);setMessage(`${status.readable}/4 lists read. Saved values remain for any unavailable list.`);onSynced?.();}
      else{await research.saveSheetSources(urls);setMessage('Sheet links saved.');}
      setDirty(false);
    }catch(e){setError(e?.message||'Sheet sync failed. Previous values remain.');}finally{setSaving(false);}};
    const old=previousAkRows(research.records);
    return h('div',{className:'ak-sheet-controls'},
      h('div',{className:'research-controls'},
        h('button',{type:'button',className:'research-track',disabled:busy||!research.hydrated||!Object.values(urls).some(Boolean),onClick:()=>run(true)},busy?'Syncing AK sheets…':'Sync AK sheets'),
        h('small',null,'Refreshes the AK view. Active watchlist levels and alerts are kept.')),
      h('details',{className:'research-details'},h('summary',null,'AK sheet settings'),
        h('p',null,'Use the embedded Google Sheets links. Replace a link here when AK changes a sheet. Subscription passwords are not stored.'),
        ...AK_SOURCES.map(source=>{
          const status=research.sheetSyncStatus?.sources?.[source.key];
          const date=status?.asOf??old.filter(r=>r.source===source.key).map(r=>r.asOf).sort().at(-1);
          const age=date?Math.floor((Date.now()-Date.parse(date))/86400000):null;
          const state={updated:'Updated',unchanged:'Same sheet date / values',unavailable:'Access or link needs attention',not_configured:'Link not configured'}[status?.status]??'Not checked';
          return h('div',{key:source.key,style:{margin:'9px 0'}},h('label',{style:{display:'block'}},`${source.label} sheet URL`,
            h('input',{'aria-label':`${source.label} sheet URL`,type:'url',value:urls[source.key]??'',disabled:busy,placeholder:'https://docs.google.com/spreadsheets/…',
              onChange:e=>{setDirty(true);setUrls(x=>({...x,[source.key]:e.target.value}));},style:{display:'block',width:'100%',maxWidth:'650px',fontSize:'11px',padding:'5px'}})),
            h('small',null,`Sheet date: ${date??'not known'} · ${state}${age>45?' · Older than 45 days — check for a replacement sheet':''}`),
            status?.message?h('small',{style:{display:'block'}},status.message):null,
            h('a',{href:source.portal,target:'_blank',rel:'noopener noreferrer',style:{fontSize:'11px',marginLeft:'8px'}},'Open UIP page'));
        }),
        h('button',{type:'button',className:'research-track',disabled:busy||!research.hydrated,onClick:()=>run(false)},'Save sheet links')),
      research.sheetSyncStatus?.checkedAt?h('small',null,`Last sheet check: ${new Date(research.sheetSyncStatus.checkedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore',timeZoneName:'short'})}`):null,
      message?h('p',{role:'status',style:{fontSize:'11px'}},message):null,
      error?h('p',{role:'alert',className:'research-error'},error):null);
  };
}
