import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAhr999, AHR999_FORMULA_VERSION } from '../src/adapters/ahr999.js';
import { MarketWorker } from '../src/worker/market-worker.js';
import { MemoryCache } from '../src/cache/memory-cache.js';
import { MemoryEventStore } from '../src/store/memory-store.js';
import { ResilientCache } from '../src/cache/resilient-cache.js';
import { FearGreedAdapter } from '../src/adapters/fear-greed.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const config = { symbols: ['BTCUSDT'], requestTimeoutMs: 1000, spotPollMs: 5_000, derivativesPollMs: 10_000, snapshotIntervalMs: 10_000, snapshotRetentionDays: 7, eventRetentionDays: 90 };

test('AHR999 calculation records finite traceable inputs', () => {
  const closes = Array.from({ length: 200 }, (_, index) => 20_000 + index);
  const result = calculateAhr999(closes, 30_000, Date.parse('2026-01-01T00:00:00Z'));
  assert.ok(result.value > 0); assert.ok(result.geoMean200 > 20_000); assert.match(AHR999_FORMULA_VERSION, /geom200/);
});

test('Fear & Greed adapter preserves the official classification', async () => {
  const adapter = new FearGreedAdapter();
  adapter.request = async () => ({ json: async () => ({ data: [{ value: '71', value_classification: 'Greed', timestamp: '1790179200' }] }) });
  const rows = await adapter.fetch();
  assert.equal(rows[0].value, '71');
  assert.equal(rows[0].metadata.classification, 'Greed');
  assert.equal(rows[0].source, 'Alternative.me');
});

test('worker spot collection falls back after primary failure', async () => {
  const failed = { id: 'failed', status: { id: 'failed', state: 'error' }, async run() { throw new Error('offline'); } };
  const fallback = { id: 'fallback', status: { id: 'fallback', state: 'healthy' }, async run() { return [{ symbol: 'BTCUSDT', market: 'crypto', kind: 'spot', metric: 'price', value: 100, source: 'Fallback', sourcePriority: 'fallback', dataTime: new Date().toISOString() }]; } };
  const inert = { id: 'inert', status: { id: 'inert', state: 'idle' }, async run() { return []; } };
  const worker = new MarketWorker({ config, cache: new MemoryCache(), store: new MemoryEventStore(), logger, adapters: { spot: [failed, fallback], derivatives: inert, sentiment: inert, valuation: inert, stream: null } });
  const rows = await worker.collectSpot();
  assert.equal(rows[0].source, 'Fallback'); assert.equal(worker.observations.get('BTCUSDT:price').confidence.level, 'medium');
});

test('worker prevents duplicate starts through cache lock', async () => {
  const cache = new MemoryCache(); const inert = { id: 'inert', status: { id: 'inert', state: 'idle' }, async run() { return []; } };
  const first = new MarketWorker({ config, cache, store: new MemoryEventStore(), logger, adapters: { spot: [inert], derivatives: inert, sentiment: inert, valuation: inert, stream: null } });
  const second = new MarketWorker({ config, cache, store: new MemoryEventStore(), logger, adapters: { spot: [inert], derivatives: inert, sentiment: inert, valuation: inert, stream: null } });
  assert.equal(await first.start(), true); assert.equal(await second.start(), false); await first.stop(); await second.stop();
});

test('liquidation adapter is explicitly disabled without fabricating rows', async () => {
  const inert = { id: 'inert', status: { id: 'inert', state: 'idle' }, async run() { return []; } };
  const worker = new MarketWorker({ config, cache: new MemoryCache(), store: new MemoryEventStore(), logger, adapters: { spot: [inert], derivatives: inert, sentiment: inert, valuation: inert, stream: null } });
  assert.equal(worker.adapters.liquidations.status.state, 'disabled'); assert.deepEqual(await worker.adapters.liquidations.run(), []);
});

test('Redis writes are mirrored so a later outage preserves worker state', async () => {
  const cache = new ResilientCache({ logger });
  cache.redis = { async set() { return true; }, async get() { throw new Error('offline'); } };
  cache.redisHealthy = true;
  await cache.set('lock', 'owner', 1_000);
  assert.equal(await cache.get('lock'), 'owner'); assert.equal(cache.status().backend, 'memory');
});

test('Redis failure degrades set-if-absent to process memory', async () => {
  const cache = new ResilientCache({ logger });
  cache.redis = { async setIfAbsent() { throw new Error('offline'); } }; cache.redisHealthy = true;
  assert.equal(await cache.setIfAbsent('lock', 'owner', 1_000), true);
  assert.equal(await cache.setIfAbsent('lock', 'other', 1_000), false);
});
