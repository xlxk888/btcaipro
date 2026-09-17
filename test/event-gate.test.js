import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache } from '../src/cache/memory-cache.js';
import { EventGate } from '../src/engine/event-gate.js';

const candidate = (severity = 'medium', snapshotId = 's1') => ({ asset: 'BTCUSDT', eventType: 'price_move', direction: 'up', severity, timeWindow: '5m', snapshotId, detectedAt: '2026-01-01T00:00:00Z', metrics: { changePct: 3 }, thresholds: { changePct: 2 }, evidence: [] });

test('gate emits first event and stable deterministic id', async () => {
  const gate = new EventGate({ cache: new MemoryCache(), cooldownMs: 1_000 });
  const event = await gate.admit(candidate(), 100);
  assert.match(event.eventId, /^evt_/); assert.equal(event.dedupKey, 'BTCUSDT:price_move:up:5m');
});

test('dedup suppresses same active event during cooldown', async () => {
  const gate = new EventGate({ cache: new MemoryCache(), cooldownMs: 1_000 });
  assert.ok(await gate.admit(candidate(), 100)); assert.equal(await gate.admit(candidate('medium', 's2'), 200), null);
});

test('severity upgrade bypasses cooldown', async () => {
  const gate = new EventGate({ cache: new MemoryCache(), cooldownMs: 1_000 });
  await gate.admit(candidate('medium'), 100);
  const upgraded = await gate.admit(candidate('high', 's2'), 200);
  assert.equal(upgraded.escalation, true);
});

test('same event emits again after cooldown', async () => {
  const gate = new EventGate({ cache: new MemoryCache(), cooldownMs: 1_000 });
  await gate.admit(candidate(), 100); assert.ok(await gate.admit(candidate('medium', 's2'), 1_101));
});

test('hysteresis rejects weak signal and allows after release', async () => {
  const gate = new EventGate({ cache: new MemoryCache(), cooldownMs: 1_000, releaseRatio: 0.75 });
  const weak = { ...candidate(), metrics: { changePct: 1 }, thresholds: { changePct: 2 } };
  assert.equal(await gate.admit(weak, 100), null);
  assert.ok(await gate.admit(candidate(), 200));
  assert.equal(await gate.release(candidate(), 0.5, 300), true);
  assert.ok(await gate.admit(candidate('medium', 's3'), 400));
});
