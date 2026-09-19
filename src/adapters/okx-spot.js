import { MarketDataAdapter } from './base.js';

export class OkxSpotAdapter extends MarketDataAdapter {
  constructor(options = {}) { super({ id: 'okx_spot', kind: 'spot', ...options }); }

  async fetch(symbols = ['BTCUSDT', 'ETHUSDT']) {
    const rows = await Promise.all(symbols.map(async symbol => {
      const base = symbol.replace(/USDT$/, '');
      const response = await this.request(`https://www.okx.com/api/v5/market/ticker?instId=${base}-USDT`);
      const payload = await response.json();
      const item = payload?.data?.[0];
      if (!item) throw new Error(`OKX missing ${symbol}`);
      const last = Number(item.last);
      const open = Number(item.open24h);
      const change = Number.isFinite(last) && Number.isFinite(open) && open > 0 ? ((last - open) / open) * 100 : null;
      const dataTime = new Date(Number(item.ts || Date.now())).toISOString();
      const common = { symbol, market: 'crypto', kind: 'spot', source: 'OKX', sourceId: 'okx_spot', sourceType: 'exchange', sourcePriority: 'fallback', dataTime, receivedAt: new Date().toISOString(), interval: '24h' };
      return [
        { ...common, metric: 'price', value: last, unit: 'USDT' },
        { ...common, metric: 'change24h', value: change, unit: 'percent' },
        { ...common, metric: 'volume24h', value: item.volCcy24h, unit: 'USDT' }
      ];
    }));
    return rows.flat();
  }
}
