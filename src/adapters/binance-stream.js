export class BinanceSpotStream {
  constructor({ symbols, onRows, onStatus, logger, maxBackoffMs = 60_000 }) {
    this.symbols = symbols;
    this.onRows = onRows;
    this.onStatus = onStatus;
    this.logger = logger;
    this.maxBackoffMs = maxBackoffMs;
    this.socket = null;
    this.retry = 0;
    this.timer = null;
    this.stopped = true;
  }

  start() { if (!this.stopped) return; this.stopped = false; this.connect(); }
  connect() {
    if (this.stopped || typeof WebSocket === 'undefined') return;
    const streams = this.symbols.map(symbol => `${symbol.toLowerCase()}@ticker`).join('/');
    this.onStatus?.({ state: 'connecting', source: 'binance_spot_ws' });
    this.socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    this.socket.addEventListener('open', () => { this.retry = 0; this.onStatus?.({ state: 'healthy', source: 'binance_spot_ws', lastSuccess: new Date().toISOString() }); });
    this.socket.addEventListener('message', event => {
      try {
        const item = JSON.parse(event.data)?.data;
        if (!item?.s) return;
        const common = { symbol: item.s, market: 'crypto', kind: 'spot', source: 'Binance WebSocket', sourcePriority: 'primary', dataTime: new Date(Number(item.E || Date.now())).toISOString(), receivedAt: new Date().toISOString(), interval: '24h' };
        this.onRows?.([
          { ...common, metric: 'price', value: item.c, unit: 'USDT' },
          { ...common, metric: 'change24h', value: item.P, unit: 'percent' },
          { ...common, metric: 'volume24h', value: item.q, unit: 'USDT' }
        ]);
      } catch (error) { this.logger?.warn('stream_message_invalid', { source: 'binance_spot_ws', error: error.message }); }
    });
    this.socket.addEventListener('error', () => this.onStatus?.({ state: 'error', source: 'binance_spot_ws' }));
    this.socket.addEventListener('close', () => this.reconnect());
  }
  reconnect() {
    if (this.stopped) return;
    const delay = Math.min(this.maxBackoffMs, 1_000 * 2 ** Math.min(this.retry++, 6));
    this.onStatus?.({ state: 'backoff', source: 'binance_spot_ws', retryInMs: delay });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), delay);
  }
  stop() { this.stopped = true; clearTimeout(this.timer); if (this.socket) this.socket.close(); this.socket = null; }
}
