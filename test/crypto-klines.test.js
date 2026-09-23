import test from 'node:test';
import assert from 'node:assert/strict';
import { createCryptoKlineService } from '../src/market/crypto-klines.js';
import { createCryptoKlinesHandler } from '../api/crypto/klines.js';

const response = payload => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

const binanceRows = Array.from({ length: 24 }, (_, index) => [
  1_700_000_000_000 + index * 3_600_000,
  String(100 + index), String(102 + index), String(99 + index),
  String(101 + index), String(10 + index)
]);

test('CEX resolver normalizes Binance candles and caches the result for five minutes', async () => {
  let calls = 0;
  let clock = 1_800_000_000_000;
  const service = createCryptoKlineService({
    now: () => clock,
    fetchImpl: async url => {
      calls += 1;
      assert.match(String(url), /data-api\.binance\.vision.*symbol=BTCUSDT/);
      return response(binanceRows);
    }
  });
  const input = { type: 'cex', canonicalAssetId: 'bitcoin', pair: 'BTCUSDT' };
  const first = await service.resolve(input);
  const second = await service.resolve(input);
  assert.equal(first.status, 'ok');
  assert.equal(first.source, 'Binance Spot Klines');
  assert.equal(first.candles.length, 24);
  assert.deepEqual(Object.keys(first.candles[0]), ['timestamp', 'open', 'high', 'low', 'close', 'volume']);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  clock += 5 * 60 * 1000 + 1;
  await service.resolve(input);
  assert.equal(calls, 2);
});

test('HYPE resolver uses the official Hyperliquid candle snapshot before fallback', async () => {
  const service = createCryptoKlineService({
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.hyperliquid.xyz/info');
      assert.equal(options.method, 'POST');
      assert.match(options.body, /"type":"candleSnapshot"/);
      assert.match(options.body, /"coin":"HYPE"/);
      return response(Array.from({ length: 24 }, (_, index) => ({
        t: 1_700_000_000_000 + index * 3_600_000,
        o: '20', h: '22', l: '19', c: String(20 + index / 10), v: '100'
      })));
    }
  });
  const result = await service.resolve({ type: 'cex', canonicalAssetId: 'hyperliquid', pair: 'HYPEUSDT' });
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'Hyperliquid Candle Snapshot');
  assert.equal(result.market, 'HYPE Perpetual');
  assert.equal(result.candles.length, 24);
});

test('XMR resolver uses Kraken spot OHLC and parses second timestamps', async () => {
  const service = createCryptoKlineService({
    fetchImpl: async url => {
      assert.match(String(url), /api\.kraken\.com\/0\/public\/OHLC\?pair=XMRUSD/);
      return response({
        error: [],
        result: {
          XXMRZUSD: Array.from({ length: 24 }, (_, index) => [
            1_700_000_000 + index * 3600, '200', '203', '198', '202', '201', '12'
          ]),
          last: 1_700_086_400
        }
      });
    }
  });
  const result = await service.resolve({ type: 'cex', canonicalAssetId: 'monero', pair: 'XMRUSDT' });
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'Kraken Spot OHLC');
  assert.equal(result.market, 'XMR/USD');
  assert.equal(result.candles[0].timestamp, 1_700_000_000_000);
});

test('DEX resolver requires exact chain, contract, and pool identity before exposing OHLCV', async () => {
  const contract = '0x39dbed3a2bd333467115de45665cc57f813c4571';
  const pool = '0xed50bdeea8adc232f159486192a4157281d722ff';
  const service = createCryptoKlineService({
    fetchImpl: async url => {
      assert.match(String(url), new RegExp(`networks/robinhood/pools/${pool}/ohlcv/hour`));
      return response({
        meta: { base: { address: contract } },
        data: { attributes: { ohlcv_list: [
          [1_700_003_600, 2, 3, 1, 2.5, 12],
          [1_700_000_000, 1, 2, 0.5, 1.5, 10]
        ] } }
      });
    }
  });
  const result = await service.resolve({ type: 'dex', chain: 'robinhood', contract, pool });
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'GeckoTerminal Pool OHLCV');
  assert.equal(result.pool, pool);
  assert.deepEqual(result.candles.map(item => item.close), [1.5, 2.5]);
});

test('DEX resolver records identity mismatch instead of displaying unrelated symbol data', async () => {
  const service = createCryptoKlineService({
    fetchImpl: async () => response({
      meta: { base: { address: '0xwrong' } },
      data: { attributes: { ohlcv_list: [[1_700_000_000, 1, 2, 0.5, 1.5, 10]] } }
    })
  });
  const result = await service.resolve({
    type: 'dex', chain: 'robinhood',
    contract: '0x39dbed3a2bd333467115de45665cc57f813c4571',
    pool: '0xed50bdeea8adc232f159486192a4157281d722ff'
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'ohlcv_pool_identity_mismatch');
  assert.deepEqual(result.candles, []);
});

test('HTTP handler validates identity and returns normalized resolver metadata', async () => {
  const handler = createCryptoKlinesHandler({
    service: { resolve: async input => ({
      status: 'ok', source: 'Test OHLC', market: input.pair,
      candles: [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
      lastTimestamp: 1
    }) }
  });
  const invalid = await handler.fetch(new Request('https://example.test/api/crypto/klines?type=cex'));
  assert.equal(invalid.status, 400);
  const valid = await handler.fetch(new Request('https://example.test/api/crypto/klines?type=cex&assetId=bitcoin&pair=BTCUSDT'));
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get('cache-control'), 'public, max-age=0, s-maxage=300, stale-while-revalidate=300');
  assert.equal((await valid.json()).market, 'BTCUSDT');
});
