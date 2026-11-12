import {prioritizeUniverse, planTrackInWatchlist} from './research-core.js';

const numeric = value => typeof value === 'number' && Number.isFinite(value);
const price = value => numeric(value) ? value.toLocaleString('en-SG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}) : '—';
const date = value => typeof value === 'string' ? value.slice(0, 10) : '';
const output = (record, part) => record?.[part]?.result ?? record?.[part]?.previousResult;
const partValue = (record, part) => output(record, part)?.value;
const ready = (record, part) => record?.[part]?.processing === 'completed';

export function researchProcessingLabel(record, part) {
  const state = record?.[part]?.processing;
  if (!record?.requestId) return 'Not started';
  if (state === 'not_started' && !record.workerAcknowledged) return 'Requested';
  if (['queued', 'processing'].includes(state) && !record.workerAcknowledged) return 'Requested';
  return ({not_started:'Requested', queued:'Queued', processing:'Processing',
    completed:'Completed', unavailable:'Data unavailable', unsupported:'Not applicable',
    blocked:'Request blocked', failed:'Failed'}[state] ?? 'Not started');
}

export function researchComparisonLabel(record, part) {
  if (record?.[part]?.validation === 'not_applicable') return {text:'Not applicable', tone:'neutral'};
  const reference = record?.reference;
  if (reference?.present === false) return {text:'No benchmark', tone:'neutral'};
  if (reference?.present !== true) return {text:'Reference not loaded', tone:'neutral'};
  const published = part === 'iv' ? numeric(reference.iv?.value) || reference.iv?.variants?.some(item => numeric(item.value))
    : Array.isArray(reference.supports) && reference.supports.length > 0;
  if (!published) return {text:`No published ${part === 'iv' ? 'IV' : 'SL'}`, tone:'neutral'};
  if (!ready(record, part)) return {text:'Awaiting calculation', tone:'pending'};
  const comparison = record.comparison?.[part];
  if (reference.conflict) return {text:'Conflicting references',tone:'pending'};
  if (reference.snapshotId && (comparison?.snapshotId !== reference.snapshotId || comparison?.referenceAsOf !== reference.asOf)) {
    return {text:'Awaiting comparison',tone:'pending'};
  }
  const status = comparison?.status;
  return ({matched:{text:'Matches',tone:'match'}, different:{text:'Different',tone:'different'},
    no_benchmark:{text:'No benchmark',tone:'neutral'}, no_reference_value:{text:`No published ${part === 'iv' ? 'IV' : 'SL'}`,tone:'neutral'},
    reference_unknown:{text:'Reference not loaded',tone:'neutral'},
    awaiting_comparable_vintage:{text:'Different data dates',tone:'pending'},
    method_mismatch:{text:'Different IV methods',tone:'pending'}, currency_mismatch:{text:'Different currencies',tone:'pending'},
    not_applicable:{text:'Not applicable',tone:'neutral'}, pending:{text:'Awaiting comparison',tone:'pending'}}[status]
    ?? {text:'Awaiting comparison',tone:'pending'});
}

/** The same records and calculation statuses serve both table views. Generated
 * values never become active/manual alert levels through rendering or imports.
 */
export function createResearchComponents(React) {
  const h = React.createElement;

  function ResearchViewSwitch({research, onChange, defaultLabel = 'Positions', label = 'Table view'}) {
    return h('div', {className: 'research-view-switch', role: 'group', 'aria-label': label},
      h('button', {type: 'button', 'aria-pressed': !research,
        onClick: () => onChange(false)}, defaultLabel),
      h('button', {type: 'button', 'aria-pressed': research,
        onClick: () => onChange(true)}, 'Research'));
  }

  function ResearchBadge({record, onOpen}) {
    const statuses = ['iv', 'supports'].map(part => ready(record, part)
      ? researchComparisonLabel(record, part) : {text:researchProcessingLabel(record, part),tone:'pending'});
    return h('button', {type:'button', className:'research-row-badge', onClick:onOpen,
      title:'Open independent IV / support research'},
      ...statuses.map((item, index) => h('span', {key:index, className:`research-comparison research-${item.tone}`},
        index ? 'SL: ' : 'IV: ', item.text)));
  }

  function PartStatus({record, part}) {
    const result = output(record, part);
    const label = researchComparisonLabel(record, part);
    const comparison = record?.comparison?.[part];
    const reference = record?.reference;
    const currentComparison = ready(record, part) && comparison?.status !== 'pending' && reference &&
      (comparison?.snapshotId ?? null) === (reference.snapshotId ?? null) &&
      (comparison?.referenceAsOf ?? null) === (reference.asOf ?? null);
    const detail = [record?.[part]?.reason, currentComparison ? comparison?.reason : null].filter(Boolean).join(' ');
    const error = currentComparison && numeric(comparison?.errorPct) ? `Difference ${comparison.errorPct.toFixed(1)}%.` : '';
    const supportMatches = currentComparison && numeric(comparison?.matchedCount) ? `${comparison.matchedCount}/${comparison.referenceCount} supports matched; ${comparison.missingCount ?? 0} missing, ${comparison.extraCount ?? 0} extra.` : '';
    return h('div', {className:'research-part-status'},
      h('span', {className:'research-status'}, researchProcessingLabel(record, part)),
      h('span', {className:`research-comparison research-${label.tone}`, title:[detail,error,supportMatches].filter(Boolean).join(' ')}, label.text),
      result?.asOf ? h('small', null, `${ready(record,part) ? 'As of' : 'Previous result'} ${date(result.asOf)}`) : null,
      detail ? h('small', {className:'research-reason'}, detail) : null);
  }

  function ResearchDetails({record}) {
    const ref = record?.reference;
    const parts = ['iv', 'supports'].map(part => ({part, result:output(record,part)})).filter(item => item.result);
    if (!ref && !parts.length) return null;
    return h('details', {className:'research-details'}, h('summary', null, 'Methods / reference'),
      ...parts.map(({part,result}) => h('div', {key:part},
        h('strong', null, part === 'iv' ? 'Independent IV' : 'Independent supports'),
        h('p', null, [result.method, date(result.asOf), result.source].filter(Boolean).join(' · ')),
        result.assumptions ? h('pre', null, typeof result.assumptions === 'string' ? result.assumptions : JSON.stringify(result.assumptions, null, 2)) : null,
        Array.isArray(result.variants) ? h('ul', null, ...result.variants.map((variant,index) => h('li', {key:index},
          `${variant.method ?? variant.label ?? variant.key}: ${price(variant.value)}`))) : null)),
      ref?.present === true ? h('div', null, h('strong', null, `Reference: ${ref.label ?? ref.source ?? 'reference'} · ${date(ref.asOf)}`),
        h('p', null, `Currency ${ref.currency ?? 'not supplied'}. ${ref.conflict ? 'Conflicting source entries — review needed.' : ''}`),
        ref.iv?.selectedKey ? h('p', null, `Headline IV method: ${ref.iv.method ?? ref.iv.selectedKey}. Alternative methods remain separate.`) : null,
        h('ul', null, ...(ref.iv?.variants ?? []).map((variant,index) => h('li', {key:index}, `${variant.label ?? variant.method}: ${price(variant.value)}`))),
        h('p', null, `Supports: ${(ref.supports ?? []).map(price).join(' / ') || 'not supplied'}`),
        ref.entries?.length > 1 ? h('p', null, `${ref.entries.length} source entries retained.`) : null)
        : h('p', null, ref?.present === false ? 'No exact benchmark in the imported snapshot. Independent calculation still runs.' : 'Import a dated reference snapshot to compare this security.'),
      h('p', {className:'research-footnote'}, 'Experimental reconstruction. Matching a reference is separate from method validation; current and historical data dates may differ.'));
  }

  function ResearchPanel({holdings = [], watchlist = [], scope = 'holdings',
    onTrack, getHoldingMetrics, privacyMode = false, research}) {
    const pending = React.useRef(new Map());
    const [tracked, setTracked] = React.useState(() => new Set());
    const [error, setError] = React.useState('');
    const [importBusy, setImportBusy] = React.useState(false);
    const [importMessage, setImportMessage] = React.useState('');
    const [pastedReference, setPastedReference] = React.useState('');
    const importPending = React.useRef(false);
    const records = research?.records ?? {};
    const allRows = scope === 'watchlist' ? prioritizeUniverse([], watchlist)
      : prioritizeUniverse(holdings, watchlist).filter(row => row.held);

    React.useEffect(() => {
      const acknowledged = [...pending.current].filter(([, row]) =>
        planTrackInWatchlist(watchlist, row).kind === 'existing').map(([key]) => key);
      if (!acknowledged.length) return;
      for (const key of acknowledged) pending.current.delete(key);
      setTracked(previous => new Set([...previous].filter(key => !acknowledged.includes(key))));
    }, [watchlist]);

    const track = row => {
      const held = holdings.find(item => !item.exited && item.ticker === row.symbol);
      const plan = planTrackInWatchlist(watchlist, {...row,
        name: held?.name || records[row.symbol]?.instrument?.name || row.symbol});
      if (plan.kind === 'existing' || pending.current.has(row.securityId) || typeof onTrack !== 'function') return;
      pending.current.set(row.securityId, row);
      try {onTrack(plan.item); setTracked(previous => new Set([...previous, row.securityId])); setError('');}
      catch {pending.current.delete(row.securityId); setError('Could not add this symbol to the watchlist. Please try again.');}
    };
    const request = async (row, methodFamily) => {
      try {await research?.request?.(row, {force:true, ...(methodFamily ? {methodFamily} : {})}); setError('');}
      catch {setError('Could not request research. Please try again.');}
    };
    const importReference = async (text, clearPaste = false) => {
      if (importPending.current) return;
      importPending.current = true;
      setImportBusy(true); setImportMessage('');
      try {
        if (new TextEncoder().encode(text).byteLength > 3 * 1024 * 1024) throw new Error('Reference snapshot is too large.');
        const metadata = await research.importSnapshot(text);
        setImportMessage(`Reference imported: ${metadata.dates.join(', ')}. Calculations requested for comparison.`);
        if (clearPaste) setPastedReference('');
        setError('');
      } catch (problem) {setError(problem?.message || 'Reference import failed.');}
      finally {importPending.current = false; setImportBusy(false);}
    };
    const importFile = async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > 3 * 1024 * 1024) throw new Error('Reference file is too large.');
        await importReference(await file.text());
      } catch (problem) {setError(problem?.message || 'Reference import failed.');}
      finally {event.target.value = '';}
    };
    const headings = ['Symbol / Name', 'Avg Price', 'BValue (SGD)', 'Close', 'Independent IV', 'IV status',
      'SL1', 'SL2', 'SL3', 'SL4', 'SL5', 'SL status', 'Research'];
    if (scope === 'holdings') headings.push('Watchlist');

    return h('div', {className:'research-panel'},
      h('div', {className:'research-notice',role:'note'},
        h('strong', null, 'Independent research'),
        h('strong', {className:'research-comparison research-different',style:{fontSize:'11px'}}, 'Experimental · validation in progress'),
        h('span', null, research ? 'Saving a symbol requests research. Requested means it is waiting for the background worker; completed values and benchmark comparisons have separate statuses.'
          : 'Research service is not connected.'),
        scope === 'holdings' ? h('span', null, 'Showing all active holdings across accounts.') : null),
      scope === 'watchlist' && research ? h('div', {className:'research-controls'},
        h('button', {type:'button',className:'research-track',onClick:()=>research.refresh?.()}, 'Refresh status'),
        h('label', {className:'research-import'}, importBusy ? 'Importing reference…' : 'Import reference snapshot',
          h('input', {type:'file',accept:'.json,application/json',onChange:importFile,disabled:importBusy || !research.importSnapshot})),
        h('details', {className:'research-details'}, h('summary', null, 'Paste reference JSON'),
          h('label', {style:{display:'block',marginTop:'8px'}}, 'Reference JSON',
            h('textarea', {'aria-label':'Reference JSON',rows:5,value:pastedReference,
              onChange:event=>setPastedReference(event.target.value),disabled:importBusy,
              style:{display:'block',width:'100%',minWidth:'260px',maxWidth:'560px',fontFamily:'monospace',fontSize:'10px',margin:'5px 0'}})),
          h('button', {type:'button',className:'research-track',disabled:importBusy || !pastedReference.trim() || !research.importSnapshot,
            onClick:()=>importReference(pastedReference,true)}, 'Import pasted reference')),
        research.referenceMeta ? h('small', null, `Reference dates: ${(research.referenceMeta.dates ?? []).join(', ')}`) : null,
        importMessage ? h('span', {role:'status'}, importMessage) : null) : null,
      error || research?.error ? h('p', {className:'research-error',role:'alert'}, error || research.error) : null,
      allRows.length ? h('div', {className:'research-table-scroll'},
        h('table', {className:'research-table','aria-label':scope === 'holdings' ? 'Holdings research' : 'Watchlist research'},
          h('thead', null, h('tr', null, ...headings.map(label => h('th', {key:label,scope:'col'}, label)))),
          h('tbody', null, ...allRows.map(row => {
            const record = records[row.symbol];
            const metrics = getHoldingMetrics?.(row.symbol) || {};
            const held = holdings.find(item => !item.exited && item.ticker === row.symbol);
            const watched = watchlist.find(item => item.symbol === row.symbol);
            const name = watched?.name || held?.name || record?.instrument?.name;
            const trackedNow = tracked.has(row.securityId) || planTrackInWatchlist(watchlist, row).kind === 'existing';
            const iv = output(record,'iv');
            const supports = partValue(record,'supports');
            const cells = [
              h('td', {key:'symbol',className:'research-symbol'}, row.symbol,
                name && name !== row.symbol ? h('small', null, name) : null),
              h('td', {key:'avg',className:'research-number'}, price(metrics.avgPrice)),
              h('td', {key:'bvalue',className:'research-number'}, numeric(metrics.bValue) ? privacyMode ? 'S$•••' : `S$${price(metrics.bValue)}` : '—'),
              h('td', {key:'close',className:'research-number'}, price(metrics.close)),
              h('td', {key:'iv',className:'research-number'}, price(iv?.value), iv?.method ? h('small', null, iv.method) : null,
                iv?.variants?.length > 1 ? h('small', null, 'Multiple methods — see details') : null),
              h('td', {key:'iv-status'}, h(PartStatus,{record,part:'iv'})),
              ...['sl1','sl2','sl3','sl4','sl5'].map((key,index) => h('td', {key,className:'research-number'}, price(supports?.[index]))),
              h('td', {key:'sl-status'}, h(PartStatus,{record,part:'supports'})),
              h('td', {key:'research'}, h('select',{'aria-label':`IV method family for ${row.symbol}`,className:'research-method-select',
                value:record?.methodFamilySource === 'user' ? record.methodFamily : 'auto', disabled:!research?.request,
                onChange:event=>request(row,event.target.value)},
                ...[['auto','Auto method'],['stock','Company DCF'],['bank','Bank'],['reit','REIT'],['fund','Fund / ETF']].map(([value,label])=>h('option',{key:value,value},label))),
                h('button',{type:'button',className:'research-track',disabled:!research?.request,
                onClick:()=>request(row)}, record?.requestId ? 'Recalculate' : 'Calculate'), h(ResearchDetails,{record})),
            ];
            if (scope === 'holdings') cells.push(h('td', {key:'track'}, h('button', {type:'button',className:'research-track',
              disabled:trackedNow || typeof onTrack !== 'function', onClick:()=>track(row)}, trackedNow ? 'Tracked' : 'Track in watchlist')));
            return h('tr',{key:row.securityId},...cells);
          })))) : h('p', {className:'research-empty'}, scope === 'holdings' ? 'No active holdings to show.' : 'Add a symbol in the Watchlist view to include it here.'),
      h('p', {className:'research-footnote'}, 'Generated IV and support levels are experimental. Missing output stays blank; no generated levels are activated as alerts automatically. ',
        'IV and support comparisons are independent. A missing benchmark does not prevent calculation.'));
  }

  return {ResearchPanel, ResearchViewSwitch, ResearchBadge};
}
