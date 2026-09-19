# Miner data and economics

`src/miners/catalog.js` is the extensible SHA-256 equipment registry. Adding a miner does not require UI code changes. The catalog currently covers all models previously shown and adds official Canaan and Bitdeer examples. Supported manufacturers are Bitmain/Antminer, MicroBT/WhatsMiner, Canaan/Avalon, and Bitdeer/SEALMINER.

Each row records manufacturer, model, variant, algorithm, cooling type, hashrate, power, efficiency, release date, official source, source update/review dates, and verification status. Only exact specs checked against an official product page or issuer release are `verified`; legacy rows awaiting a direct exact official page are visibly `unverified`. Unknown values remain null and are not invented.

Dynamic inputs are independent of equipment specs:

- BTC price: Binance → OKX → CoinGecko through the market source chain.
- Network: mempool.space difficulty/hashrate, current block height, and the protocol reward.
- Equipment: Crypto AI Miner Catalog.
- User/economic assumption: electricity cost (the dashboard currently displays CNY 0.4/kWh and uses its configured USD approximation).

`src/miners/miner-economics.js` owns the formula:

```text
expectedBTCPerDay = hashrateHps × 86400 ÷ (difficulty × 2^32) × (blockReward + feeReward)
electricityPerDay = powerW ÷ 1000 × 24 × electricityUsdPerKwh
shutdownPriceUsd = electricityPerDay ÷ expectedBTCPerDay
profitPerDay = expectedBTCPerDay × btcPrice - electricityPerDay
```

This is an expected-value estimate. It excludes pool fees, downtime, taxes, cooling overhead, curtailment, and depreciation. Calculation method ID: `difficulty_probability_v1`.
