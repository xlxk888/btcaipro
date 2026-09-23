import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockTokenKlinesHandler } from '../api/stock-tokens/klines.js';

test('Gate stock-token klines normalize official candles and supported periods', async () => {
  let requested;
  const handler = createStockTokenKlinesHandler({ fetchImpl: async url => {
    requested = new URL(url);
    return new Response(JSON.stringify([
      ['200', '20', '12', '13', '10', '11', '2'],
      ['100', '10', '11', '12', '9', '10', '1']
    ]));
  } });
  const response = await handler.fetch(new Request('https://example.test/api/stock-tokens/klines?venue=Gate&pair=CRCLX_USDT&period=1W'));
  assert.equal(response.status, 200);
  assert.equal(requested.searchParams.get('currency_pair'), 'CRCLX_USDT');
  assert.equal(requested.searchParams.get('interval'), '7d');
  const payload = await response.json();
  assert.deepEqual(payload.data.map(item => item.time), [100000, 200000]);
  assert.deepEqual(payload.data[0], { time: 100000, open: 10, high: 12, low: 9, close: 11, quoteVolume: 10, baseVolume: 1 });
});

test('stock-token klines reject reference venues, invalid pairs and unsupported periods', async () => {
  let calls = 0;
  const handler = createStockTokenKlinesHandler({ fetchImpl: async () => { calls++; return new Response('[]'); } });
  for (const url of [
    'https://example.test/api/stock-tokens/klines?venue=Robinhood%20Chain&pair=AAPL&period=1H',
    'https://example.test/api/stock-tokens/klines?venue=Gate&pair=../secret&period=1H',
    'https://example.test/api/stock-tokens/klines?venue=Gate&pair=AAPLX_USDT&period=15M'
  ]) assert.equal((await handler.fetch(new Request(url))).status, 400);
  assert.equal(calls, 0);
});
