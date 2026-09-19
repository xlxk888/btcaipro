import { MarketDataAdapter } from './base.js';

const IDS = { BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', SOLUSDT: 'solana', BNBUSDT: 'binancecoin' };

export class CoinGeckoSpotAdapter extends MarketDataAdapter {
  constructor(options = {}) { super({ id: 'coingecko_spot', kind: 'spot', ...options }); }

  async fetch(symbols = ['BTCUSDT', 'ETHUSDT']) {
    const supported = symbols.filter(symbol => IDS[symbol]);
    if (!supported.length) return [];
    const ids = supported.map(symbol => IDS[symbol]).join(',');
    const response = await this.request(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true`);
    const payload = await response.json();
    return supported.flatMap(symbol => {
      const item = payload[IDS[symbol]];
      if (!item) return [];
      const common = { symbol, market: 'crypto', kind: 'spot', source: 'CoinGecko', sourceId: 'coingecko_spot', sourceType: 'market-data', sourcePriority: 'fallback', dataTime: new Date(Number(item.last_updated_at) * 1000).toISOString(), receivedAt: new Date().toISOString(), interval: '24h' };
      return [
        { ...common, metric: 'price', value: item.usd, unit: 'USD' },
        { ...common, metric: 'change24h', value: item.usd_24h_change, unit: 'percent' },
        { ...common, metric: 'volume24h', value: item.usd_24h_vol, unit: 'USD' }
      ];
    });
  }
}
