# Data sources and trust model

## One health rule

`getSourceHealthSummary()` in `src/core/source-health.js` is the only backend aggregation rule. `/api/sources/status` returns both raw observations and this summary; the dashboard header, source detail panel, data-health card, and market-radar quality use that summary.

- `healthy`: the primary source works.
- `fallback`: the primary failed but an allowed fallback works. User data remains available, so it is not a red incident.
- `stale`: the source exceeded its metric-specific freshness window. It is red only when the source explicitly marks the stale state critical.
- `disabled`: intentionally unavailable functionality, such as liquidations. It is not an incident.
- `error` / `unavailable`: no usable primary or fallback. These are red incidents.

Source IDs and types are language-neutral. `src/provenance/source-definitions.js` owns the registry. Every normalized observation retains the legacy `value/source/dataTime/receivedAt/stale/confidence` fields and adds `sourceId`, `sourceName`, `sourceType`, `sourceUrl`, `updatedAt`, `freshness`, `calculationMethod`, `fallbackSource`, and a `provenance` object.

The user-facing matrix is at `/sources`.

## fuckbtc.com audit

Audit scope: HTML, JavaScript, Node backend, configuration, tests, and documentation. Search terms included `fuckbtc.com`, `fuckbtc`, URLs, miner tables, and calculation paths.

Classification: **B — an earlier static miner table contains model/specification values, with no attribution in the old code.** There was no repository reference, HTTP request, scraper, API call, iframe, or runtime calculation sourced from fuckbtc.com, so C and D were not present. AI-3.6 moved the table to the independent Crypto AI Miner Catalog and calculates economics locally. The application now has **no runtime fuckbtc.com dependency**.

The audit also found a holder-disclosure request to an unrelated personal Cloudflare Worker. AI-3.6 removed that runtime request and retains the last disclosed value with an official Strategy investor-relations reference until an official structured ingestion path is implemented.

## Holdings taxonomy

- A / `onchain`: verifiable public addresses; balances may represent customer assets and must not be treated as corporate treasury.
- B / `disclosure`: company disclosures and regulatory filings.
- C / `etf`: ETF/fund holdings. Category totals contain individual funds and cannot be added to them.
- D / `estimate`: research/estimation with lower confidence.

Never add overlapping categories into a single “total”. Each future record should carry `source`, `sourceUrl`, `updatedAt`, and `verificationType`.
