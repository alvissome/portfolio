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

The panel cannot infer future contributions, reserved money outside the dashboard, CPF OA investable funds, or unrecorded liabilities/orders. Bank cash may need transferring before execution. Import changed holdings and cash after a fill before confirming funding again.

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
