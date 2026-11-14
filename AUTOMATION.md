# Personal portfolio data workers

Legacy watchlist email/support alerts and their manual/scheduled workflows have been retired at the owner’s request. The dashboard Alerts guide/link, per-ticker notification/email/cooldown controls, test-email sender and email-alert Settings tabs are removed. Existing inactive cloud settings/secrets are not used or altered.

CC owns the Watchlist/Research view and shared price refresh. Data settings retain the existing Twelve Data key. AK sheet sync and reference settings remain in Research. Research calculation and performance-snapshot workflows remain independent and unchanged.

`monthlyReportRenderer.js` remains a generic reference renderer, not a scheduled job. No external Boost workspace, shared Dive Deals resource, secret or credential was accessed or modified. This change retires the repository’s legacy alert senders; it does not silently alter separately hosted automations.

CC cash-use records are private planning deductions in the existing investment settings. They never post portfolio cash-ledger transactions or mutate StocksCafe holdings/cash balances. StocksCafe remains authoritative after imports.
