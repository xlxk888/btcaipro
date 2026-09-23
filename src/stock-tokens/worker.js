import { Scheduler } from '../worker/scheduler.js';
import { createStockTokenAdapters } from './adapters.js';

export class StockTokenWorker {
  constructor({ repository, adapters, logger, intervalMs = 5 * 60_000, timeoutMs = 8_000 } = {}) {
    this.repository = repository; this.logger = logger;
    this.adapters = adapters || createStockTokenAdapters({ logger, timeoutMs });
    this.scheduler = new Scheduler({ logger }); this.started = false;
    this.scheduler.add({ name: 'stock-token-discovery', intervalMs, task: () => this.poll(), maxBackoffMs: 30 * 60_000 });
  }
  async poll(now = Date.now()) {
    const results = [];
    // Sequential adapters keep upstream concurrency bounded. Each adapter uses
    // at most two parallel bulk requests, never one request per instrument.
    for (const adapter of this.adapters) {
      try {
        const markets = await adapter.discover(now);
        await this.repository.replaceVenueMarkets(adapter.venue, markets, now);
        const lastPriceUpdateAt = Math.max(0, ...markets.filter(market => market.price > 0).map(market => market.lastUpdated)) || null;
        await this.repository.saveProviderState(adapter.id, { endpoint: adapter.endpoint, status: 'ok',
          discovered: markets.length, lastDiscoveryAt: now, lastPriceUpdateAt, error: null, updatedAt: now });
        results.push({ provider: adapter.id, status: 'ok', discovered: markets.length });
      } catch (error) {
        const previous = this.repository.providers.get(adapter.id);
        const failure = { provider: adapter.id, endpoint: adapter.endpoint, error: error.message,
          timestamp: now };
        await this.repository.saveProviderState(adapter.id, { ...previous, endpoint: adapter.endpoint,
          status: 'error', error: failure, updatedAt: now });
        this.logger?.warn?.('stock_token_provider_failure', failure);
        results.push({ provider: adapter.id, status: 'error', error: error.message });
      }
    }
    if (results.every(result => result.status === 'error')) throw new Error('All stock-token providers unavailable');
    return results;
  }
  start() { if (this.started) return false; this.started = true; this.scheduler.start(); return true; }
  stop() { this.started = false; this.scheduler.stop(); }
  status() { return { started: this.started, tasks: this.scheduler.status() }; }
}

