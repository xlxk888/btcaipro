import { MarketDataAdapter } from './base.js';

export class FearGreedAdapter extends MarketDataAdapter {
  constructor(options = {}) { super({ id: 'fear_greed', kind: 'sentiment', ...options }); }

  async fetch() {
    const response = await this.request('https://api.alternative.me/fng/?limit=1&format=json');
    const payload = await response.json();
    const item = payload?.data?.[0];
    if (!item || !Number.isFinite(Number(item.value))) throw new Error('Fear & Greed payload invalid');
    return [{
      symbol: 'MARKET', market: 'sentiment', kind: 'sentiment', metric: 'fearGreed', value: item.value,
      unit: 'index', interval: 'daily', source: 'Alternative.me', sourceId: 'fear_greed', sourceType: 'market-data', sourcePriority: 'primary',
      dataTime: new Date(Number(item.timestamp) * 1000).toISOString(), receivedAt: new Date().toISOString(),
      metadata: { classification: item.value_classification || null }
    }];
  }
}
