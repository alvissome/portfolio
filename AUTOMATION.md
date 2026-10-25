# Alerts and reports

The dashboard's Alerts link opens a public guide. Current run status and private delivery records are available only in the signed-in automation accounts. No connection keys or private resource identifiers belong in this guide.

- Support-level settings are edited in the portfolio watchlist. Scheduled checks use daily closing prices and suppress repeated alerts until recovery, subject to the configured cooldown.
- Peak-drop monitoring compares the last validated daily close against a rolling 365-calendar-day peak.
- Monthly reports are sent on the 10th using the last available close on or before the 9th. The rolling peak ends at that cutoff, excluding later prices. Change since the prior month's 9th excludes dividends, fees and FX effects.
- Daily alerts remain silent when no condition triggers; failures notify where the sending service is available. Monthly reports are sent even when no threshold is breached.
- The old DCA spreadsheet is retained for reference; scheduled collection and sending from its runner are retired.

`monthlyReportRenderer.js` preserves the generic HTML renderer and price-validation logic. It is a source reference for the automation, not a standalone scheduled job. Do not commit private configurations, account resource identifiers, keys, webhook endpoints or portfolio exports.
