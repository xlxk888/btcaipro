import { createHash, randomUUID } from 'node:crypto';
import { observationKey } from '../model/market-data.js';

const pick = (observations, symbol, metric) => observations.get(observationKey(symbol, metric)) || null;

export class SnapshotBuilder {
  build(observations, now = Date.now()) {
    const createdAt = new Date(now).toISOString();
    const assets = {};
    const symbols = [...new Set([...observations.values()].filter(item => item.market === 'crypto' && item.symbol !== 'MARKET').map(item => item.symbol))];
    for (const symbol of symbols) {
      assets[symbol] = {
        price: pick(observations, symbol, 'price'),
        change24h: pick(observations, symbol, 'change24h'),
        volume24h: pick(observations, symbol, 'volume24h'),
        openInterest: pick(observations, symbol, 'openInterest'),
        fundingRate: pick(observations, symbol, 'fundingRate'),
        liquidations: pick(observations, symbol, 'liquidations')
      };
    }
    const sentiment = {
      fearGreed: pick(observations, 'MARKET', 'fearGreed'),
      ahr999: pick(observations, 'BTCUSDT', 'ahr999')
    };
    const riskSignals = [];
    for (const [symbol, metrics] of Object.entries(assets)) {
      for (const [metric, item] of Object.entries(metrics)) {
        if (!item) riskSignals.push({ symbol, metric, status: 'unavailable' });
        else if (item.stale || item.confidence.level === 'low') riskSignals.push({ symbol, metric, status: item.status, confidence: item.confidence.level });
      }
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ assets, sentiment })).digest('hex').slice(0, 12);
    return {
      snapshotId: `snap_${now}_${fingerprint}_${randomUUID().slice(0, 8)}`,
      createdAt,
      assets,
      sentiment,
      riskSignals,
      observationCount: observations.size,
      schemaVersion: 1
    };
  }
}
