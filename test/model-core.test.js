import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObservation } from '../src/model/market-data.js';
import { evaluateFreshness, FRESHNESS_POLICIES } from '../src/core/freshness.js';
import { evaluateConfidence } from '../src/core/confidence.js';

const now = Date.parse('2026-01-01T00:00:00Z');

test('normalization preserves required provenance fields', () => {
  const row = normalizeObservation({ symbol: 'btcusdt', metric: 'price', value: '100', source: 'test', dataTime: new Date(now).toISOString(), kind: 'spot' }, now);
  assert.equal(row.symbol, 'BTCUSDT'); assert.equal(row.value, 100); assert.equal(row.source, 'test');
  for (const field of ['dataTime', 'receivedAt', 'stale', 'confidence']) assert.ok(field in row);
});

test('normalization rejects non-numeric value without inventing data', () => {
  const row = normalizeObservation({ symbol: 'BTCUSDT', metric: 'price', value: 'bad', source: 'test', dataTime: new Date(now).toISOString() }, now);
  assert.equal(row.value, null); assert.equal(row.confidence.level, 'medium'); assert.match(row.confidence.reasons.join(','), /missing:value/);
});

test('freshness classifies fresh, delayed, stale, unavailable', () => {
  const policy = { freshMs: 10, delayedMs: 20, staleMs: 30 };
  assert.equal(evaluateFreshness(now - 5, policy, now).status, 'fresh');
  assert.equal(evaluateFreshness(now - 15, policy, now).status, 'delayed');
  assert.equal(evaluateFreshness(now - 25, policy, now).status, 'stale');
  assert.equal(evaluateFreshness(now - 35, policy, now).status, 'unavailable');
});

test('freshness rejects invalid timestamps', () => assert.equal(evaluateFreshness('invalid', FRESHNESS_POLICIES.spot, now).status, 'unavailable'));

test('confidence is high for fresh primary aligned data', () => {
  const value = evaluateConfidence({ sourcePriority: 'primary', freshness: { status: 'fresh' }, consensusDeltaPct: 0.2 });
  assert.equal(value.level, 'high'); assert.equal(value.score, 97); assert.ok(value.reasons.includes('multi_source_aligned'));
});

test('confidence explains stale fallback and missing fields', () => {
  const value = evaluateConfidence({ sourcePriority: 'fallback', freshness: { status: 'stale' }, missingFields: ['value'] });
  assert.equal(value.level, 'low'); assert.deepEqual(value.reasons, ['source:fallback', 'stale', 'missing:value']);
});
