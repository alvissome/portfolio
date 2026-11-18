export function isCashHolding(holding) {
  return holding.accountType === 'Cash' && !holding.exited;
}

// Older versions tracked some holdings in the same collection as watchlist-only tickers.
export function activeWatchlist(holdings = [], watchlist = []) {
  const held = new Set(holdings.filter(isCashHolding).map(holding => holding.ticker));
  return watchlist.filter(row => row.symbol && !held.has(row.symbol));
}
