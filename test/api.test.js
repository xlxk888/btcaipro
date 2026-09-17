import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { MemoryCache } from '../src/cache/memory-cache.js';
import { MemoryEventStore } from '../src/store/memory-store.js';

function fixtureApp() {
  const store = new MemoryEventStore(); const cache = new MemoryCache();
  store.saveSnapshot({ snapshotId: 's1', createdAt: '2026-01-01T00:00:00Z', assets: { BTCUSDT: { price: { value: 100, source: 'Fixture', dataTime: '2026-01-01T00:00:00Z', receivedAt: '2026-01-01T00:00:00Z', stale: false, confidence: { level: 'high' } } }, ETHUSDT: {} } });
  store.saveEvent({ eventId: 'e1', asset: 'BTCUSDT', eventType: 'price_move', severity: 'high', detectedAt: '2026-01-01T00:00:01Z' });
  store.saveSourceStatus({ id: 'fixture', state: 'healthy' });
  const worker = { status: () => ({ started: true }) };
  return createApp({ store, cache, worker, config: { corsOrigin: '' } });
}

async function invoke(app, url, method = 'GET') {
  let status; let body = '';
  const response = { writeHead(value) { status = value; }, end(value = '') { body += value.toString(); } };
  await app({ url, method }, response);
  return { status, json: body ? JSON.parse(body) : null };
}

test('health API reports runtime components', async () => {
  const result = await invoke(fixtureApp(), '/api/health');
  assert.equal(result.json.status, 'ok'); assert.equal(result.json.cache.backend, 'memory'); assert.equal(result.json.worker.started, true);
});

test('snapshot API returns normalized snapshot envelope', async () => {
  const result = await invoke(fixtureApp(), '/api/market/snapshot');
  assert.equal(result.status, 200); assert.equal(result.json.data.snapshotId, 's1'); assert.equal(result.json.data.assets.BTCUSDT.price.source, 'Fixture');
});

test('quotes API filters symbols', async () => {
  const result = await invoke(fixtureApp(), '/api/market/quotes?symbols=BTCUSDT');
  assert.deepEqual(Object.keys(result.json.data.assets), ['BTCUSDT']);
});

test('events and latest event APIs return durable events', async () => {
  const events = await invoke(fixtureApp(), '/api/events?asset=BTCUSDT');
  const latest = await invoke(fixtureApp(), '/api/events/latest');
  assert.equal(events.json.count, 1); assert.equal(latest.json.data.eventId, 'e1');
});

test('source status API exposes adapter health', async () => {
  const result = await invoke(fixtureApp(), '/api/sources/status');
  assert.equal(result.json.data[0].id, 'fixture');
});

test('API rejects writes and unknown routes', async () => {
  assert.equal((await invoke(fixtureApp(), '/api/events', 'POST')).status, 405);
  assert.equal((await invoke(fixtureApp(), '/missing')).status, 404);
});
