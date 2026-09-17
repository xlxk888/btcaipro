import { MarketDataAdapter } from './base.js';

export const AHR999_FORMULA_VERSION = 'ahr999-local-v1-geom200-powerlaw';

export function calculateAhr999(closePrices, currentPrice, now = Date.now()) {
  if (!Array.isArray(closePrices) || closePrices.length !== 200 || !closePrices.every(price => Number.isFinite(Number(price)) && Number(price) > 0)) throw new Error('AHR999 requires 200 valid closes');
  const geoMean200 = Math.exp(closePrices.reduce((sum, price) => sum + Math.log(Number(price)), 0) / closePrices.length);
  const genesis = new Date('2009-01-03T00:00:00Z').getTime();
  const daysSinceGenesis = (now - genesis) / 86_400_000;
  const fittedPrice = Math.pow(10, 5.84 * Math.log10(daysSinceGenesis) - 17.01);
  const value = (Number(currentPrice) / geoMean200) * (Number(currentPrice) / fittedPrice);
  if (!Number.isFinite(value) || value <= 0) throw new Error('AHR999 result invalid');
  return { value, geoMean200, fittedPrice, daysSinceGenesis };
}

export class Ahr999Adapter extends MarketDataAdapter {
  constructor(options = {}) { super({ id: 'ahr999_local', kind: 'valuation', ...options }); }

  async fetch(currentPrice) {
    const response = await this.request('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=201');
    const klines = await response.json();
    if (!Array.isArray(klines) || klines.length < 201) throw new Error('AHR999 kline data incomplete');
    const closed = klines.slice(0, -1);
    const closes = closed.map(row => Number(row?.[4]));
    const price = Number(currentPrice) > 0 ? Number(currentPrice) : closes.at(-1);
    const calculatedAt = Date.now();
    const result = calculateAhr999(closes, price, calculatedAt);
    return [{
      symbol: 'BTCUSDT', market: 'valuation', kind: 'valuation', metric: 'ahr999', value: result.value,
      unit: 'index', interval: 'daily/200d', source: 'Local estimate from Binance daily closes', sourcePriority: 'local',
      dataTime: new Date(calculatedAt).toISOString(), receivedAt: new Date().toISOString(),
      metadata: { formulaVersion: AHR999_FORMULA_VERSION, inputs: { currentPrice: price, closeCount: closes.length, geoMean200: result.geoMean200, fittedPrice: result.fittedPrice, daysSinceGenesis: result.daysSinceGenesis } }
    }];
  }
}
