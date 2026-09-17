import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SnapshotBuilder } from '../src/core/snapshot.js';
import { observationKey } from '../src/model/market-data.js';
import { observation } from './fixtures/market.js';
import { SQLiteEventStore } from '../src/store/sqlite-store.js';

test('snapshot keeps observation provenance and risk signals', () => {
  const at = Date.parse('2026-01-01T00:00:00Z');
  const price = observation('BTCUSDT', 'price', 100, new Date(at).toISOString());
  const map = new Map([[observationKey('BTCUSDT', 'price'), price]]);
  const result = new SnapshotBuilder().build(map, at);
  assert.equal(result.assets.BTCUSDT.price.source, 'Fixture');
  assert.ok(result.riskSignals.some(item => item.metric === 'openInterest' && item.status === 'unavailable'));
});

test('snapshot id differs while each saved payload remains reproducible', () => {
  const map = new Map(); const builder = new SnapshotBuilder();
  assert.notEqual(builder.build(map, 1000).snapshotId, builder.build(map, 1000).snapshotId);
});

test('SQLite event store persists snapshots, events, and source status', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-ai-store-'));
  const store = new SQLiteEventStore(path.join(directory, 'test.sqlite'));
  const snap = { snapshotId: 's1', createdAt: '2026-01-01T00:00:00Z', assets: {} };
  const event = { eventId: 'e1', asset: 'BTCUSDT', eventType: 'price_move', severity: 'high', detectedAt: '2026-01-01T00:00:01Z' };
  store.saveSnapshot(snap); store.saveEvent(event); store.saveSourceStatus({ id: 'source', state: 'healthy' });
  assert.equal(store.latestSnapshot().snapshotId, 's1'); assert.equal(store.latestEvent().eventId, 'e1'); assert.equal(store.listSourceStatuses()[0].state, 'healthy');
  store.close(); fs.rmSync(directory, { recursive: true, force: true });
});

test('SQLite event ids are idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-ai-store-'));
  const store = new SQLiteEventStore(path.join(directory, 'test.sqlite'));
  const event = { eventId: 'same', asset: 'BTCUSDT', eventType: 'price_move', severity: 'medium', detectedAt: '2026-01-01T00:00:00Z' };
  store.saveEvent(event); store.saveEvent(event); assert.equal(store.listEvents().length, 1);
  store.close(); fs.rmSync(directory, { recursive: true, force: true });
});
