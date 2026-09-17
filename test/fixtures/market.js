import { normalizeObservation } from '../../src/model/market-data.js';

export function observation(symbol, metric, value, dataTime = new Date().toISOString(), extra = {}) {
  return normalizeObservation({ symbol, metric, value, dataTime, source: 'Fixture', sourcePriority: 'primary', kind: metric === 'fundingRate' || metric === 'openInterest' ? 'derivatives' : 'spot', ...extra }, new Date(dataTime).getTime());
}

export function snapshot({ id = 'fixture', at = Date.now(), price = 100, volume = 1_000, oi = 1_000, funding = 0.0001, liquidations = null } = {}) {
  const item = (metric, value) => value === null ? null : observation('BTCUSDT', metric, value, new Date(at).toISOString());
  return {
    snapshotId: id, createdAt: new Date(at).toISOString(), schemaVersion: 1,
    assets: { BTCUSDT: { price: item('price', price), change24h: item('change24h', 1), volume24h: item('volume24h', volume), openInterest: item('openInterest', oi), fundingRate: item('fundingRate', funding), liquidations: item('liquidations', liquidations) } },
    sentiment: { fearGreed: null, ahr999: null }, riskSignals: [], observationCount: 5
  };
}
