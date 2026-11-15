# Investment decision preview

Personal environment: `alvissome/portfolio`, existing GitHub Pages frontend and existing signed-in Firebase project. No new hosting, credentials, public endpoints or paid services. No Dive Deals infrastructure is accessed.

## Rules checked on 14 November 2026

Source: https://app.notion.com/p/93744bdaa1b54851bf51e01edd17d87a and the user's subsequent clarification.

- **Anchor:** up to six selected companies. Equal nibbles across every approved support; only the intended additional budget is split for existing holdings. Normal purchase ceiling is 10% per company.
- **Core:** 1.5% + 1.5% + up to 3% of the strategy base at the deepest three approved supports; 6% company ceiling.
- **Selective:** deepest two approved supports, with a dynamic 2–4% spending range reassessed against uncommitted cash and competing opportunities; 4% company ceiling overrides this range and permits smaller buys. Deferring or skipping is allowed.
- Ceilings prefill from the game plan: Anchor 10%, Core 6%, Selective 4%. Lower company-specific ceilings are allowed.
- Suggested spend is capped by the saved stage's unused budget, current room below the company's ceiling, and available committed cash after liabilities and pending orders.
- Stage budgets freeze in SGD at approval. Monthly reviews update IV and support prices but retain permanent stage IDs, budgets and actual fills. A category or ladder change requires explicit plan review. Approval creates the revised schedule, keeps all actual fills, and archives stages no longer in the active schedule. Restoring a stage restores its previous fill status instead of reopening a completed buy.
- Completed stages cannot be reset. Actual cumulative spend cannot be reduced through this interface. Correcting an erroneous fill needs a separately reviewed correction rather than silently restoring purchasing capacity.
- All values are previews requiring user review and execution. Being below a support is not evidence of a fresh crossing; this panel does not emit alerts.

Category membership is selected through the **Category** column in Holdings or Watchlist. Research views omit this column. Both use the same ticker-level map, so changing a category in either place updates the other, including after Track in watchlist. Unassigned tickers produce no purchase plan. Categories determine buying schedules independently of the allocation buckets.

Existing portfolios without the new field are seeded once with GOOGL, META, AMZN, MSFT, NVDA and SPGI as Anchor, reflecting the previously selected six. Users can change these choices in the dashboard. Explicit empty selections remain empty across reloads and imports. Selecting a seventh Anchor is rejected without replacing an existing selection. The Notion game plan does not maintain category membership.

## Funding

The frontend reads cash holdings, current cached prices, FX, broker cash and bank money set aside from the existing dashboard state. It excludes retirement accounts. The user confirms that all displayed broker/bank cash is committed, enters related liabilities and pending orders, and reviews holdings and FX. Cash or quantity changes invalidate the saved confirmation. Pending orders reduce cash available, not the strategy portfolio base. Liabilities are counted once in each relevant measure.

The panel cannot infer future contributions, reserved money outside the dashboard, CPF OA investable funds, or unrecorded liabilities/orders. Bank cash may need transferring before execution. CC purchase fills now deduct only the CC planning allowance. StocksCafe imports remain the sole source of authoritative holdings and broker balances; reconcile CC spending against each later cash import.

Retirement is lump-sum investing, deferred at the user's request. Existing SRS/CPF investment cash can later be reused as recorded inputs, with account-specific investable-fund confirmation.

## Data, recovery and integration

- Pure calculations: `assets/investment-strategy.js`.
- UI: `assets/investment-panel.js` and `.css`, inserted beside the existing performance panel through the established compiled-dashboard extension pattern.
- Shared category map: `users/{uid}/portfolio/data`, field `settings.strategyCategories`, written immediately through a queued, category-only cloud update. It is independent of account-specific rows and imports, and is included in the existing dashboard-wide state backup.
- Saved configuration, plans and fills: `users/{uid}/portfolio/performance`, field `settings.investmentStrategy`. Writes replace only this field; unrelated history/settings are preserved. Authentication must match the UID before saving.
- Dashboard-wide backup already exports the performance document, including this settings field. Restore includes it and reloads the frontend. Unit coverage verifies the round trip.
- No broker secrets or Telegram tokens are used. No orders, emails or Telegram messages are sent by the panel.
- Dashboard category selections are authoritative. Legacy plans without a category, or plans whose category no longer matches the ticker selection, withhold amounts until reviewed. No category change resets a fill.
- Existing support monitoring additionally checks Saturday at 08:00 Singapore time so Friday's US close is included. This change preserves the existing weekday checks and delivery mechanisms; it does not add purchase amounts to existing alerts.
- Rollback: revert this change to remove the panel and restore the earlier schedule. Existing saved strategy data remains available in backups; no financial history is deleted.

## Limits and next integration

This version covers share plans, not LEAPS or short-option legs. Combined share/options exposure and LEAPS commitment sizing must be added before using this engine for option decisions. The broader 60/25/15 buckets remain review references; aggregate bucket caps are not enforced in this preview. CSPX remains review-only until explicit entry/amount rules are configured.

The panel blocks amounts for missing funding confirmation, missing/stale quotes (including cache older than four days), missing FX, changed/unreviewed IV, a thesis/IV review older than 31 days, or a changed support ladder/category. Review dates are user attestations, not automated fundamental checks. No independent news-clearance claim is made. Final-stage buys explicitly ask for another thesis/IV check.

Multiple previews share a cash pool. Each is individually capped; aggregate overcommitment is flagged, but cash is not reserved until the user updates pending orders. Server-side crossing detection, a consolidated decision queue with reservations, concurrency protection between simultaneous editing devices, LEAPS sizing, and dedicated personal Telegram delivery remain subsequent work.

## Validation

Run `npm test` and `node --check assets/index-CUEh86Kk.js`. The initial release had 232 passing tests. Coverage includes rendered production table category cells and callbacks, category serialization, tracking inheritance, backup recovery, all three schedules, cash separation, ceiling/cash/stage caps, deepest eligible stage selection, fill persistence, monthly review gates, unit rounding, manual level precedence, funding invalidation and dashboard backup recovery.

A browser interaction harness was attempted locally. Chromium could not launch because this execution environment denies its singleton socket. Live signed-in Firebase writes and visual browser interaction are therefore not verified; the PR remains a draft until deployment approval. Component rendering and interaction callbacks are exercised using the actual production functions in the test harness, but this does not replace signed-in browser verification.

## Command Centre and quarterly watchlist revisions (14 November 2026)

The Command Centre derives its active universe from **current cash holdings plus the current watchlist**, keyed by exact ticker rather than watchlist row ID or order. SRS/CPF positions remain outside this stock-buying scope.

| Change | Behaviour |
| --- | --- |
| Add or replace watchlist rows | New tickers appear in All monitored / Needs attention, with missing category or purchase-plan inputs identified. |
| Remove a watchlist-only ticker | Its active card retires; its plan, frozen stage budgets, completed fills and decision history remain saved. |
| Remove a ticker that is still held | The holding remains monitored. |
| Re-add a ticker after a quarterly review | Its original plan and completed-stage history are recovered. It does not get a fresh buying budget. |
| Change category, IV, supports or implemented rule version | Withhold the amount pending explicit plan review. Prior deferrals/dismissals no longer suppress a materially changed opportunity. |
| Change only quote price or reorder rows | Refresh valuations/eligibility; preserve a decision while the same entry stage and investment inputs still apply. |
| Remove/reclassify a company with a pending order | Keep the reservation and order visible in My decisions until explicit cancellation or final-fill recording. |

The written Notion page is a reference. Changing it does not silently reinterpret the configured strategy. A rule change requires an implementation/configuration update and approval; each affected saved plan must then be reviewed. Categories are maintained in the dashboard's shared ticker map. My decisions also exposes retained categories for inactive tickers; explicitly unassigning one frees an Anchor slot without deleting its plan or fills.

### Interface and decisions

`assets/investment-command-centre.js` builds opportunities and the decision journal from existing data. `assets/investment-command-view.js` renders summary counts, opportunity cards, attention/all-monitored views and My decisions. Cards use actual support prices, current/ceiling/projected company weights, SGD purchase amounts and native-currency entry prices. The interface distinguishes entry eligibility from incomplete review information; it does not claim a fresh crossing or an automatically verified business thesis.

Defer and Dismiss apply to the investment inputs at the time of the decision. Material input changes restore review visibility while retaining the old journal record. Deferrals expire on their chosen Singapore date. Existing fills remain authoritative even if their stage later moves into a plan's archived stages.

**Record pending order** records an order the user placed independently. It does not send a broker order. Its cash reservation reduces available committed cash for every other preview. External pending orders entered in the funding settings must exclude orders already recorded in My decisions, preventing double counting.

**Record cancellation** releases only the planner reservation; it does not cancel a broker order. **Record final fill** closes the reservation, adds actual spend to the original active or archived stage, and invalidates funding confirmation atomically. The user imports updated holdings/cash and confirms funding before another purchase preview. A pending-order stage cannot be filled through the legacy manual form without reconciling its order record.

### Safe cloud writes and recovery

All command configuration, decisions and reservations remain in `settings.investmentStrategy` on the existing personal performance document. Existing dashboard-wide backup and restore include them.

`assets/investment-store.js` reads/writes that field through Firestore REST using the signed-in Firebase user's ID token, held only in memory. Each masked commit checks the document's exact cloud update time. Stale tabs/devices cannot overwrite a newer decision or independently reserve the same stale cash state. A conflicting save requires reloading decisions and rechecking cash; an ambiguous network save also requires reload. No credentials, permissions, security rules, service accounts, hosting or public endpoints are created or changed.

The rest of the dashboard keeps its existing storage path. A performance-history update can legitimately invalidate an old Command Centre save version; reloading resolves it without overwriting unrelated data. No decisions are silently pruned. A 300 KB command-settings guard stops further additions with an export/recovery message before unbounded journal growth.

Validation: 252 Node tests pass, including quarterly replacement, remove/re-add, changed rules and levels, defer expiry, shared reservations, settlement into archived stages, Singapore dates, backup recovery and cloud version conflicts. A separate DOM interaction harness verifies mounted cards, order recording, cash reservation, final fill, quarter revisions, privacy masking and cleanup. The remote browser could not reach the local development server; visual layout and live signed-in cloud persistence remain unverified before deployment. Deployment of this iteration and the compact-research refinements was approved by the user on 14 November 2026.

## Compact dashboard research controls (14 November 2026)

- Watchlist symbol chips show only **IV** and **SL** on one line beside the ticker. Full status is available in hover text and the accessible button name. Not applicable is blue, Different retains orange, No benchmark retains grey, and matches retain green.
- Main Holdings and Watchlist tables use the shorter **Category** heading. Category is omitted from both research tables, along with BValue.
- Research source/sync controls and settings/maintenance use a two-column responsive layout. Narrow screens stack the two groups.
- Each table's existing column icon sits beside its Research switch. In Positions/Watchlist mode it edits the existing columns; in Research mode it edits that research table's independent visibility settings. Symbol stays visible, while remaining research columns can be hidden or reset. All current research columns show by default.
- Preferences persist through the existing portfolio save path in `settings.researchColumnVisibility`, separated into `holdings` and `watchlist`. They survive account reimports and dashboard-wide backup/restore. Old portfolios without this field default to all research columns visible. These changes affect presentation only, not research values, alert levels, categories or purchase sizing.

## Compact opportunities and prefilled plan review (14 November 2026)

Opportunity cards use three columns above 1100 px, two columns from 701–1100 px, and one on narrow screens. Smaller card typography and spacing preserve actual price/support/allocation details and all decision controls. Holdings Positions/Research and its adjacent gear are centred together as one group; the gear no longer pushes the toggle to the right edge.

The setup form now opens on a current Anchor by default, retains the selected ticker across Command Centre updates, and displays rule/data provenance. It prefills category, current IV/supports, portfolio base, current holding, stage budgets and saved execution inputs. New Anchor plans draft the maximum remaining room under the normal 10% ceiling, with an explicit explanation that this is editable and not a target or approval. Existing approved Anchor and other frozen stage budgets stay unchanged.

Core's 1.5% + 1.5% + up to 3% schedule is shown automatically. Selective uses the deepest two supports, with a maximum stage allowance of 4% and a live 2–4% spending range capped by company room and shared cash; actual spending is chosen when recording an order. Fee/FX reserve has been removed. Unverified non-US board lots still require listing confirmation, unless the user explicitly confirms odd-lot whole-share buying. Whole-share US listings can draft a one-share lot; other listings reuse an explicit saved/metadata lot or request confirmation. Missing valuation data remains unknown, not zero. The user must still confirm business/IV review and approve the plan; drafts do not place orders or silently save plans.

## Plan review and persistence fixes (14 November 2026)

- Active rule version: `2026-11-14-ceilings-dynamic-selective`. Older plans require review. Review preserves stage IDs, cumulative spend and completion while applying revised stage budgets and ceilings. No completed stage reopens.
- Category changes enter the cloud write queue immediately, using only `settings.strategyCategories`. Normal portfolio autosave uses individual settings field masks and excludes this map, so an older delayed autosave cannot overwrite a category selection. Failures show the existing save error indicator plus an explicit alert; selecting again retries. The same stored map is loaded by both tables. Backup restore still includes the full map.
- Known holdings, quantities, cash and portfolio base remain visible when stale prices block executable sizing. Missing valuation components are shown as an incomplete known subtotal; unknown company values and full base/weights are not fabricated.
- Share quantities derive from capped stage spend divided by the entry limit and FX rate. Round down to the confirmed board lot, or whole shares if the broker supports odd lots. Neither rounding nor odd lots may exceed stage allowance, company ceiling or shared cash. No fee reserve is deducted, including from legacy plans. This does not infer an exchange board lot from the investor’s current holding quantity.
- Plan remarks persist with the approved plan and a separate dated `plan-reviewed` snapshot in My decisions. Updating remarks never edits older reviews or reserves cash. Unsaved setup edits survive background quote/research refreshes. A snapshot includes thesis/IV review date, category/ceiling, holdings, portfolio base and stage budgets.
- The Notion Stocks Plan Review page contains a log template. My decisions provides **Copy for Notion**, with a selectable-text fallback if clipboard access is unavailable. Notion is a manual copy workflow; no Notion credentials or automatic sync were added to the public frontend.
- Holdings Detail, count and Positions/Research/gear stay on one header row with compact narrow-screen spacing; count omits “stocks”. Last sheet check sits directly below Sync AK sheets.

Deployment remains on the existing personal GitHub Pages/Firebase project. No new dependencies, services, credentials or infrastructure. Rollback: revert the source commit; saved plans/reviews remain in the existing backup and Firestore settings.

Current validation: 276 Node tests pass, plus mounted DOM interaction checks for setup approval, remarks, saved review history, order reservations/final fills, quarterly changes, privacy and cleanup. Signed-in user cloud state was not modified during testing.

## Category views and selected-support purchase sizing (14 November 2026)

- Holdings, Watchlist and the Command Centre provide category filtering and category ordering. Filtering is a view preference, never a holdings/watchlist mutation. Watchlist manual dragging is disabled while filtering or category sorting to avoid applying visible-row indexes to the full watchlist. Holdings Category headers also use the existing sortable-column behavior. Research remains across accounts regardless of hidden Positions account/type filters; the visible category controls apply to research too.
- Opportunity cards combine current weight and company ceiling in one metric, retain current holding value/quantity, show entry and following support, and omit the repeated portfolio base. Base remains in the Command Centre funding summary and setup.
- Every category exposes an editable purchase budget for a selected support. Anchor additionally retains its total addition budget. Core and Selective prefill their category allowances, then cap the selected budget by remaining stage allowance, current company room and available cash. Read-only quantities, lots and estimated spend recalculate immediately.
- The odd-lot checkbox is removed. A single **Order increment (shares)** field determines rounding: 1 for whole-share orders (including supported odd lots), otherwise the required board lot. Listing metadata/saved inputs are reused; unknown increments require confirmation. Quantity is derived from the selected support's entry limit, FX and budget.
- Saving records `purchaseBudget` on the selected stage as cumulative spent plus intended remaining spend. The preview engine honors that cap, ordinary reviews preserve it, and completed fills remain closed. Save does not place an order or reserve cash. Review snapshots include the selected budget. Only a separately recorded pending order reserves cash.
- Remarks span three desktop form columns and the full mobile width; review date occupies the remaining desktop column. The approval checkbox uses a short label with the full wording available on hover.
- An exited ticker absent from active holdings and the watchlist produces no active card or new monitoring work. Its retained category automatically becomes Selective and is saved through the existing immediate category queue. This frees Anchor slots without a cleanup prompt; historical plan categories, decisions, fills and any unsettled order reservation remain accurate and recoverable. Re-adding it starts in Selective and requires review if its old plan used another category.

Validation: 284 Node tests plus mounted DOM flows for all-category budget prefills, support changes, share increments, calculated quantities, saved budgets affecting opportunity cards, remarks surviving background refresh, category filtering, and order reconciliation. No new infrastructure, credentials, dependencies or services. Existing GitHub Pages and signed-in personal Firebase storage remain the deployment/recovery targets.

## Compact price-led review and public-data privacy (14 November 2026)

- The normal desktop company editor uses two rows of six grid columns. Row one: company, support, editable entry price, editable whole-share quantity, and native-currency estimated purchase with SGD beneath. Row two: one-line remarks spanning two columns, review date, compact attestation, Save plan and optional Plan settings. Tablet/mobile layouts reflow; expanded settings and validation messages may add space.
- Plan settings contains company ceiling, total Anchor budget and order increment, prefilled from the game plan/saved configuration. Lots and the per-SL budget control are removed from the main form. Existing frozen stage allowances, company room and shared cash still cap sizing. Prices show currency symbols, grouping commas and decimals.
- Editing entry price recalculates shares against the saved allowance. Editing quantity recalculates the purchase in market currency and SGD. Share increments remain enforced; quantities round down on blur to the configured increment. Entries cannot exceed the selected support or reviewed IV; normal IV/cash/freshness gates remain in force.
- Each selected stage persists its custom `entryPrice`, `purchaseQuantity` and cumulative `purchaseBudget`. Entry eligibility respects that price, and quantity cannot exceed the stage/cash/company constraints. Routine reviews retain these fields and actual fills. The journal captures the price/quantity. Floating-point tolerance at exact share-cost boundaries prevents a whole share being dropped by FX arithmetic.
- Command Centre privacy renders a separate public-only view of quotes, IV and supports, with category filtering. Portfolio values, allocations, quantities, order states, purchase plans, forms and notes are excluded from its DOM. Holdings/Watchlist also mask share quantities, average purchase costs and notes; research masks average purchase costs while keeping public closes and research levels visible.
- **Needs attention** is renamed **Plan/data checks**. The UI explains that these are missing/stale inputs, plan review dates and concentration checks. No automatic assessment of company deterioration, moat quality or breaking news is claimed.

The Command Centre remains a deterministic rules engine. The current personal research workflow references Firebase, market-data and SEC configuration, and has no AI-provider integration. Ongoing AI-assisted company/thesis/news analysis remains a separate layer requiring appropriate filings/news sources and a personal provider credential stored server-side in the existing personal worker, never in public frontend code. No AI key, paid resource or new service was provisioned in this change.

Validation of this iteration: 292 Node tests pass, including exact FX quantity boundaries, custom-price eligibility, direct quantity edits, resizing within stage allowances, native/SGD currency formatting, public-only privacy output, hidden cost bases and compact form structure. Mounted DOM checks cover the actual entry/quantity fields, estimates, save/reload, optional settings, remarks and privacy transitions. Device-level browser layout and signed-in cloud interaction were not exercised.

## Allocation by support restored in Plan settings (14 November 2026)

Plan settings now shows the budget rule and an allocation table for each support: entry price, rule allocation, full stage allowance in SGD, current available capacity and maximum whole-share quantity. The selected support is highlighted. Its calculation shows available SGD divided by FX-adjusted cost per share, then order-increment rounding, with a separately chosen smaller quantity identified. Anchor explains the total addition budget divided across its supports; Core and Selective retain their own schedules and company caps. Actual fills, completed stages, current cash/room constraints and frozen stage allowances remain explicit. All rows are independent previews, not reservations. This is presentation only; sizing rules, saved data and the two-row editor are unchanged. Privacy mode excludes the breakdown.

Validation: 295 Node tests pass, including a synthetic four-support Anchor example (equal stage budgets, FX conversion and whole-share rounding), category-specific schedules, selected price/quantity changes, completed stages and missing inputs. Mounted DOM checks cover live breakdown updates and removal in privacy mode. Deploy/recovery uses the existing personal GitHub Pages repository; revert this presentation change to roll back.

## Mobile overflow containment (14 November 2026)

The allocation grid uses zero-minimum fractional tracks and shrinkable cells so long labels cannot widen the document. Its filter groups wrap within the section. Plan settings and every ancestor of the support table have explicit zero minimum widths and viewport-bounded maximum widths; its mobile settings track uses `minmax(0,1fr)`. The SL table alone scrolls horizontally within its constrained wrapper. Facts and explanations can wrap. No global overflow hiding is used, and other dashboard sections are unchanged.

Validation: existing 295 Node tests, mounted plan/SL-breakdown interaction checks, compiled-JS syntax, CSS parsing and diff checks pass. Local Chromium rendering is unavailable because this environment denies its process-singleton socket, so physical Safari layout was not exercised. Cache versions refreshed for the changed stylesheet and dashboard bundle. No data, sizing, credentials or infrastructure changed; rollback by reverting this presentation fix.

## CC-only cash allowance and Watchlist consolidation (14 November 2026)

StocksCafe remains the master record. The new `cashUsage` map lives only inside `settings.investmentStrategy` in the existing private performance document. It never writes portfolio cash balances, holdings, trades, performance flows or ledger transactions.

- New purchase fills charge only the newly recorded spend. Cumulative stage edits use the delta; marking completion without additional spend adds no deduction. Closing a recorded order replaces its reservation with actual cash used, releasing the unused reservation. Cancellation is for orders with no fills.
- Available CC cash equals imported broker cash plus bank cash committed to the strategy, less liabilities, other unavailable cash, pending CC order reservations and unreconciled CC cash use. Purchase cash use does not invalidate confirmation just because a fill was recorded, allowing other buys between 1–3 month imports. Freshness/IV/rule gates still apply.
- Unreconciled company spend also consumes that company's remaining purchase room. Imported holdings, average costs and current allocation stay unchanged. Planning projections include the outstanding cost commitment, with an explicit pending-import label. No interim holding quantity/value overlay is created.
- A change to the Cash import basis pauses purchase sizing while CC asks which cash-use records the imported StocksCafe balance includes. Included records become `reflected` and stop being deducted. Unselected records carry forward against the new basis. Retirement-only imports do not reset Cash adjustments. Inclusion is explicit, never inferred from matching quantities or cash differences. Retrospective fills dated on/before an existing import can also be confirmed included; same-day inclusion still requires the user's actual check. Manual cash corrections cannot clear these records as a StocksCafe import.
- Earlier history-only fills are not charged retrospectively. If detected, a one-time opening cash confirmation asks the user to include any still-unimported earlier spending under Other unavailable cash. `cashTrackingVersion:1` records this review. All records and statuses survive dashboard backups and the existing cloud version-precondition protection.
- The former standalone Watchlist table/Research view is now owned by CC's Watchlist tab. Existing tickers, manual overrides, categories, table preferences and AK settings keep their existing storage paths. Shared Refresh prices covers holdings and watchlist; AK sync remains in Research. The embedded Watchlist is outside the CC-specific styling scope to preserve its table/toggle appearance and is hidden in privacy mode.
- Per-ticker bell/email/cooldown/reset controls, the Alerts navigation/page, test-email sender and email/alert Settings panels are removed. Settings → Data retains the price provider key. The repository's legacy daily/support alert schedules and delivery scripts are removed. No external Boost workspace, Dive Deals infrastructure or stored secret was accessed/modified. Research and performance data workers stay in place.

This initial consolidation covered purchase-cash budgeting and legacy notification cleanup. Its Watchlist table placement and Buy-only plan scope are superseded by the action/view changes below.

Validation: 306 Node tests pass, including cash-only deductions, cumulative fills, reservation settlement, company-room caps, import inclusion/carry-forward, retrospective fills, one-time legacy review, backup recovery and corrupt/duplicate records. Mounted DOM flows cover plan/order/fill, unchanged master state, cash reconciliation after import, Watchlist navigation and privacy. Physical browser layout/signed-in live cloud writes were not exercised. Existing personal GitHub Pages/Firebase only; no new credentials, services or infrastructure. Rollback restores UI/notification code but saved cash-use data remains available in backup; an older frontend will not apply its deductions, so review planning cash before reverting.

After deployment, refresh every open dashboard tab/device before recording new fills, so older cached clients cannot use the previous cash calculation.


## Watchlist cards, latest decisions and explicit actions (15 November 2026)

Watchlist is now the opportunity-card view of every tracked ticker, including deferred/dismissed/Hold tickers. Add requires only ticker and Category. Symbols are normalized and duplicates rejected. Tracking an existing holding inherits its ticker category; the six-Anchor limit still applies. Add/remove and category membership save to the existing personal portfolio document. Removal keeps official holdings and saved plan/fill history.

My decisions is a horizontally contained table with one latest saved plan per active ticker: Ticker, Company, Action, Close, weighted Avg Price of active Cash holdings, BValue for a planned sale, IV, Ref cost, Current SL and Notes from plan remarks. Tickers open the plan editor. Category filtering/ordering and persistent show/hide columns apply. Earlier decisions and pending-order settlement remain in a separate history disclosure. Research/AK sheet settings remain in a disclosure below Watchlist cards, with independent research column settings; the old Watchlist position table is removed.

Plan actions are explicitly Buy, Sell or Hold. Existing plans without an action remain Buy. Buy sizing, stages, cumulative fills, reservations and import reconciliation keep their existing rules. Sell validates the planned quantity against active imported Cash holdings, supports a partial sale and estimates proceeds at the planned sale price. BValue is those conditional proceeds in market currency with SGD information; it is not cost basis or a booked balance. Completed sales can be marked to exclude their estimate until StocksCafe updates official cash/holdings. Hold requires a future revisit date and never creates a purchase preview. When that date arrives it becomes a Plan/data check, even if alert timing was deferred. No scheduler, email delivery or broker action is introduced. Defer remains a separate timing decision and does not change Buy/Sell/Hold. Action changes preserve earlier purchase stages and fills; resolve pending orders before changing the action.

Potential cash after planned sales = current CC available cash + valid conditional sale proceeds. Pending sales are not spendable cash and cannot fund a committed purchase reservation. Each active ticker's latest sale plan is counted once, using only its planned quantity; retirement shares are excluded. Missing FX estimates are excluded and flagged. Official StocksCafe holdings, balances, ledger and performance are unchanged. Subsequent imports and the existing purchase-spend reconciliation remain the authority.

IV/support defaults still resolve per component: explicit plan or existing manual overrides, then compatible AK sheet values, then available independent calculations. New tickers start without numeric overrides. Plan settings allow editing IV, S1–S5, Ref cost and currency; clearing IV/SL values returns to automatic resolution, without pinning a research snapshot. Ref cost is optional and manual when no source value exists. Research continues to resolve names/currency and request calculations for additions.

Validation: 316 Node tests pass, including partial sales/conditional cash, Cash-only average cost, inherited categories, AK fallback/override reset, Hold due dates, action switching with retained fills, immutable review snapshots and privacy. Mounted DOM checks exercise add/remove cards, Buy/Sell/Hold persistence, table navigation, default Anchor budgets and unchanged master records. Synthetic browser checks verified three desktop cards, the latest-decision table, a compact Sell editor and a narrow mobile iframe: table overflow stays inside its wrapper and expanded Plan settings do not widen the document. Signed-in production data writes and physical iPhone Safari were not exercised. Existing personal GitHub Pages/Firebase only; no new credentials, paid resources or business infrastructure. Rollback by reverting this commit; saved action fields/overrides remain in backup and older clients cannot interpret them safely, so refresh all open dashboard tabs/devices after deployment.


## Action queue, Plan set and compact controls (15 November 2026)

Opportunities separates open, price-triggered items from saved plans. The Plan set disclosure starts collapsed and retains fills/order controls. A saved current plan is not an open opportunity merely because price remains at its reviewed entry. Changed category/IV/supports/currency, an overdue Buy review, a due Hold revisit or a deeper unused stage relative to the planned entry reopens review. Above-ceiling/above-IV items remain actionable in the queue even when a plan is saved. No saved data, fills or reservations are reset.

The main review count is unique tickers with explicit allocation, valuation or due-plan reasons. Allocation above the current effective ceiling is checked for every active Cash holding, including Sell/Hold and no-plan tickers; the ceiling respects both a lower approved limit and the current category cap. Price strictly above IV is checked on fresh quotes. Being below a ceiling and lacking a plan is not itself an action. Missing/stale quote, IV, supports, category or FX goes into a separate collapsed Setup / data group. A distant unplanned ticker remains monitoring. Price-reached observations appear as open opportunities when a current plan is still needed and allocation/valuation do not block adding. Above-IV or over-ceiling tickers go to checks rather than the open buy list. Explicit card labels and Price reached / Nearest entry sorts explain placement; priorities put allocation and valuation issues first. The summary's Actions requiring review and Open opportunities tiles navigate directly to those views. These counts cover stocks in the current Cash universe, not an unimplemented retirement/AI monitoring system.

Cash available now uses the known funding display values even when stock quote freshness blocks executable sizing. Potential cash incl. sales = max(0, broker + strategy set-aside cash − liabilities − other unavailable cash − pending CC orders − unreconciled CC purchase spending + planned selling BValue). Sales first cover any cash shortfall. Conditional proceeds cannot fund committed buy reservations. StocksCafe remains the master for holdings, cash ledger and performance; no automatic trade/cash entry is created. Verbose strategy rules and portfolio/cash basis are collapsed separately.

Watchlist has a compact Add ticker button opening a native modal with only ticker and Category. IV, S1–S5 and Ref cost share one desktop row and wrap on narrower screens. Currency is inferred from the listing/holding/research/quote and is no longer a plan input; obsolete plan currency overrides are ignored. Numeric IV/support overrides and their automatic reset behavior are preserved.

Validation: 326 Node tests pass, including saved-plan grouping/reopening, no-plan monitoring, above-IV/ceiling checks across actions, lower category caps, conditional cash after liabilities and commitments, stale quote display, modal markup and sorting. Mounted DOM checks exercise plan actions, table navigation, Watchlist mutations, privacy and unchanged master balances. Synthetic browser checks verified collapsed Plan set, action queue, popup addition/cancellation structure, all seven desktop numeric fields sharing the same row, and mobile document/popup containment. Physical Safari and signed-in production writes were not exercised. Existing personal GitHub Pages/Firebase only. Refresh open tabs/devices after deployment; rollback is a normal code revert with saved plans/fills left intact.

If a saved Sell plan used a different currency from the current trading listing, CC requires re-entry/review of its sale price and excludes its conditional proceeds in the meantime. A currency change never silently reinterprets an approved sale amount.


## Five workflow tabs and exclusive saved decisions (15 November 2026)

The current CC tabs are Opportunities, Watchlist, Rebalancing, Data review and My decisions. Action queue, All monitored and Plan set are removed. Opportunities contains existing Cash holdings at support or within 5% above the planned support, with the approaching threshold explicitly labelled. Watchlist contains additional tracked tickers with no current Cash holding. Rebalancing contains holdings above IV or the effective company ceiling. Data review contains missing, stale or inconsistent inputs (including an invalid support ladder), not absence of a plan, being underweight, a distant support or an overdue thesis review alone. Cards display overlapping memberships and put data warnings before plan setup.

Any saved plan exclusively belongs in My decisions, regardless of its source or subsequent price/input changes. Subsequent data and review warnings are displayed in that table rather than repopulating other tabs. Imported holdings and watchlist membership are retained; presentation filtering does not delete data. There is no requirement to save Hold for every distant holding. Manual defer/dismiss timing remains separate.

My decisions includes Next SL (following the current support), planned Quantity and Entry / sale price. Buy/Hold/Sell checkbox filters support any combination, including none. Hold has no planned trade quantity/price. Purchase-stage fill forms remain available below the comparison table, alongside retained decision/order history. Cash sizing and StocksCafe reconciliation are unchanged.

Validation: 326 Node tests pass with revised exclusive-view semantics, support proximity, data-versus-plan distinction, rebalancing overlap, combined action filters and planned execution columns. Mounted DOM tests cover all actions, table navigation, popup mutations/refresh preservation and privacy without modifying master balances. Browser layout was not re-exercised for this tab/table update; existing mobile containment rules are retained. Existing personal GitHub Pages/Firebase only. Refresh open tabs after deployment; a code revert restores presentation without deleting saved plans or fills.


## Support boxes and centred Holdings toolbar (15 November 2026)

The desktop Holdings Positions/Research switch is centred relative to the header, with the gear beside it rather than included in the centring width. Existing compact mobile positioning remains. Allocation by support uses horizontal boxes, each showing Support price, Planned entry (limit), rule allocation, stage allowance, available cash and maximum shares. Selected/completed states remain visible. Boxes scroll inside the existing bounded wrapper on mobile. A lower IV-capped entry or saved/edited entry is labelled explicitly; a planned limit is not a live quote. Current price now precedes category/IV/supports in Plan settings.

Validation: 327 Node tests pass, including a synthetic IV-cap example distinguishing support from planned limit. Syntax/diff checks pass. Browser layout was not re-exercised for this presentation update. Existing personal GitHub Pages only. The proposed Anchor gap-down reallocation rule is not implemented: user will revise Notion first. Current frozen budgets, recorded fills, reservations and sizing are unchanged.


## Explicit all-category gap-down redistribution

The personal Notion Game Plan Buying rules now includes the all-category redistribution exception. In dashboard Plan settings, select the starting support, check Redistribute remaining budget and enter the remaining SGD budget (default: current room under the ceiling). Review the boxes and save the plan. Anchor divides across remaining uncompleted supports equally; Core retains relative 1:1:2 original weights among remaining supports; Selective creates independent 2–4% proposals, not additive commitments. Higher unfilled stages become skipped with zero unused allowance; partly filled stages retain recorded spend and completed stages remain completed. Pending company orders block redistribution.

A shared redistribution pool records the newly approved remaining budget and spending baseline. Subsequent fills reduce the pool across every remaining stage, preventing Selective independent allowances from exceeding the shared approved total even if company room later grows. Ordinary reviews preserve the pool and frozen allowances; no price change automatically rebases. Existing IV/support, cash and ceiling limits still apply. Reallocation clears stale per-stage quantity/budget overrides for uncompleted stages; the selected entry/quantity is reviewed and saved again. Review history snapshots include redistribution metadata and skipped states. No ledger/holding/broker mutation occurs.

Validation: 332 Node tests pass, including equal/weighted allocations, partial/completed fills, pending-order rejection, cumulative Selective pool caps and unchanged budgets through ordinary reviews. Mounted DOM checks cover explicit redistribution preview/save, persistence across ordinary review, all plan actions and unchanged master balances. Browser layout was not re-exercised for this settings control. Existing personal GitHub Pages/Firebase only; refresh open dashboard tabs after deployment. Code rollback retains saved history but older clients do not enforce the new pool, so planning must be reviewed before rollback.


## Plan research controls, AK reference cost and manual rebalancing

Ref cost means AK average cost from capital-gains/dividend active sheets for Buy/Hold, or AK average sell price from the closed-positions sheet for Sell. Sheet parsing/import/retention now carries both facts. Closed positions is an optional fifth source with its own configured Google sheet/tab URL; it does not replace or conflict with active valuation/support references. A missing, conflicting or currency-incompatible price stays unavailable, with an explanation. An explicit plan Ref cost override still wins; unrelated legacy row values are not treated as verified AK costs. Existing references need a new Sync AK sheets to acquire the newly parsed fields.

Holdings Research replaces its Watchlist checkbox with a reversible CC Rebalancing flag, persisted independently under settings.rebalancingSymbols. It never creates Watchlist membership. The flag targets active Cash holdings and is masked/disabled in privacy mode. An explicit flag is the deliberate exception to saved-plan exclusivity: a saved ticker can reappear in Rebalancing while retaining its plan in My decisions. Saving the reviewed plan clears the manual flag; failure to clear is surfaced and can be retried by unchecking in Holdings. Automatic warnings alone still do not repopulate other lists for saved plans. Flag state survives cloud serialization and dashboard backups.

Remove the legacy Watchlist research-table disclosure. The company Plan settings now contains the AK-first/independent source selector, IV-method family selector and recalculation action, IV/SL processing/comparison statuses, source explanation and numeric overrides. Source choices are saved with the plan, while method requests use the existing private research worker. Active manual IV/SL values take precedence until cleared. Global AK sync/link controls remain immediately below the company-plan area in CC Watchlist, without a second table or legacy heading. Holdings Research retains its detailed calculation/editor view, plus an AK Ref cost column based on the latest saved action.

Validation: 350 passing Node tests and mounted DOM flows for plan source/status/method requests, explicit rebalancing review clearing, action/redistribution persistence, popup mutations, privacy and unchanged master balances. Tests include active-versus-closed price parsing, reference isolation, missing/conflicting prices, manual override, saved-plan exceptions, backup and production serializer round-trip. Browser layout and signed-in production writes were not re-exercised. No new infrastructure/credentials; personal GitHub Pages/Firebase only. Refresh open tabs after deployment and sync the sheets to populate newly imported AK cost fields. Closed-position average sale prices require the optional closed-positions feed to be configured. Code rollback preserves stored flags/reference facts/plans.

### Compact company plan settings — 15 November 2026

New Buy entry prices default to the latest current quote. Existing saved Buy prices remain intact when reopening a plan. Changing support or action resets the draft price to the current quote; support/IV validation and stage/cash caps still apply. The editable quantity is in whole shares; the increment field is removed and newly saved Buy plans use an increment of one.

Company ceiling, level source and IV method share a desktop row. Review/redistribution checkboxes align inline, with the redistribution instruction bold. Current price replaces portfolio base in the plan fact strip, between room below ceiling and IV; the repeated category/price/support sentence is removed. Support boxes omit planned entry and available-now fields while retaining support price, allocation, stage allowance and maximum shares, plus the selected-stage calculation explanation.

Saved plans are exclusive to My decisions even if a persisted Holdings Rebalancing checkbox remains checked. Explicit review saves still clear that checkbox. The review count follows this same exclusion. This supersedes the previous manual-flag exception that reopened saved plans.

New Hold plans default to one calendar month from today in Singapore. 1M and 3M shortcuts use today as their basis, clamp month ends, and leave existing saved revisit dates intact until edited.

Validation: 351 Node tests and the mounted action-form interaction harness pass, covering current-price defaults, removed inputs, shared settings row, calendar shortcuts, save/reopen behavior, Rebalancing exclusion and unchanged imported master records. Browser layout and signed-in writes were not exercised in this iteration.

### Plan clarity and visible opportunity totals — 15 November 2026

The Anchor addition budget now shares a desktop row with ceiling, level source and IV method. The source/status line names the displayed support source as AK, Independent or Manual; mixed sources are named per support. The holding/room/current-price/IV facts precede the numeric override inputs. The approval checkbox has a separate associated label in a fixed aligned control, avoiding generic stacked field-label rules.

Open opportunities count only visible unsaved opportunity cards, excluding dismissed/deferred rows, and follow the selected category filter. The summary distinguishes price-reached from approaching-support counts; approaching cards no longer say price reached or monitoring. Rebalancing and data-review model counts also exclude suppressed rows. Saved plans stay exclusive to My decisions.

Validation: 353 Node tests pass, including suppression/category/count consistency and source labels for mixed overrides. Mounted-form checks cover the new desktop field grouping, fact-strip ordering and label association. Full browser layout remains unverified.
