# Portfolio performance review

Prepared against alvissome/portfolio main commit 4557ab3cd5eb8bbd0134b1a581e6190254f21e82. This is a proposed change, not a live deployment.

## Behaviour

Adds a performance panel to the existing signed-in dashboard: Cash, Retirement, SRS, CPF and Combined; whole portfolio or invested holdings; value and percentage charts; 1M, 3M, 6M, YTD, 1Y, All and custom dates. Values use SGD. Value charts label the opening value plus subsequent net flows rather than claiming lifetime contributed capital.

Only Investment portfolios map to Cash. CPF-IS maps to CPF and CPF-SRS to SRS. Trading, options, bonds and test portfolios are excluded. Bank cash earmarked for investing is additional to broker cash. Moving that bank cash to a broker is internal, not a new contribution.

The Set aside money action records the date, additional SGD amount, bank location, optional note and whether a historical date is approximate. Earmarking enters the whole Cash portfolio, but not invested holdings. It records funding history without incrementing an already-entered cash balance. Funds earmarked before the opening valuation are already included there and are not counted again. Approximate funding dates produce explicitly estimated returns. New movements pause daily capture until the cash balance is reconciled again.

The legacy dashboard stores positions by ticker and can combine holdings of the same stock across different accounts. Performance capture therefore uses its own account-specific inventory derived from a complete trade export, with explicit statement reconciliation before activation. It does not silently migrate or rewrite the legacy allocations. Negative inventories and unsupported active exchanges block automatic capture. Updated trade inventories require fresh confirmation.

SRS dividends retained in SRS count as income and actual cash. CPF dividends transferred to OA count as income followed by a withdrawal from the tracked portfolio. OA balances and subsequent OA interest remain outside the tracker. Do not classify all historical CPF income as current cash. Do not infer transfer dates from dividend dates without evidence.

New valuations require confirmation of actual cash per account. CPF defaults to zero for review, not an asserted balance. Earlier valuations must be sourced from statements; no backfilled prices are invented. Missing accounts prevent combined return calculations on that date. Imported holdings, cumulative dividends and cost basis alone cannot reconstruct historical total returns.

The downloaded transaction export was validated locally. It contains investment and retirement history. Native SGD trades use their SGD net transaction amount when the export's base-amount field is empty; this needs no FX assumption. Non-SGD trades without a reported SGD equivalent remain unresolved evidence. Private exports, balances, symbols, account identifiers and records must never be committed to this public repository.

## Calculation

Returns remain unavailable until the user confirms all movements for the account, basis and period. No missing movement is inferred to be zero merely because a file has not been imported. Historical trades are staged as evidence, not automatically classified as external portfolio flows. Reconcile dividends, deposits, withdrawals, fees, FX and corporate actions before enabling historical returns.

Time-weighted returns use an explicit end-of-day flow convention. When a valuation exists on every relevant flow date, subperiod returns are geometrically linked. Otherwise, the chart uses a labelled Modified Dietz estimate with daily weights. Returns are period returns, never annualised. Zero/negative capital makes the return unavailable. Combined returns are calculated from combined values and flows, not averaged percentages. Matching transfers cancel at the combined boundary.

Invested-only flows include purchases (including fees) as positive flows, sales (net proceeds) as negative flows and distributed dividends as negative flows. Whole-portfolio flows exclude those internal trades and retained dividends. Paid-out CPF dividends and sales to OA leave both boundaries. Standalone expenses require careful reconciliation; do not disguise them as withdrawals to remove their impact on performance.

## Storage and backups

Existing Firebase project: alvissome-portfolio, personal. History is isolated at users/{uid}/portfolio/performance. Existing holdings, settings and watchlist documents are unchanged. Browser writes merge individual record maps so disjoint dates and IDs survive concurrent writes. Same-date/same-account replacements are intentional corrections; export a backup first. History has its own Export history / Import history backup controls; the legacy dashboard backup does not contain performance history. Restore merges data and reconciliation coverage but does not silently reactivate scheduling.

Before a live rollout, take a fresh Export Backup from the current dashboard after the owner has finished the monthly reconciliation, and retain a separate performance Export history once history exists. Confirm both exports are valid and usable before changing production. Adding the panel does not require restoring either export: use restoration only for recovery, because routinely restoring an older backup could overwrite newer changes. No production backup or restoration has yet been performed as part of this draft.

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

## Monthly process and cash locations

The performance panel groups routine controls under Monthly update (Save portfolio snapshot, No holdings or cash changes, Confirm money movements) and Money set aside & transfers (additional earmarks, bank-to-IBKR transfer, other movements). These are choices, not a mandatory sequence. Historical transaction/statement imports, separate performance-history recovery and daily capture settings live under Advanced. The pause control appears only when capture is enabled. Existing top-navigation TSV import and legacy JSON backup remain available and unchanged.

Two verified valuations mean snapshots on two different dates for the same selected account/view within the chart period. They do not mean Cash plus Retirement or two checks on one day. Holdings values are calculated from quantities, quotes and FX; initial account split and actual cash need confirmation. Holdings-value adjustments and holdings details are collapsed in the snapshot form. Earlier dates require the corresponding statement values. A monthly unchanged confirmation saves today’s calculated holdings value and unchanged cash, refreshes the check date and enables daily capture after initial account setup. Reconciliation through today does the same with confirmed actual cash and explicit movement coverage. Historical dates need existing source-backed snapshots; neither confirmation backdates today’s values. Daily recording is enabled by default during today’s initial setup, with a visible option to leave it off.

Keep StocksCafe as the transaction and dividend/tax record. Reconcile actual cash per currency against IBKR; review OCBC SRS/CPF statements as available. Investigate discrepancies rather than assigning every correction to a new deposit. Do not enter the same retained dividend again as a contribution. The StocksCafe current-portfolio TSV refreshes current dashboard holdings and cash; it is not the historical transaction export used by the performance panel.

No trades does not guarantee unchanged cash: dividends, interest, fees, tax adjustments, FX and corporate actions still matter. If holdings and actual cash have not changed, use Checked and unchanged instead of re-uploading an identical TSV. If only cash changes, update the actual cash through existing settings or import an updated TSV; record a verified valuation. Price refreshes are separate from transaction uploads. Check dates are displayed per account and flagged when source balances or holdings later change. After initial verified capture setup, a no-change confirmation now saves today’s snapshot and enables daily capture. It extends existing total-return coverage only across an explicitly confirmed inactive interval. It never invents a historical value.

Record valuation also saves the account check date. Reconciliation coverage for returns remains an explicit separate confirmation. Invested-only total returns require dated dividends as source evidence; the user should not recalculate tax manually. Whole-portfolio returns with retained dividends require verified cash values and external flows, not duplicate dividend contributions.

The Set aside money action records newly allocated capital. Remaining bank cash is the existing growth cash balance, not lifetime funding. To move SGD 20,000 from a bank allocation into IBKR, first reduce the bank balance by SGD 20,000 in dashboard settings; record a deposit into the broker portfolio in StocksCafe; import/reconcile the increased broker cash; then use Record bank → IBKR transfer with the date, amount and before balances. The form requires both current balances to match the resulting after balances, rejects identical duplicate records and excess bank transfers, and saves an internal audit record with zero flows for both performance boundaries. It never adds to original funding or changes legacy balances itself. Use matching SGD movements before later trading/FX; reconcile fees separately. Daily cash capture pauses until a fresh verified valuation. Voiding the audit record never reverses real money or dashboard balances.

## Personal Boost.space report retrieval: prepared setup, not activated

Use the owned Boost.space subscription, not a new service or the Dive VPS/n8n. The personal workspace/system and personal storage destination must be identified before creating anything. Do not inspect or change business scenarios or reuse their connections. This draft contains instructions only: no Boost scenario, credentials, external storage, messages or schedule have been created.

Current Boost documentation distinguishes its newer ACT automations from the classic Integrator. Confirm which is included in the owner's account before building; classic module names below describe the HTTP sequence, not a guaranteed importable blueprint. ACT can implement the same sequence as a code action with encrypted named secrets. A secure token setup and real test are required before activation.

Proposed monthly retrieval, default 9th at 09:00 Asia/Singapore (confirm before activation), covering the previous calendar month:

1. Store the personal IBKR Flex reporting token in the platform's secret store and configure the existing CSV-compatible query ID. Do not put a token in chat, source, output files, notifications or execution logs. For classic Integrator, enable Data is confidential before testing. ACT should receive secrets through its secure secret-entry flow. A Flex reporting token is not an order-placement credential, but exposes private reporting data; use only the required account/query and renew on expiry.
2. HTTP GET to the fixed `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest` endpoint, with query fields `t` (secret), `q` (query ID), `v=3`, `fd` and `td` (previous-month YYYYMMDD). The configured Flex query must retain the exact CSV format required by StocksCafe. Parse XML and require Status=Success plus ReferenceCode. Never follow a returned arbitrary URL.
3. After a short delay, HTTP GET to the fixed `/AccountManagement/FlexWebService/GetStatement` endpoint with `t`, `q` (ReferenceCode, not the original query ID), and `v=3`. Retry only report-not-ready responses with bounded delays, for example at most six attempts spaced ten seconds apart. Stop and report a redacted error on expired tokens, configuration errors or exhausted retries. Do not regenerate the same report in a tight loop.
4. Check that the result is the expected CSV header/layout, not XML error text or a login page. Preserve bytes, encoding and column order for the StocksCafe importer. Save only to confirmed personal private storage using a deterministic period/query/account filename. Track downloaded and user-imported status separately; downloading does not mean the report was imported. Preserve hashes/revisions for corrected reports and prevent accidental duplicate imports. Never discard a no-trade month solely because there are no trade rows: cash activity can still exist.
5. User uploads the CSV to StocksCafe, checks cash balances per currency, exports the selected current-portfolio TSV and imports it into the dashboard when balances/holdings changed. Statements remain the reconciliation reference. No unsupported StocksCafe login/cookie replay, browser-upload workaround or auto dividend re-entry is part of this setup.

Official references checked 2026-11-04:
- Boost classic HTTP modules: https://legacy-api.boost.space/tools/http
- Boost classic confidential data: https://legacy-api.boost.space/scenarios/scenario-settings
- Boost current ACT and secure secrets: https://docs.boost.space/act/connect/for-agents
- IBKR request generation: https://www.interactivebrokers.com/docs/web-api/flex-web-service/using-flex-web-service/generate-the-report
- IBKR report retrieval: https://www.interactivebrokers.com/docs/web-api/flex-web-service/using-flex-web-service/retrieve-the-report
- StocksCafe importer: https://stocks.cafe/portfolio/transactions/tobulkupload_ibkr
- StocksCafe owner on unsupported API access: https://forum.stocks.cafe/t/accessing-stock-data-using-apis/123104

The unverified link is an authenticated supported transaction-upload API for StocksCafe. HTTP file-upload capability in Boost alone does not establish that StocksCafe offers one. Keep this step manual unless StocksCafe confirms supported integration. No production automation can be claimed until tested inside the confirmed personal workspace with a personal token and destination.

## Confirmation-driven automatic snapshots

After the owner establishes account-specific capture settings from a complete trade history and confirmed actual cash, Monthly update offers Confirm reconciliation and No holdings or cash changes. Both save a snapshot for today and set dailyEnabled=true in the same history-document write. Reconciliation also writes explicit selected return coverage. No changes requires identical source holdings/cash signatures, identical trade-derived positions, no pending reconciliation flag and no newer recorded movements; it uses updated quotes and unchanged cash. It extends prior total-return coverage only if that coverage already reaches the previous confirmed date. Invested-only coverage is not silently extended.

Current quote/FX validation failures stop the confirmation instead of saving a zero or stale price. Changed trade-derived holdings need account-setup review before daily capture resumes. An earlier reconciliation end date requires an already verified snapshot from that date and updates coverage only. Setup selected on an earlier date automatically deselects daily capture. Historical import and statement evidence remain separate from prospective daily history.

Privacy was checked in the deployed personal project alvissome-portfolio on 2026-11-04. Current Firestore rules allow read/write at users/{userId}/portfolio/{docId} only for request.auth.uid==userId. Rules Playground confirmed owner reads allowed, unauthenticated and different-user reads denied. No security rules were changed. The cloud job uses the existing personal repo service identity; it writes private Firestore history and logs aggregate counts, never financial records or secrets. The public repository contains code only. Private history is not part of GitHub Pages assets. Daily capture is scheduled at 08:30 Asia/Singapore and remains inactive for accounts without verified setup. No user's reconciliation was certified by this code rollout.

Historical source check: StocksCafe Report displays historical annual returns and portfolio chart history; its current-portfolio TSV exports the current view, not daily historical values. The already downloaded transaction CSV provides trades and dates, not ready-made daily NAV/cash snapshots. A supported historical-value export for this owner's account has not yet been verified. Do not claim that historical performance has been imported or that current holdings can be backdated. Past bank allocations, cash calibrations and retirement cash distributions still need reconciliation before historical whole-portfolio returns can be certified.


## Retirement cash maintained in StocksCafe (2026-11-04)

StocksCafe is the main record for broker, SRS and CPF investment-account cash as well as transactions/dividends. OCBC/IBKR statements remain the reconciliation evidence. The top TSV import now reviews the CASH row before applying any holdings or balance changes. Export a complete current-portfolio holdings view including all tracked Investment, CPF-SRS and CPF-IS portfolios, with SGD base currency and excluding Trading/Options/Bond/Test. A partial holdings export remains unsafe with the existing ticker-based merge because missing positions are marked exited.

The TSV can contain a single aggregate CASH row with no account provenance. The app does not claim to derive account cash automatically from that row. The owner explicitly selects broker-only cash (legacy workflow: SRS/CPF balances unchanged) or combined broker/SRS/CPF cash. For combined cash, review actual SRS and CPF amounts from StocksCafe; broker cash is the remainder. The split must match the export total. Prior retirement balances are suggestions, not verified source values. Full unattended cash import needs an account-labelled export; an aggregated total is insufficient. Missing CASH leaves balances unchanged; zero clears old balances; foreign/unknown currency, multiple cash rows and invalid allocations fail before holdings change. Cancel leaves the entire portfolio untouched. Combined imports replace all three balances and never add bank earmarks or duplicate retirement cash. JSON recovery remains unchanged.

Reconciliation and initial setup now default to the current dashboard cash, including imported CPF cash, rather than older capture cash or a forced CPF zero. An import is not a reconciliation confirmation; changed source signatures pause daily capture until the owner confirms. Existing holdings classifications, settings, watchlists, snapshots and flows are preserved. No cash migration, source export or private user data is committed. No existing user balance is changed merely by deploying the code.

For cash returned from CPF-IS to OA: record a WITHDRAWAL in StocksCafe on the actual bank transfer date, note Returned to CPF OA, and retain the original dividend/sale records. Import the reduced actual investment-account cash. In Money set aside & transfers, CPF investment cash → OA records a performance outflow only and does not decrement the imported balance again. The new cash_to_oa flow is total=-amount, invested=0 because money already distributed into cash is not distributed out of holdings a second time. For holdings-only returns the original dividend/sale keeps its own dated invested outflow. Legacy dividend_to_oa and sale_to_oa describe direct payouts that have not also been recorded as earlier dividend/sale movements; never combine both treatments for the same payout. Same-date/same-amount CPF outflows are flagged for review. The new action marks capture as requiring reconciliation, rejects future dates, and supports existing history export/restore. OA balances and OA interest remain outside the tracked Cash/Retirement/Combined portfolios, so CPF-IS → OA is an external outflow at every tracked portfolio boundary, even though it remains the owner's retirement savings.

Switch-over is a bookkeeping-source change, not new money: verify actual cash against OCBC, resolve prior StocksCafe entries labelled as separately accounted for in the app using source evidence, and import the reviewed balances. Do not create a fictitious new contribution or transfer merely to move tracking between apps. Reconstruct older actual OA transfers only from dated statements; avoid guessing from cumulative dividends.

Validation: npm test covers repeated imports, replacement rather than addition, cash scopes, unchanged bank cash, explicit zero, malformed/foreign/ambiguous cash, real bundled-import callback integration/classification preservation, and CPF dividends followed by later OA transfers. No infrastructure, credentials, security rules, paid services or user financial records are modified by this release.
