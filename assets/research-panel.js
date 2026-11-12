import {prioritizeUniverse, planTrackInWatchlist} from './research-core.js';

const numeric = value => typeof value === 'number' && Number.isFinite(value);
const price = value => numeric(value) ? value.toLocaleString('en-SG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}) : '—';

/** Readable UI boundary for the compiled app. There is deliberately no worker
 * request, pretend progress or adoption of generated levels in this first UI.
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

  function ResearchPanel({holdings = [], watchlist = [], scope = 'holdings',
    onTrack, getHoldingMetrics, privacyMode = false}) {
    const pending = React.useRef(new Map());
    const [tracked, setTracked] = React.useState(() => new Set());
    const [error, setError] = React.useState('');
    const allRows = scope === 'watchlist' ? prioritizeUniverse([], watchlist)
      : prioritizeUniverse(holdings, watchlist).filter(row => row.held);

    React.useEffect(() => {
      // Local optimism only bridges the add callback and its parent rerender.
      // Once the real watchlist contains the row it owns tracked/not-tracked
      // status, including any later removal from the other watchlist view.
      const acknowledged = [...pending.current].filter(([, row]) =>
        planTrackInWatchlist(watchlist, row).kind === 'existing').map(([key]) => key);
      if (!acknowledged.length) return;
      for (const key of acknowledged) pending.current.delete(key);
      setTracked(previous => new Set([...previous].filter(key => !acknowledged.includes(key))));
    }, [watchlist]);

    const track = row => {
      const held = holdings.find(item => !item.exited && item.ticker === row.symbol);
      const plan = planTrackInWatchlist(watchlist, {...row, name: held?.name || row.symbol});
      if (plan.kind === 'existing' || pending.current.has(row.securityId) || typeof onTrack !== 'function') return;
      pending.current.set(row.securityId, row);
      try {
        onTrack(plan.item);
        setTracked(previous => new Set([...previous, row.securityId]));
        setError('');
      } catch {
        pending.current.delete(row.securityId);
        setError('Could not add this symbol to the watchlist. Please try again.');
      }
    };
    const headings = ['Symbol', 'Avg Price', 'BValue (SGD)', 'Close', 'IV', 'IV status',
      'SL1', 'SL2', 'SL3', 'SL4', 'SL5', 'SL status'];
    if (scope === 'holdings') headings.push('Watchlist');

    return h('div', {className: 'research-panel'},
      h('div', {className: 'research-notice', role: 'note'},
        h('strong', null, 'Research preview'),
        h('span', null, 'Not started — data worker not connected. Existing manual levels and price sync remain available in the ',
          scope === 'holdings' ? 'Positions' : 'Watchlist', ' view.',
          scope === 'holdings' ? ' Showing all active holdings across accounts.' : '')),
      error ? h('p', {className: 'research-error', role: 'alert'}, error) : null,
      allRows.length ? h('div', {className: 'research-table-scroll'},
        h('table', {className: 'research-table', 'aria-label': scope === 'holdings'
          ? 'Holdings research' : 'Watchlist research'},
        h('thead', null, h('tr', null, ...headings.map(label => h('th', {key: label, scope: 'col'}, label)))),
        h('tbody', null, ...allRows.map(row => {
          const metrics = getHoldingMetrics?.(row.symbol) || {};
          const trackedNow = tracked.has(row.securityId) || planTrackInWatchlist(watchlist, row).kind === 'existing';
          const cells = [
            h('td', {key: 'symbol', className: 'research-symbol'}, row.symbol),
            h('td', {key: 'avg', className: 'research-number'}, price(metrics.avgPrice)),
            h('td', {key: 'bvalue', className: 'research-number'}, numeric(metrics.bValue)
              ? privacyMode ? 'S$•••' : `S$${price(metrics.bValue)}` : '—'),
            h('td', {key: 'close', className: 'research-number'}, price(metrics.close)),
            h('td', {key: 'iv', className: 'research-number'}, '—'),
            h('td', {key: 'iv-status'}, h('span', {className: 'research-status'}, 'Not started')),
            ...['sl1', 'sl2', 'sl3', 'sl4', 'sl5'].map(key => h('td', {
              key, className: 'research-number'}, '—')),
            h('td', {key: 'sl-status'}, h('span', {className: 'research-status'}, 'Not started')),
          ];
          if (scope === 'holdings') cells.push(h('td', {key: 'track'},
            h('button', {type: 'button', className: 'research-track',
              disabled: trackedNow || typeof onTrack !== 'function',
              onClick: () => track(row)}, trackedNow ? 'Tracked' : 'Track in watchlist')));
          return h('tr', {key: row.securityId}, ...cells);
        })))) : h('p', {className: 'research-empty'}, scope === 'holdings'
          ? 'No active holdings to show.' : 'Add a symbol in the Watchlist view to include it here.'),
      h('p', {className: 'research-footnote'},
        'Generated IV and support levels will appear here after calculation. Missing output stays blank. ',
        'Calculation completion and validation are separate; no generated levels are activated automatically.'));
  }

  return {ResearchPanel, ResearchViewSwitch};
}
