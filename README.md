# Crypto AI

Crypto AI is a Vue 2 dashboard with a small Node.js market-data backend. Phase AI-3 keeps the existing browser data path as a temporary fallback while adding traceable snapshots and rule-based anomaly events. It does **not** use an LLM and does not require a paid market-data key.

## Architecture

```text
Binance WS / Binance REST / OKX / CoinGecko / Alternative.me
                         ↓
                    adapters
                         ↓
       normalization → provenance → freshness → confidence
                         ↓
        cache (Redis optional, memory fallback)
                         ↓
       SQLite (local) / PostgreSQL (production)
                         ↓
   rule engine → dedup / cooldown / hysteresis
                         ↓
                  SQLite events
                         ↓
                  HTTP API → UI
```

The backend uses only Node.js built-ins. Node 24 or newer is required because persistence uses `node:sqlite`.

## Layout

- `index.html` — existing Vue dashboard, progressively reads the backend snapshot API.
- `src/adapters/` — provider-specific spot, derivatives, sentiment, valuation and stream adapters.
- `src/model/` — normalized market observation model.
- `src/core/` — freshness, confidence, and snapshot construction.
- `src/cache/` — in-memory cache and optional Redis adapter.
- `src/engine/` — deterministic anomaly rules and event gate.
- `src/store/` — repository interface, SQLite local adapter, PostgreSQL production adapter, and migrations.
- `src/provenance/` — language-neutral source registry and normalized provenance.
- `src/miners/` — independent miner catalog and tested local economics.
- `src/worker/` — independent schedules, polling, stream ingestion and retention.
- `src/app.js` — HTTP routes and static dashboard.
- `test/` — network-independent fixtures and tests.

## Run

```bash
cp .env.example .env
npm start
```

Open `http://127.0.0.1:8787/`. The server starts the worker by default. To run API and worker as separate processes, set `WORKER_ENABLED=false` for the API process and run `npm run worker` separately. The cache lock prevents duplicate workers sharing the same configured Redis instance. In memory-only mode the lock is process-local.

Useful commands:

```bash
npm test
npm run check
npm run worker
```

## Configuration

All configuration is optional; see `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | HTTP bind address |
| `WORKER_ENABLED` | `true` | Run worker in the API process |
| `MARKET_SYMBOLS` | `BTCUSDT,ETHUSDT` | Spot symbols; CoinGecko fallback currently maps BTC, ETH, SOL, BNB |
| `DATABASE_PATH` | `./data/crypto-ai.sqlite` | Local SQLite file |
| `DATABASE_URL` | empty | Select PostgreSQL when configured; never required for local development |
| `REDIS_URL` | empty | Optional `redis://` or `rediss://` cache endpoint |
| `SPOT_POLL_MS` | `30000` | REST recovery/refresh interval |
| `DERIVATIVES_POLL_MS` | `60000` | OI/funding interval |
| `SNAPSHOT_INTERVAL_MS` | `30000` | Snapshot and anomaly cycle |
| `SNAPSHOT_RETENTION_DAYS` | `7` | Snapshot retention |
| `EVENT_RETENTION_DAYS` | `90` | Event retention |

Never commit `.env`. Redis passwords and other credentials stay server-side and structured logs redact secret-like fields.

## Data model and provenance

Every observation entering a snapshot contains `value`, `source`, `dataTime`, `receivedAt`, `stale`, and `confidence`, plus normalized `sourceId`, `sourceName`, `sourceType`, `sourceUrl`, `updatedAt`, `freshness`, `calculationMethod`, `fallbackSource`, and `provenance`. Freshness is classified as `fresh`, `delayed`, `stale`, or `unavailable` using separate windows for spot, derivatives, sentiment, valuation, daily macro and miner data. Confidence is an explainable rule score (`high`, `medium`, `low`) based on source priority, age, missing fields and optional multi-source agreement; it is not presented as a scientific probability.

`getSourceHealthSummary()` is the sole health aggregation rule. Healthy primaries are green; working fallbacks and non-critical stale data are degraded but not red; disabled features are excluded; only unavailable user data is a red incident. The header, source detail panel, data-health card, and market radar all consume the API summary. The complete user-facing matrix is available at `/sources`.

Snapshots retain the complete normalized inputs seen by the engine, including BTC/ETH price, 24-hour change and volume, OI, funding, Fear & Greed, local AHR999 estimate, and risk-quality flags. AHR999 records its formula version and inputs (current price, 200-day geometric mean, fitted price and days since genesis).

## Sources and fallback

- Spot primary: Binance WebSocket, with Binance REST recovery.
- Spot fallback: OKX, then CoinGecko when the prior source fails.
- Derivatives: Binance Futures public OI and funding endpoints for BTC/ETH.
- Sentiment: Alternative.me Fear & Greed; failures produce no fabricated default.
- Valuation: local AHR999 from 200 closed Binance daily candles; explicitly labeled as a local estimate.
- Liquidations: adapter is deliberately disabled because no stable keyless aggregate source is configured. No values are synthesized.
- Miner hardware: Crypto AI Miner Catalog, with official manufacturer URLs and explicit verified/unverified status.
- Miner economics: local `difficulty_probability_v1` calculation using market price, mempool.space network inputs, hardware specs, reward/fee assumptions, and electricity cost.

The UI requests `/api/market/snapshot` every 15 seconds. A valid, fresh backend snapshot takes priority for BTC, ETH, Fear & Greed, and AHR999. If the API is missing or fails, the pre-existing browser adapters continue operating. Other dashboard modules are unchanged.

## Anomaly rules

Rules are deterministic and thresholds are configurable in `AnomalyEngine`:

- price moves over 1m, 5m, 15m and 1h;
- 24-hour volume spike against the median of recent snapshots;
- open-interest increase or decrease;
- extreme or rapidly changing funding;
- liquidation spike only when a real observation exists;
- momentum confluence (aligned price, volume and OI);
- deleveraging risk (falling price/OI plus real liquidation spike).

Events store `eventId`, asset, type, direction, severity, time window, detection time, snapshot ID, metrics, thresholds and evidence. The gate deduplicates on asset/type/direction/window, applies a 15-minute cooldown, allows severity upgrades, and uses a release threshold (hysteresis) before a condition can re-arm.

## API

- `GET /api/assets/search?q=PONS&chain=robinhood` (canonical, shared onchain index, then DEX market suggestions)
- `GET /api/health`
- `GET /api/market/snapshot`
- `GET /api/market/quotes?symbols=BTCUSDT,ETHUSDT`
- `GET /api/events?limit=50&asset=BTCUSDT&type=price_move`
- `GET /api/events/latest`
- `GET /api/sources/status`
- `GET /api/sources/definitions`
- `GET /api/miners/catalog`

The source observations returned by snapshot and quote endpoints retain timing, staleness, source and confidence fields.

## Local token and pool discovery

Run `DISCOVERY_ENABLED=true WORKER_ENABLED=false DISCOVERY_CHAINS=robinhood npm start` to run one server-side indexer for the selected chains. Omit `DISCOVERY_CHAINS` to monitor every configured chain. The index is stored in the ignored `data/asset-discovery.json`, survives browser sessions and server restarts, and is shared by all clients of this server. Chain RPC polling never runs in the browser or in `/api/assets/search`.

The DEX registry includes verified Uniswap V2 factories for Ethereum, Arbitrum, Base, Polygon, Avalanche and Robinhood, PancakeSwap V2 on BSC, and Uniswap V3 on Robinhood. The EVM worker checks factory creation events, live liquidity, swaps, and ERC20 contract metadata. A bounded provider seed lets the worker check older Robinhood pools against their factory on chain. Raydium CPMM on Solana checks a bounded recent transaction window, pool state, vault balances, swaps and SPL mints; it is not a complete historical or high-throughput Solana indexer. Names and market figures require a matching DEX market record. HyperEVM awaits a confirmed DEX factory; Tron remains limited; Bitcoin is excluded from token discovery. The public Solana RPC may rate limit indexing.

The Vercel search function reads a shared Runtime Cache index if an external publisher has supplied one and can return explicitly unverified DEX suggestions. This local phase does not schedule or deploy a Vercel index publisher; a production deployment of the search function alone will not contain the local worker's onchain index. No market cap is inferred from FDV in discovery results.

## Storage, cache and operations

SQLite tables are created by `src/store/migrations/001_init.sql`: `snapshots`, `events`, and `source_status`, with time and lookup indexes. WAL mode and a busy timeout are enabled. When `DATABASE_URL` exists, the repository factory selects PostgreSQL and runs its idempotent schema instead. Snapshots and events are pruned on an independent six-hour schedule using the configured retention periods.

When `REDIS_URL` is configured, latest observations/snapshot, source health, worker lock and event state use Redis. A failed or absent Redis connection degrades to bounded process memory so development is not blocked. The worker separates spot REST, derivatives, low-frequency sentiment/valuation, snapshots and retention schedules; tasks do not overlap and failures use exponential backoff. The Binance stream reconnects with capped backoff. One source failure cannot terminate the worker.

Structured logs cover server/worker lifecycle, source latency and failures, fallback, Redis degradation, retention, and generated anomalies. Secret-shaped fields are redacted.

## Production boundary and documentation

Vercel owns the frontend, static assets, and web delivery. A future VPS owns the Market Worker, WebSocket ingestion, scheduler, Event Engine, future News Worker, AI Router, and notifications. PostgreSQL owns persistence; Redis owns shared cache/locks/dedup. SQLite and process memory are local/test fallbacks, not the intended multi-process production architecture.

- [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md) — health semantics, provenance, holdings taxonomy, and the fuckbtc.com audit.
- [`docs/MINER-DATA.md`](docs/MINER-DATA.md) — manufacturer catalog and shutdown-price formula.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Vercel/VPS boundary, PostgreSQL, Redis, Docker, and secrets.
- [`docs/AI-ROADMAP.md`](docs/AI-ROADMAP.md) — optional single-provider/fallback design and canonical-event one-analysis fan-out rule.

## Current limits

- Public endpoints can be rate-limited or regionally unavailable; fallback status remains visible.
- CoinGecko fallback supports only its explicit symbol map.
- OI units are provider-native base-asset quantities; cross-provider derivatives normalization is future work.
- Liquidation detection remains disabled until a reliable licensed or authenticated source is configured.
- Redis implementation intentionally covers the small command set this service uses; it is optional.
- PostgreSQL is implemented and testable but this phase does not connect to a real production database or deploy the example Compose stack.
- Macro, equities, and holder ingestion remain browser-side; their provenance and trust labels are documented while backend migration remains future work.
- Legacy miner specs without a directly verified exact official product page stay `unverified`; they are never promoted to verified by inference.
