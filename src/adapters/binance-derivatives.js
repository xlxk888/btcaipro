import { MarketDataAdapter } from './base.js';

export class BinanceDerivativesAdapter extends MarketDataAdapter {
  constructor(options = {}) { super({ id: 'binance_derivatives', kind: 'derivatives', ...options }); }

  async fetch(symbols = ['BTCUSDT', 'ETHUSDT']) {
    const rows = await Promise.all(symbols.filter(symbol => ['BTCUSDT', 'ETHUSDT'].includes(symbol)).map(async symbol => {
      const [oiResponse, fundingResponse] = await Promise.all([
        this.request(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
        this.request(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`)
      ]);
      const [oi, funding] = await Promise.all([oiResponse.json(), fundingResponse.json()]);
      const receivedAt = new Date().toISOString();
      return [
        { symbol, market: 'crypto_derivatives', kind: 'derivatives', metric: 'openInterest', value: oi.openInterest, unit: symbol.replace(/USDT$/, ''), interval: 'current', source: 'Binance Futures', sourcePriority: 'primary', dataTime: new Date(Number(oi.time || Date.now())).toISOString(), receivedAt },
        { symbol, market: 'crypto_derivatives', kind: 'derivatives', metric: 'fundingRate', value: funding.lastFundingRate, unit: 'ratio', interval: '8h', source: 'Binance Futures', sourcePriority: 'primary', dataTime: new Date(Number(funding.time || Date.now())).toISOString(), receivedAt, metadata: { nextFundingTime: funding.nextFundingTime ? new Date(Number(funding.nextFundingTime)).toISOString() : null } }
      ];
    }));
    return rows.flat();
  }
}
