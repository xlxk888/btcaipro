# AI-4 architecture rules (recorded, not implemented)

AI-3.6 does not call an AI provider and introduces no API keys.

## Providers

The future router may support OpenAI, DeepSeek, Kimi, Qwen, and Zhipu. The system must work with exactly one configured provider. Configuration may select one primary plus one fallback. A provider without a key is `disabled`: it must not error or block startup. No design may assume the user buys all providers.

## One analysis per canonical event

One market event is analyzed once, stored/cacheable as a canonical event analysis, then fanned out to every relevant subscriber. One hundred users following the same ETH event must not cause one hundred identical model calls. The deduplication key must consider at least `eventId`, `asset`, `eventType`, `timeWindow`, `analysisVersion`, and `language`. Identical analysis context reuses the same result. Per-user notification preferences affect delivery, not analysis count.

A canonical event may map to BTC, ETH, ZEC, UNI, or any watchlist asset. Asset mapping controls fan-out after the single analysis.

## Event coverage

- Regulation: SEC, CFTC, U.S. Treasury, Federal Register, and major national regulators.
- Fed and macro: FOMC, hikes/cuts, rate path, Powell speeches, CPI, PCE, payrolls, unemployment, GDP, liquidity, QT/QE.
- International finance: major central banks, bond-market dislocation, USD/JPY/EUR, global liquidity, and major bank/financial-institution events.
- ETFs: BTC, ETH, other digital-asset ETFs, flows, approvals, delays, and rejections.
- Exchanges: Binance, Coinbase, Robinhood, Kraken, OKX, Bybit, Bitget, Gate, and other major venues.
- Stablecoins: USDT, USDC, and other major stablecoins.
- Security: hacks, vulnerabilities, bridge attacks, exchange theft, protocol/chain halts, and withdrawal suspension.
- Blockchain/projects: upgrades, hard forks, mainnets, unlocks, buybacks, burns, airdrops, governance, and major partnerships.
- Geopolitics/war: escalation, ceasefire, sanctions, military conflict, energy disruption, and key route/strait interruption that can materially affect global risk assets.

International political and war events require reliable news or official sources. Unsourced social-media rumors cannot trigger a high-severity event.

## Severity

- P0 Critical: immediate systemic/security/market-access threat; urgent fan-out.
- P1 Major: high-impact confirmed event with broad asset relevance.
- P2 Important: material but bounded event requiring context.
- P3 Normal: routine event retained for awareness, normally non-urgent.
