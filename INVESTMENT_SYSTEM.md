# Investment decision preview

Personal environment: `alvissome/portfolio`, existing GitHub Pages frontend and existing signed-in Firebase project. No new hosting, credentials, public endpoints or paid services. No Dive Deals infrastructure is accessed.

## Rules captured on 13 November 2026

Source: https://app.notion.com/p/93744bdaa1b54851bf51e01edd17d87a and the user's subsequent clarification.

- Core: GOOGL, META, AMZN, MSFT, NVDA, SPGI. Equal nibbles across all approved supports; only the intended additional budget is split for existing holdings. Normal purchase ceiling is 10% per company.
- Other companies: 2.5% + 2.5% + up to 5% of the strategy base, at the deepest three approved supports. Each company requires an explicit ceiling; 10% is not assumed.
- Suggested spend is capped by the saved stage's unused budget, current room below the company's ceiling, and available committed cash after liabilities and pending orders.
- Stage budgets freeze in SGD at approval. Monthly reviews update IV and support prices but retain permanent stage IDs, budgets and actual fills. A change to the number or keys of stages stops automatic plan revision.
- Completed stages cannot be reset. Actual cumulative spend cannot be reduced through this interface. Correcting an erroneous fill needs a separately reviewed correction rather than silently restoring purchasing capacity.
- All values are previews requiring user review and execution. Being below a support is not evidence of a fresh crossing; this panel does not emit alerts.

The Notion buying table still labels the deeper schedule as a core alternative and assigns other holdings two buys of 2–4%. Replace those two rows with one **Other companies** row using the deepest-three-support schedule above. The page was read but not edited.

## Funding

The frontend reads cash holdings, current cached prices, FX, broker cash and bank money set aside from the existing dashboard state. It excludes retirement accounts. The user confirms that all displayed broker/bank cash is committed, enters related liabilities and pending orders, and reviews holdings and FX. Cash or quantity changes invalidate the saved confirmation. Pending orders reduce cash available, not the strategy portfolio base. Liabilities are counted once in each relevant measure.

The panel cannot infer future contributions, reserved money outside the dashboard, CPF OA investable funds, or unrecorded liabilities/orders. Bank cash may need transferring before execution. Import changed holdings and cash after a fill before confirming funding again.

Retirement is lump-sum investing, deferred at the user's request. Existing SRS/CPF investment cash can later be reused as recorded inputs, with account-specific investable-fund confirmation.

## Data, recovery and integration

- Pure calculations: `assets/investment-strategy.js`.
- UI: `assets/investment-panel.js` and `.css`, inserted beside the existing performance panel through the established compiled-dashboard extension pattern.
- Saved configuration, plans and fills: `users/{uid}/portfolio/performance`, field `settings.investmentStrategy`. Writes replace only this field; unrelated history/settings are preserved. Authentication must match the UID before saving.
- Dashboard-wide backup already exports the performance document, including this settings field. Restore includes it and reloads the frontend. Unit coverage verifies the round trip.
- No broker secrets or Telegram tokens are used. No orders, emails or Telegram messages are sent by the panel.
- Core membership is a versioned snapshot of the game plan; live Notion synchronization is not implemented.
- Existing support monitoring additionally checks Saturday at 08:00 Singapore time so Friday's US close is included. This change preserves the existing weekday checks and delivery mechanisms; it does not add purchase amounts to existing alerts.
- Rollback: revert this change to remove the panel and restore the earlier schedule. Existing saved strategy data remains available in backups; no financial history is deleted.

## Limits and next integration

This version covers share plans, not LEAPS or short-option legs. Combined share/options exposure and LEAPS commitment sizing must be added before using this engine for option decisions. The broader 60/25/15 buckets remain review references; aggregate bucket caps are not enforced in this preview. CSPX remains review-only until explicit entry/amount rules are configured.

The panel blocks amounts for missing funding confirmation, missing/stale quotes (including cache older than four days), missing FX, changed/unreviewed IV, a thesis/IV review older than 31 days, or a changed support ladder. Review dates are user attestations, not automated fundamental checks. No independent news-clearance claim is made. Final-stage buys explicitly ask for another thesis/IV check.

Multiple previews share a cash pool. Each is individually capped; aggregate overcommitment is flagged, but cash is not reserved until the user updates pending orders. Server-side crossing detection, a consolidated decision queue with reservations, concurrency protection between simultaneous editing devices, LEAPS sizing, and dedicated personal Telegram delivery remain subsequent work.

## Validation

Run `npm test` and `node --check assets/index-CUEh86Kk.js`. Unit coverage checks schedules, cash separation, ceiling/cash/stage caps, deepest eligible stage selection, fill persistence, monthly review gates, unit rounding, manual level precedence, funding invalidation and dashboard backup recovery.

A browser interaction harness was attempted locally. Chromium could not launch because this execution environment denies its singleton socket. Live signed-in Firebase writes and visual browser interaction are therefore not verified; keep the change as a draft until reviewed before deployment.
