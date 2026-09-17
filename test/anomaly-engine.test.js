import test from 'node:test';
import assert from 'node:assert/strict';
import { AnomalyEngine } from '../src/engine/anomaly-engine.js';
import { snapshot } from './fixtures/market.js';

const now = Date.parse('2026-01-01T01:00:00Z');
const engine = new AnomalyEngine({ pricePct: { '1m': 1, '5m': 2, '15m': 3, '1h': 5 }, volumeSpikeRatio: 2, openInterestPct: 5, fundingAbsolute: 0.001, fundingChange: 0.0005 });

test('detects configured short-window price move', () => {
  const current = snapshot({ id: 'now', at: now, price: 103 });
  const history = [snapshot({ id: 'past', at: now - 60_000, price: 100 })];
  const event = engine.detect(current, history).find(item => item.eventType === 'price_move' && item.timeWindow === '1m');
  assert.equal(event.direction, 'up'); assert.ok(event.metrics.changePct > 2.9);
});

test('detects volume spike against historical median', () => {
  const current = snapshot({ at: now, volume: 3_000 });
  const history = [1, 2, 3].map(index => snapshot({ at: now - index * 60_000, volume: 1_000 }));
  const event = engine.detect(current, history).find(item => item.eventType === 'volume_spike');
  assert.equal(event.metrics.ratio, 3);
});

test('detects open interest increase', () => {
  const events = engine.detect(snapshot({ at: now, oi: 1_100 }), [snapshot({ at: now - 30_000, oi: 1_000 })]);
  assert.equal(events.find(item => item.eventType === 'open_interest_move').direction, 'up');
});

test('detects positive and rapidly changing funding', () => {
  const events = engine.detect(snapshot({ at: now, funding: 0.0012 }), [snapshot({ at: now - 30_000, funding: 0.0001 })]);
  assert.equal(events.find(item => item.eventType === 'funding_extreme').direction, 'positive');
});

test('combines aligned price, volume and OI into momentum event', () => {
  const current = snapshot({ at: now, price: 104, volume: 3_000, oi: 1_100 });
  const history = [snapshot({ at: now - 5 * 60_000, price: 100, volume: 1_000, oi: 1_000 }), snapshot({ at: now - 10 * 60_000, price: 99, volume: 1_000, oi: 1_000 })];
  assert.ok(engine.detect(current, history).some(item => item.eventType === 'momentum_confluence' && item.severity === 'high'));
});

test('does not create liquidation event without real data', () => {
  assert.ok(!engine.detect(snapshot({ at: now, liquidations: null }), []).some(item => item.eventType === 'liquidation_spike'));
});
