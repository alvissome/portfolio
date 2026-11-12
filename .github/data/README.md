# Public SEC ticker catalog

`sec-company-tickers.json` is the **entire** official SEC ticker catalog, with
no holdings/watchlist selection or portfolio information. Its companion
`sec-company-tickers.meta.json` records the source, UTC retrieval time, record
count and SHA-256 of the exact downloaded bytes.

The research adapter uses this only when retrieving the live ticker index
fails. The original provider failure remains visible in private diagnostics.
This file only supplies the ticker-to-CIK lookup: the worker must still obtain
current `data.sec.gov` submissions, verify the exact ticker and domestic 10-K
basis, and verify current ordinary-share and currency inputs. The snapshot
does not certify any share denominator or supply a valuation.

The loader rejects future-dated, over-45-day-old, malformed or checksum-invalid
snapshots. To refresh from the one official source:

```sh
node .github/scripts/update-sec-ticker-catalog.mjs
node --test tests/sec-ticker-catalog.test.js tests/research-data.test.js
```

Review and commit the catalog and metadata together. A denial or failed source
request stops the refresh; the script does not retry through another route.
Refresh before expiry as part of monthly research upkeep. If current issuer
submissions are also unavailable, keep IV unavailable and inspect the private
provider diagnostics. Do not turn a cached lookup entry into a verified flag.
