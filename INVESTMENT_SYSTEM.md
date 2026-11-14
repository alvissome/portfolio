# Investment decision preview

Personal environment: `alvissome/portfolio`, existing GitHub Pages frontend and existing signed-in Firebase project. No new hosting, credentials, public endpoints or paid services. No Dive Deals infrastructure is accessed.

## Rules captured on 13 November 2026

Source: https://app.notion.com/p/93744bdaa1b54851bf51e01edd17d87a and the user's subsequent clarification.

- **Anchor:** up to six selected companies. Equal nibbles across every approved support; only the intended additional budget is split for existing holdings. Normal purchase ceiling is 10% per company.
- **Core:** 2.5% + 2.5% + up to 5% of the strategy base at the deepest three approved supports.
- **Selective:** two buys at the deepest two approved supports, with each percentage explicitly chosen from 2–4% before approval.
- Core and Selective each require an explicit company ceiling; neither is implicitly classified by ticker or given a 10% ceiling.
- Suggested spend is capped by the saved stage's unused budget, current room below the company's ceiling, and available committed cash after liabilities and pending orders.
- Stage budgets freeze in SGD at approval. Monthly reviews update IV and support prices but retain permanent stage IDs, budgets and actual fills. A category or ladder change requires explicit plan review. Approval creates the revised schedule, keeps all actual fills, and archives stages no longer in the active schedule. Restoring a stage restores its previous fill status instead of reopening a completed buy.
- Completed stages cannot be reset. Actual cumulative spend cannot be reduced through this interface. Correcting an erroneous fill needs a separately reviewed correction rather than silently restoring purchasing capacity.
- All values are previews requiring user review and execution. Being below a support is not evidence of a fresh crossing; this panel does not emit alerts.

Category membership is selected through the **Buying category** column in Holdings or Watchlist, including their research views. Both use the same ticker-level map, so changing a category in either place updates the other, including after Track in watchlist. Unassigned tickers produce no purchase plan. Categories determine buying schedules independently of the allocation buckets.

Existing portfolios without the new field are seeded once with GOOGL, META, AMZN, MSFT, NVDA and SPGI as Anchor, reflecting the previously selected six. Users can change these choices in the dashboard. Explicit empty selections remain empty across reloads and imports. Selecting a seventh Anchor is rejected without replacing an existing selection. The Notion page is not used to maintain membership and was not edited.

## Funding

The frontend reads cash holdings, current cached prices, FX, broker cash and bank money set aside from the existing dashboard state. It excludes retirement accounts. The user confirms that all displayed broker/bank cash is committed, enters related liabilities and pending orders, and reviews holdings and FX. Cash or quantity changes invalidate the saved confirmation. Pending orders reduce cash available, not the strategy portfolio base. Liabilities are counted once in each relevant measure.

The panel cannot infer future contributions, reserved money outside the dashboard, CPF OA investable funds, or unrecorded liabilities/orders. Bank cash may need transferring before execution. Import changed holdings and cash after a fill before confirming funding again.

Retirement is lump-sum investing, deferred at the user's request. Existing SRS/CPF investment cash can later be reused as recorded inputs, with account-specific investable-fund confirmation.

## Data, recovery and integration

- Pure calculations: `assets/investment-strategy.js`.
- UI: `assets/investment-panel.js` and `.css`, inserted beside the existing performance panel through the established compiled-dashboard extension pattern.
- Shared category map: `users/{uid}/portfolio/data`, field `settings.strategyCategories`, serialized through the existing portfolio save path. It is independent of account-specific rows and imports, and is included in the existing dashboard-wide state backup.
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

Run `npm test` and `node --check assets/index-CUEh86Kk.js`. All 232 tests pass. Coverage includes rendered production table category cells and callbacks, category serialization, tracking inheritance, backup recovery, all three schedules, cash separation, ceiling/cash/stage caps, deepest eligible stage selection, fill persistence, monthly review gates, unit rounding, manual level precedence, funding invalidation and dashboard backup recovery.

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

The written Notion page is a reference. Changing it does not silently reinterpret the configured strategy. A rule change requires an implementation/configuration update and approval; each affected saved plan must then be reviewed. Categories are maintained in the dashboard's shared ticker map.

### Interface and decisions

`assets/investment-command-centre.js` builds opportunities and the decision journal from existing data. `assets/investment-command-view.js` renders summary counts, opportunity cards, attention/all-monitored views and My decisions. Cards use actual support prices, current/ceiling/projected company weights, SGD purchase amounts and native-currency entry prices. The interface distinguishes entry eligibility from incomplete review information; it does not claim a fresh crossing or an automatically verified business thesis.

Defer and Dismiss apply to the investment inputs at the time of the decision. Material input changes restore review visibility while retaining the old journal record. Deferrals expire on their chosen Singapore date. Existing fills remain authoritative even if their stage later moves into a plan's archived stages.

**Record pending order** records an order the user placed independently. It does not send a broker order. Its cash reservation reduces available committed cash for every other preview. External pending orders entered in the funding settings must exclude orders already recorded in My decisions, preventing double counting.

**Record cancellation** releases only the planner reservation; it does not cancel a broker order. **Record final fill** closes the reservation, adds actual spend to the original active or archived stage, and invalidates funding confirmation atomically. The user imports updated holdings/cash and confirms funding before another purchase preview. A pending-order stage cannot be filled through the legacy manual form without reconciling its order record.

### Safe cloud writes and recovery

All command configuration, decisions and reservations remain in `settings.investmentStrategy` on the existing personal performance document. Existing dashboard-wide backup and restore include them.

`assets/investment-store.js` reads/writes that field through Firestore REST using the signed-in Firebase user's ID token, held only in memory. Each masked commit checks the document's exact cloud update time. Stale tabs/devices cannot overwrite a newer decision or independently reserve the same stale cash state. A conflicting save requires reloading decisions and rechecking cash; an ambiguous network save also requires reload. No credentials, permissions, security rules, service accounts, hosting or public endpoints are created or changed.

The rest of the dashboard keeps its existing storage path. A performance-history update can legitimately invalidate an old Command Centre save version; reloading resolves it without overwriting unrelated data. No decisions are silently pruned. A 300 KB command-settings guard stops further additions with an export/recovery message before unbounded journal growth.

Validation: 250 Node tests pass, including quarterly replacement, remove/re-add, changed rules and levels, defer expiry, shared reservations, settlement into archived stages, Singapore dates, backup recovery and cloud version conflicts. A separate DOM interaction harness verifies mounted cards, order recording, cash reservation, final fill, quarter revisions, privacy masking and cleanup. The remote browser could not reach the local development server; visual layout and live signed-in cloud persistence remain unverified before deployment. This iteration is prepared as a draft for deployment approval.
