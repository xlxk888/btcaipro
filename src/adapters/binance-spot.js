import { MarketDataAdapter } from './base.js';

export class BinanceSpotAdapter extends MarketDataAdapter {
  constructor(options = {}) { super({ id: 'binance_spot_rest', kind: 'spot', ...options }); }

  async fetch(symbols = ['BTCUSDT', 'ETHUSDT']) {
    const query = encodeURIComponent(JSON.stringify(symbols));
    const response = await this.request(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${query}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Binance ticker payload invalid');
    const receivedAt = new Date().toISOString();
    return payload.flatMap(item => {
      const dataTime = new Date(Number(item.closeTime || Date.now())).toISOString();
      const common = { symbol: item.symbol, market: 'crypto', kind: 'spot', source: 'Binance', sourcePriority: 'primary', dataTime, receivedAt, interval: '24h' };
      return [
        { ...common, metric: 'price', value: item.lastPrice, unit: 'USDT' },
        { ...common, metric: 'change24h', value: item.priceChangePercent, unit: 'percent' },
        { ...common, metric: 'volume24h', value: item.quoteVolume, unit: 'USDT' }
      ];
    });
  }
}
