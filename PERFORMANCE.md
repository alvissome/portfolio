# Portfolio performance review

Prepared against alvissome/portfolio main commit 4557ab3cd5eb8bbd0134b1a581e6190254f21e82. This is a proposed change, not a live deployment.

## Behaviour

Adds a performance panel to the existing signed-in dashboard: Cash, Retirement, SRS, CPF and Combined; whole portfolio or invested holdings; value and percentage charts; 1M, 3M, 6M, YTD, 1Y, All and custom dates. Values use SGD. Value charts label the opening value plus subsequent net flows rather than claiming lifetime contributed capital.

Only Investment portfolios map to Cash. CPF-IS maps to CPF and CPF-SRS to SRS. Trading, options, bonds and test portfolios are excluded. Bank cash earmarked for investing is additional to broker cash. Moving that bank cash to a broker is internal, not a new contribution.

SRS dividends retained in SRS count as income and actual cash. CPF dividends transferred to OA count as income followed by a withdrawal from the tracked portfolio. OA balances and subsequent OA interest remain outside the tracker. Do not classify all historical CPF income as current cash. Do not infer transfer dates from dividend dates without evidence.

New valuations require confirmation of actual cash per account. CPF defaults to zero for review, not an asserted balance. Earlier valuations must be sourced from statements; no backfilled prices are invented. Missing accounts prevent combined return calculations on that date. Imported holdings, cumulative dividends and cost basis alone cannot reconstruct historical total returns.

The downloaded transaction export was validated locally. It contains investment and retirement history, but missing base-currency conversions remain unresolved evidence. Private exports, balances, symbols, account identifiers and records must never be committed to this public repository.

## Calculation

Returns remain unavailable until the user confirms all movements for the account, basis and period. No missing movement is inferred to be zero merely because a file has not been imported. Historical trades are staged as evidence, not automatically classified as external portfolio flows. Reconcile dividends, deposits, withdrawals, fees, FX and corporate actions before enabling historical returns.

Time-weighted returns use an explicit end-of-day flow convention. When a valuation exists on every relevant flow date, subperiod returns are geometrically linked. Otherwise, the chart uses a labelled Modified Dietz estimate with daily weights. Returns are period returns, never annualised. Zero/negative capital makes the return unavailable. Combined returns are calculated from combined values and flows, not averaged percentages. Matching transfers cancel at the combined boundary.

Invested-only flows include purchases (including fees) as positive flows, sales (net proceeds) as negative flows and distributed dividends as negative flows. Whole-portfolio flows exclude those internal trades and retained dividends. Paid-out CPF dividends and sales to OA leave both boundaries. Standalone expenses require careful reconciliation; do not disguise them as withdrawals to remove their impact on performance.

## Storage and backups

Existing Firebase project: alvissome-portfolio, personal. History is isolated at users/{uid}/portfolio/performance. Existing holdings, settings and watchlist documents are unchanged. Browser writes merge individual record maps so disjoint dates and IDs survive concurrent writes. Same-date/same-account replacements are intentional corrections; export a backup first. History has its own Export history / Import history backup controls; the legacy dashboard backup does not contain performance history. Restore merges data and reconciliation coverage but does not silently reactivate scheduling.

Validate Firestore rules before rollout: signed-in owners alone must read/write their own performance document; unauthenticated and cross-user requests must be denied. Existing rules are not in this repository and have not been inspected. No rules or credentials were changed. The browser uses the existing Firebase SDK and authentication, without adding another SDK or dependency.

A 700 KB guard prevents growth toward Firestore's document size limit. No history is silently pruned. Extend to per-year documents before the limit is reached. Do not put a raw export into the cloud history document; staged evidence is normalised and size checked.

## Daily cloud valuations

The proposed GitHub Actions workflow runs at 08:30 Singapore daily, independent of the laptop. It does nothing for users who have not explicitly opted in during today's valuation reconciliation. It reuses only the existing personal portfolio repository's Firebase service-account secret. It refuses any project other than alvissome-portfolio. No business infrastructure, webhook, email account or secrets manager is used.

The worker fetches recent completed closing prices and current FX, validates ticker/currency and freshness, and skips failed accounts instead of valuing missing assets at zero. Mixed-market closes and daily FX have different timestamps; these are daily indicative valuations, not intraday or broker-certified NAVs. Quote timestamps and cash reconciliation dates are retained. Cash is held at its last confirmed amount. Changed source holdings/balances or later recorded movements pause account capture until reconciliation. Unknown activity outside the tracker cannot be detected. Unrecorded dividends and trades must still be reconciled. Returns remain unavailable beyond the confirmed movement coverage date.

The workflow only writes private Firestore history; it never commits values to GitHub. Manual valuations are not overwritten by the scheduled worker. Existing alert/report workflows are not changed. Review execution quota and price-source availability before activation. No paid resources were provisioned.

## Review, validation and rollout

Run `node --test tests/performance.test.js`, `node --check assets/performance-panel.js`, `node --check assets/index-CUEh86Kk.js` and `node --check .github/scripts/capturePerformance.js`.

Open preview.html through a loopback static server for a sample-data-only review. It has no Firebase connection and no personal records. This file is for local review and should not be published to the production site.

Before applying: verify owner-only Firestore access, reconcile actual opening balances (especially CPF versus dividend history), validate source exports, then approve the code publication. After deployment, sign in and test a performance-history read/write, run the snapshot workflow in dry-run mode, and opt in only after today's cash/holdings reconciliation. Existing credentials are never printed or copied into code.

Rollback: revert the change to index.html and the bundle and remove the new panel assets. Disable the performance workflow or use Pause daily capture. Keep the private history document and export its backup; rolling back the UI does not delete history or change the legacy portfolio. Resume by restoring the code and importing a verified performance backup only if necessary.

## Remaining history inputs

The trade export alone cannot establish daily portfolio valuations, historical cash funding or actual dividend transfers. Need StocksCafe cash-transaction history and dated dividends; OCBC statements for retirement verification; dated changes in bank cash earmarked for investments. Historical chart coverage can differ by account. Start verified tracking now while reconstructing earlier months separately.
