# IV and support-level validation

Status: draft Research views and tested validation foundation. No research
worker has been enabled by this change. There are no private holdings, watchlist
exports, subscribed sheet snapshots, API keys or account identifiers here.

## Product design

Keep Watchlist as the decision table. It already includes manual IV and S1-S5
columns and links Avg Price/BValue to holdings. This draft adds an optional
Research view in Watchlist and Holding Details. Positions remains the default
Holdings view. Research currently shows linked Avg Price/BValue/Close, blank
generated IV and supports, and separate Not started statuses with a single
worker-not-connected notice. Track in watchlist uses the existing add path,
preserves existing rows/notes/alerts and prevents a duplicate row. New rows have
alerts off. It does not create or change a holding.

The eventual results view should include method and as-of date, and reuse the
same per-security analysis in both tables. These are not connected in this
draft. All active account positions are deduplicated by security in Research;
existing Positions filters and account-specific rows remain in Positions.

In this app BValue is current position market value in SGD, not accounting book
value. Do not use it as a bank's book value per share in an IV calculation.
Avg Price is share-weighted native-currency cost across active accounts.

The requested end state is: saving a watchlist symbol requests analysis, a
worker acknowledges and processes it, and results arrive without blocking
price sync. Price sync remains the source for current daily close. Holdings
remain the source for quantity, average cost and market value. IV can refresh
after new financials/estimates; technical support can refresh from closing
price history. Label each output's own data date.

## Identity and private storage

The GitHub Pages repository is public application code. Current holdings and
watchlist records are private cloud data, with a browser fallback. Keep the
validation universe and reference snapshots out of public repository files,
artifacts, pull-request text and Actions logs.

Use one analysis record per exact listed security, shared by Holdings and
Watchlist. An instrument identity must retain exchange and trading currency;
ADR, Hong Kong and US listings cannot be silently conflated. Existing aliases
need an explicit reviewed mapping. Account positions remain separate.

The portfolio state serializer and scheduled alert worker write full watchlist
arrays. Research results must therefore live in a separate private collection,
with a result listener or bounded polling. An analysis worker must not rewrite
the portfolio's holdings/watchlist document. A result is attached only when
securityId, requestId and modelVersion match the current request. Retrying or
editing a symbol must not allow old work to overwrite a newer result.

The current source explicitly guards its personal portfolio project. Before
any worker deployment, verify the actual personal account, project, credential
scope, queue consumer, database rules and recovery path. No business resources
may be used. This draft neither deploys infrastructure nor changes permissions.

## Processing and validation are separate

Use separate IV and support statuses so one can finish while the other needs
data. A completed calculation is not a validated calculation.

- Processing: Not started, Blocked, Queued, Fetching data, Calculating,
  Completed, Partial, Failed, Unsupported.
- Validation: Experimental, Comparing, Provisional, Validated, No Adam
  benchmark, Needs review, Not applicable.

Do not display Queued/Fetching/Calculating unless an actual worker has
acknowledged the job. Missing data or a missing worker produces a specific
Blocked/Not started reason, not an indefinite spinner. Show last successful
output during refresh, with its date and a stale marker where applicable.
Timeouts and rate limits must end visibly with Retry available.

Keep independent output, Adam's reference, and the user's active manual alert
levels distinct. Existing alert checks read the active s1-s5 fields directly.
Do not auto-promote experimental research into those fields. A separate Use
these levels action can explicitly adopt reviewed values later.

## Priorities and references

Start with all non-exited holdings, then remaining watchlist symbols. Compute
owned/watchlisted securities even when Adam does not cover them; mark the
direct comparison as unavailable rather than inventing a match.

Check membership in all four reference lists and preserve every source label:

| Reference | URL |
| --- | --- |
| Capital gains portfolio | https://insight.piranhaprofits.com/uip/current_growth_portfolio/ |
| Dividend portfolio | https://insight.piranhaprofits.com/uip/current_dividend_portfolio/ |
| Priority watchlist | https://insight.piranhaprofits.com/uip/watchlist/ |
| Secondary watchlist | https://insight.piranhaprofits.com/uip/secondary-watchlist/ |

Preserve conflicts across lists and identify their dates/methods. Do not pick
whichever source happens to be closest to the model. Capture each list's own
update date rather than assuming all four are updated together. Reference
ingestion must use an authorized source and permitted access method; browser
sessions are not a dependable unattended data feed.

List membership does not determine the valuation formula. Validate DCF,
normalized DCF, discounted net income, banks' P/B, REIT NAV/income and other
supported methods separately. ETFs may have useful support levels and IV
marked Not applicable. Do not force a numeric IV or five support levels.

## Validation protocol

Separate (1) calculation arithmetic, (2) replication of dated IV/SL figures,
and (3) subsequent investment performance. Matching Adam's sheet establishes
neither predictive certainty nor improved investment returns.

Use immutable monthly reference snapshots with exact security, currency,
publication/update cutoff, model/method, financial statement and consensus
vintages, corporate actions, share-count convention and price adjustment.
Freeze independent output before inspecting a new month's published values.
Preserve raw input provenance and distinguish a calibration run from a true
holdout prediction. A model change restarts the affected holdout assessment.

For supports, distinguish all chart candidates, any stock-specific publishing
filter and entry confirmation. Do not impose a universal below-IV filter:
current reference evidence includes supports above IV. Retained broken levels
can still occur in the reference. Test incomplete weekly/monthly candles and
EMA seed conventions.
Compare levels one-to-one without reusing a predicted level. Report unmatched
published levels, extra predicted levels and order/spacing as well as errors.

Proposed initial acceptance gates, to calibrate and then freeze:

| Check | Proposed gate |
| --- | --- |
| Worked-example arithmetic | Match displayed precision |
| IV replication | Median absolute relative error <=5%; 90th percentile <=10% |
| Support replication | >=85% of published levels matched within 2%; also report 1% coverage |
| Extra/missing supports | Report both; no forced padding or silent omissions |
| Breadth | Aim for >=20 overlapping securities overall and every supported method family |

These are engineering acceptance proposals, not statistically proven universal
thresholds. Evaluate by month and model family, including failures and worst
cases. Count instrument-months, not five supposedly independent observations
for every stock. With fewer overlapping names, broaden benchmark-only tests
without changing the user's watchlist.

Three monthly snapshots can support a provisional release if the gates pass.
Prefer six snapshots for a first reliability assessment: three calibration
months followed by three untouched holdout months. With November 2026 as the
baseline, those six vintages are November-April; that means five new monthly
updates after the baseline. Three vintages means two updates after baseline.
Historical archived vintages may shorten calibration; prospective holdout is
still needed. An unchanged/older source vintage is not a fresh monthly test.
The calendar illustration assumes each relevant source actually updates.
Month count alone is not a pass, particularly if all months show
the same market regime or a model family lacks comparable securities.

For uncovered securities, distinguish validated method from no instrument
benchmark. Do not label the security itself Adam-matched by analogy.

## Implementation sequence and completion gate

1. Read the user's current private holdings/watchlist and map exact instruments
   to all four dated references. Do not infer holdings from repository examples.
2. Resolve a reliable OHLC and fundamentals/consensus feed; identify gaps and
   any subscription needs before committing to paid resources.
3. Add a private per-security request/result store and an acknowledged worker.
   Use the tested pure core for priorities, result identity and comparisons.
4. Add compact Watchlist/Holdings Research views, explicit adoption and visible
   partial/failure states. Preserve price sync and holding/account behavior.
5. Validate on the user-prioritized universe and retain monthly holdout results.

This draft implements Research switches, linked context, Track in watchlist,
and the pure validation foundation with tests. It does not populate generated
research or initiate jobs. No user should be told symbol entry already
triggers analysis until the worker, storage rules, data access and result UI
have been implemented and verified together.
