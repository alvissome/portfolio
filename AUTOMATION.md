# Personal portfolio data workers

Legacy watchlist email/support alerts and their manual/scheduled workflows have been retired at the owner’s request. The dashboard Alerts guide/link, per-ticker notification/email/cooldown controls, test-email sender and email-alert Settings tabs are removed. Existing inactive cloud settings/secrets are not used or altered.

The new Command Centre alert worker below implements the owner's subsequent request. It does not restore the legacy senders or use their inactive credentials.

CC owns the Watchlist/Research view and shared price refresh. Data settings retain the existing Twelve Data key. AK sheet sync and reference settings remain in Research. Research calculation and performance-snapshot workflows remain independent and unchanged.

`monthlyReportRenderer.js` remains a generic reference renderer, not a scheduled job. No external Boost workspace, shared Dive Deals resource, secret or credential was accessed or modified. This change retires the repository’s legacy alert senders; it does not silently alter separately hosted automations.

CC cash-use records are private planning deductions in the existing investment settings. They never post portfolio cash-ledger transactions or mutate StocksCafe holdings/cash balances. StocksCafe remains authoritative after imports.

## Personal Notion export

My decisions queues the selected ticker in the signed-in user's investment settings. The existing portfolio research workflow checks the queue on its scheduled runs. Configure the repository Actions variable `NOTION_PORTFOLIO_UID` with the owner's Firebase Authentication UID from the alvissome-portfolio project. Set the Actions secret `NOTION_PORTFOLIO_TOKEN` to a dedicated personal Notion internal connection token with read, insert and update content access to Stock plans by ticker. The destination data source is fixed in syncNotion.mjs. The site receives no Notion credentials. After enabling the connection, click the ticker's sync button again to retry a failed export. Repeat exports update dashboard-managed properties while leaving page notes intact. Remove the token to stop writes.

## Command Centre email alerts

Location: this personal GitHub repository's `Command Centre alerts` workflow; state/outbox are private documents under the selected owner in Firebase project **alvissome-portfolio**. No VPS, Dive Deals, Boost workspace, business sender or laptop service is involved. No new paid resource is provisioned.

When there are new events, the worker sends a single digest for the Singapore calendar day, with one section per ticker. Quiet days send no email. The daily check starts at 05:17 Singapore time (21:17 UTC the previous day). The worker hands eligible digests to Resend for 08:00 Singapore delivery. If the worker runs too late to schedule delivery, it sends the current day's digest immediately. GitHub may delay or skip scheduled jobs. Yahoo Finance supplies the actual SPX index (`^GSPC`), regular-session ticker quotes and ticker RSS headlines. Only listing identifiers are sent to the quote/news provider. The email provider receives the selected recipient and alert content: public ticker prices, support observations, SPX context and headlines. No positions, quantities, costs, balances, account details or decision remarks are emailed or logged. Public Actions logs contain counts only. Dependencies are the existing Node 22/firebase-admin worker environment; no AI API is needed.

Definitions:

- SPX uses completed daily closes. 20/40 EMA and 50/150 SMA require both averages to slope in the alignment direction over **five completed sessions**. A crossover without confirming slopes remains pending. A later slope confirmation alerts even when there is no new crossover. Price above/below the 200 SMA is combined with that average's five-session slope. These numerical slope choices are explicit implementation filters, not claims about an exact universal AK rule. The first market reading sets a baseline without a historical trend-change email.
- Peak distance means percent below the **highest closing price in the trailing 52 calendar weeks**, not an intraday peak or all-time high. It accompanies the market callout and every alert; no extra drawdown threshold is assumed.
- The universe is the same unique Cash-holdings plus Watchlist set used by CC, including rows with saved Buy/Sell/Hold plans. Historical inactive/archived plans and CPF/SRS-only holdings are excluded. Membership, listing currency and supports are rechecked transactionally before queueing. Removed tickers and changed support prices cancel obsolete queued messages.
- Support resolution uses CC's plan overrides → Watchlist overrides → AK reference → independent fallback, including the existing listing/currency checks. All displayed supports are monitored; these observations do not approve a purchase. Approaching means **within 5% above the nearest unbreached SL**. Each price has one approach and one hit notice for the lifetime of its listing/currency/price identity; recovery or rung relabelling does not re-arm it. A revised numerical support is a new identity. Already breached levels on first observation are baselined quietly. Gaps through several supports are grouped in one hit event.
- Daily declines use the regular-session quote against the preceding completed exchange-session close. **More than** 3% alerts once per exchange trading date; more than 5% can escalate once. A first reading beyond 5% generates only the larger alert. Pre/post-market quotes are excluded. Quotes older than four calendar days or in a different currency are rejected. After a detected split, support alerts stay paused until the support ladder changes for review; same-day drop alerts are skipped.
- Drop emails include up to three ticker-feed headlines from the preceding 36 hours, with links and timestamps. They are related coverage, not a confirmed explanation. Feed failure leaves the price alert intact and is labelled explicitly.

Deployment/activation requires the owner's approval. Configure only this personal repository:

| Setting | Location | Value |
| --- | --- | --- |
| `PORTFOLIO_ALERT_UID` | Actions variable | Owner's personal Firebase Auth UID; defaults to the existing personal NOTION_PORTFOLIO_UID when unset |
| `PORTFOLIO_ALERT_TO` | Actions secret | Owner's explicitly selected personal delivery email |
| `PORTFOLIO_ALERT_OWNER_EMAIL` | Optional Actions secret | Owner's Firebase Auth email when different from the explicitly approved delivery address; worker verifies this identity against the selected UID |
| `PORTFOLIO_ALERT_FROM` | Actions secret | Sender allowed by the dedicated personal Resend account |
| `PORTFOLIO_ALERT_RESEND_KEY` | Actions secret | Dedicated personal send-only Resend key; never put it in code, chat, artifacts or client settings |
| `PORTFOLIO_ALERTS_ENABLED` | Actions variable | `true` only after dry-run and one live preview/test succeeds; otherwise delivery is off |
| `FIREBASE_SERVICE_ACCOUNT`, optional `FIREBASE_PROJECT_ID` | Existing personal Actions secrets | Retain existing personal worker identity; hard project check rejects every other project |

No verified sender domain is assumed. Resend's development sender can email only its account-owner address; verify that this matches the personal recipient before activation. If it differs, use a verified **personal** domain/sender or a dedicated personal account. Never verify or borrow a business domain for this task. Verify current free-plan limits before enabling, and do not purchase a plan automatically.

Run workflow dispatch `dry-run` first: fetch/validate data with **no writes and no email**, reporting counts only. Dispatch `run` with delivery still disabled to establish private baselines and populate the callout/status. Send the synthetic `examples/command-centre-email.html` preview through the intended provider/recipient, then enable the global variable. Verify private `ccAlertStatus` and the first provider acceptance; acceptance is not proof of inbox delivery. Check provider delivery status separately. The sample preview contains illustrative data only.

The dashboard loads `ccMarketContext` and `ccAlertStatus` read-only through the existing signed-in user's Firestore rules. No client-side email credentials or new public endpoints are introduced. Its Email alerts preference can pause delivery; paused checks advance baselines and cancel pending emails, so resuming does not send a backlog. Existing Firestore rules must permit the owner to read these sibling portfolio documents, as with tickerChart documents. Never weaken the rules to fix a permission error.

Recovery: the worker transactionally records immutable outbox content and durable support markers. Resend receives a deterministic idempotency key; retries reuse exact content. Ambiguous sends stop for manual review before the provider's 24-hour key-retention window expires, or after four attempts. Definite sender/configuration errors remain blocked for correction. Do not delete or reset alert state/outbox to retry: that can duplicate emails. Reconcile a `needs_review` message with provider activity before marking its outcome. Pending, never-attempted observations expire after 24 hours. Worker errors and stale inputs remain visible in Actions and the private dashboard status. To stop future scheduling, set the global variable to `false` or pause in CC. An email already scheduled with Resend can still send. To stop that email, cancel it in Resend; to roll back the UI, revert the reviewed implementation commit while retaining private deduplication records.
