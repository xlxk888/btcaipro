const INTERVALS = Object.freeze({ '1H': '1h', '4H': '4h', '1D': '1d', '1W': '7d', '1M': '30d' });

function normalizeCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [time, quoteVolume, close, high, low, open, baseVolume] = row;
  const candle = {
    time: Number(time) * 1000,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    quoteVolume: Number(quoteVolume),
    baseVolume: Number(baseVolume)
  };
  return Object.values(candle).every(Number.isFinite) && candle.time > 0 && candle.open > 0
    && candle.high > 0 && candle.low > 0 && candle.close > 0 ? candle : null;
}

export function createStockTokenKlinesHandler({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      const url = new URL(request.url);
      const venue = String(url.searchParams.get('venue') || '').trim();
      const pair = String(url.searchParams.get('pair') || '').trim().toUpperCase();
      const period = String(url.searchParams.get('period') || '1H').trim().toUpperCase();
      const interval = INTERVALS[period];
      if (venue !== 'Gate' || !/^[A-Z0-9]{2,24}_[A-Z0-9]{2,12}$/.test(pair) || !interval) {
        return Response.json({ error: 'unsupported_stock_token_kline' }, { status: 400 });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const endpoint = new URL('https://api.gateio.ws/api/v4/spot/candlesticks');
        endpoint.searchParams.set('currency_pair', pair);
        endpoint.searchParams.set('interval', interval);
        endpoint.searchParams.set('limit', period === '1H' ? '48' : '120');
        const response = await fetchImpl(endpoint, { signal: controller.signal, headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`Gate candlesticks HTTP ${response.status}`);
        const payload = await response.json();
        const data = Array.isArray(payload) ? payload.map(normalizeCandle).filter(Boolean).sort((a, b) => a.time - b.time) : [];
        if (!data.length) return Response.json({ error: 'kline_unavailable', data: [] }, { status: 503 });
        return Response.json({ data, venue: 'Gate', pair, period, interval, source: 'Gate Spot Candlesticks' }, {
          headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' }
        });
      } catch (_) {
        return Response.json({ error: 'kline_unavailable', data: [] }, { status: 503 });
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export default createStockTokenKlinesHandler();
