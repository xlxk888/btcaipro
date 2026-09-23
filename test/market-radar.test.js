import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../market-radar.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const radar = context.CryptoAIMarketRadar;

test('official Fear & Greed classification overrides fallback mapping', () => {
  assert.equal(radar.classifyFearGreed(71, 'Greed').label, '贪婪');
  assert.equal(radar.classifyFearGreed(78, 'Extreme Greed').label, '极度贪婪');
  assert.equal(radar.classifyFearGreed(20, 'Extreme Fear').label, '极度恐慌');
  assert.equal(radar.classifyFearGreed(20, 'Greed').label, '贪婪');
});

test('Fear & Greed fallback uses the documented non-overlapping thresholds', () => {
  assert.equal(radar.classifyFearGreed(24).label, '极度恐慌');
  assert.equal(radar.classifyFearGreed(25).label, '恐慌');
  assert.equal(radar.classifyFearGreed(44).label, '恐慌');
  assert.equal(radar.classifyFearGreed(45).label, '中性');
  assert.equal(radar.classifyFearGreed(55).label, '中性');
  assert.equal(radar.classifyFearGreed(56).label, '贪婪');
  assert.equal(radar.classifyFearGreed(74).label, '贪婪');
  assert.equal(radar.classifyFearGreed(75).label, '极度贪婪');
});

test('Greed with a normal BTC and ETH pullback stays separate from medium aggregate risk', () => {
  const result = radar.evaluate({
    fearGreed: { value: 71, classification: 'Greed', fresh: true },
    btc: { change24h: -2.3, fresh: true },
    eth: { change24h: -2.6, fresh: true },
    ahr999: { value: 0.57, fresh: true }
  });
  assert.equal(result.sentiment.label, '贪婪');
  assert.equal(result.momentum.label, '偏弱');
  assert.equal(result.valuation.label, '定投区间');
  assert.equal(result.risk.label, '中等风险');
  assert.notEqual(result.risk.label, '极度恐慌');
});

test('stale sentiment is displayed externally but excluded from live aggregate risk', () => {
  const result = radar.evaluate({
    fearGreed: { value: 20, classification: 'Extreme Fear', fresh: false },
    btc: { change24h: 0.5, fresh: true },
    eth: { change24h: 0.2, fresh: true },
    ahr999: { value: 0.57, fresh: true }
  });
  assert.equal(result.sentiment, null);
  assert.deepEqual(Array.from(result.usedIndicators), ['momentum', 'valuation']);
  assert.equal(result.risk.label, '低风险');
});

test('undefined Fear & Greed never becomes zero or Extreme Fear', () => {
  assert.equal(radar.classifyFearGreed(undefined), null);
  const result = radar.evaluate({
    fearGreed: { value: undefined, fresh: true },
    btc: { change24h: -1, fresh: true }
  });
  assert.equal(result.sentiment, null);
  assert.equal(result.risk.label, '数据不足');
});

test('personal watchlist breadth does not affect the global market model', () => {
  const input = {
    fearGreed: { value: 71, classification: 'Greed', fresh: true },
    btc: { change24h: -2.3, fresh: true },
    eth: { change24h: -2.6, fresh: true },
    ahr999: { value: 0.57, fresh: true }
  };
  const baseline = radar.evaluate(input);
  const withWatchlist = radar.evaluate({ ...input, watchlist: { up: 2, down: 4 } });
  assert.deepEqual(withWatchlist, baseline);
});

test('a highest-risk label requires confirmation from multiple independent dimensions', () => {
  const oneExtremeDimension = radar.evaluate({
    fearGreed: { value: 50, classification: 'Neutral', fresh: false },
    btc: { change24h: -12, fresh: true },
    eth: { change24h: -11, fresh: true },
    ahr999: { value: 0.57, fresh: false }
  });
  assert.equal(oneExtremeDimension.risk.label, '数据不足');
  const confirmed = radar.evaluate({
    fearGreed: { value: 20, classification: 'Extreme Fear', fresh: true },
    btc: { change24h: -12, fresh: true },
    eth: { change24h: -11, fresh: true },
    ahr999: { value: 6, fresh: true }
  });
  assert.equal(confirmed.risk.label, '高风险');
});
