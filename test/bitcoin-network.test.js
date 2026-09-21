import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitcoinNetworkService } from '../api/bitcoin/network.js';

function fixture(fetchImpl, initialCache = null) {
  let currentTime = 1_800_000_000_000;
  let savedTtl = null;
  const values = new Map(initialCache ? [['last-good-height-v1', initialCache]] : []);
  const cache = {
    get: async key => values.get(key),
    set: async (key, value, options) => { values.set(key, value); savedTtl = options.ttl; }
  };
  const service = createBitcoinNetworkService({ cache, fetchImpl, now: () => currentTime, timeoutMs: 100 });
  return { service, values, savedTtl: () => savedTtl, advance: milliseconds => { currentTime += milliseconds; }, now: () => currentTime };
}

const height = value => ({ ok: true, text: async () => String(value) });
const unavailable = status => ({ ok: false, status });

test('mempool success saves a shared last-known-good height', async () => {
  const requests = [];
  const app = fixture(async url => { requests.push(url); return height(968000); });
  const result = await app.service.read();
  assert.equal(result.height, 968000);
  assert.equal(result.source, 'mempool.space');
  assert.equal(result.status, 'ok');
  assert.equal(result.stale, false);
  assert.equal(app.values.get('last-good-height-v1').height, 968000);
  assert.equal(app.savedTtl(), 86_400);
  assert.deepEqual(requests, ['https://mempool.space/api/blocks/tip/height']);
});

test('mempool failure uses Blockstream and saves its result', async () => {
  const requests = [];
  const app = fixture(async url => { requests.push(url); return url.includes('mempool.space') ? unavailable(429) : height(968001); });
  const result = await app.service.read();
  assert.equal(result.height, 968001);
  assert.equal(result.source, 'Blockstream');
  assert.equal(result.status, 'fallback');
  assert.equal(result.stale, false);
  assert.deepEqual(requests, [
    'https://mempool.space/api/blocks/tip/height',
    'https://blockstream.info/api/blocks/tip/height'
  ]);
});

test('both upstreams failing returns shared last-known-good as stale', async () => {
  const app = fixture(async () => unavailable(503), { height: 968002, source: 'mempool.space', updatedAt: 1_799_999_400_000 });
  const result = await app.service.read();
  assert.equal(result.height, 968002);
  assert.equal(result.status, 'stale');
  assert.equal(result.stale, true);
  assert.equal(result.updatedAt, 1_799_999_400_000);
});

test('both upstreams failing with no cache returns unavailable', async () => {
  const app = fixture(async () => unavailable(503));
  const response = await app.service.handle(new Request('http://localhost/api/bitcoin/network'));
  const result = await response.json();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.height, null);
  assert.equal(result.stale, false);
  assert.equal(response.status, 200);
});

test('many users reuse the shared cache and one in-flight upstream refresh', async () => {
  let upstreamCalls = 0;
  const app = fixture(async () => { upstreamCalls += 1; return height(968003); });
  const firstHundred = await Promise.all(Array.from({ length: 100 }, () => app.service.read()));
  assert.equal(firstHundred.length, 100);
  assert.equal(upstreamCalls, 1);
  await Promise.all(Array.from({ length: 1000 }, () => app.service.read()));
  assert.equal(upstreamCalls, 1);
  app.advance(60_001);
  await Promise.all(Array.from({ length: 100 }, () => app.service.read()));
  assert.equal(upstreamCalls, 2);

  const secondInstance = createBitcoinNetworkService({
    cache: { get: async key => app.values.get(key), set: async (key, value) => { app.values.set(key, value); } },
    fetchImpl: async () => { upstreamCalls += 1; return height(968004); },
    now: app.now
  });
  await secondInstance.read();
  assert.equal(upstreamCalls, 2);
});
