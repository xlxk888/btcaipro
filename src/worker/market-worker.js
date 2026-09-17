import { normalizeObservation, observationKey } from '../model/market-data.js';
import { SnapshotBuilder } from '../core/snapshot.js';
import { BinanceSpotAdapter } from '../adapters/binance-spot.js';
import { OkxSpotAdapter } from '../adapters/okx-spot.js';
import { CoinGeckoSpotAdapter } from '../adapters/coingecko-spot.js';
import { BinanceDerivativesAdapter } from '../adapters/binance-derivatives.js';
import { FearGreedAdapter } from '../adapters/fear-greed.js';
import { Ahr999Adapter } from '../adapters/ahr999.js';
import { BinanceSpotStream } from '../adapters/binance-stream.js';
import { DisabledAdapter } from '../adapters/base.js';
import { AnomalyEngine } from '../engine/anomaly-engine.js';
import { EventGate } from '../engine/event-gate.js';
import { Scheduler } from './scheduler.js';
import { randomUUID } from 'node:crypto';

export class MarketWorker {
  constructor({ config, cache, store, logger, adapters = {} }) {
    this.config = config; this.cache = cache; this.store = store; this.logger = logger;
    this.observations = new Map(); this.snapshotBuilder = new SnapshotBuilder();
    const options = { logger, timeoutMs: config.requestTimeoutMs };
    this.adapters = {
      spot: adapters.spot || [new BinanceSpotAdapter(options), new OkxSpotAdapter(options), new CoinGeckoSpotAdapter(options)],
      derivatives: adapters.derivatives || new BinanceDerivativesAdapter(options),
      sentiment: adapters.sentiment || new FearGreedAdapter(options),
      valuation: adapters.valuation || new Ahr999Adapter(options),
      liquidations: adapters.liquidations || new DisabledAdapter({ id: 'liquidations', kind: 'liquidations', reason: 'No stable, keyless aggregate liquidation source is configured', logger })
    };
    this.engine = new AnomalyEngine(); this.gate = new EventGate({ cache }); this.workerId = `${process.pid}:${randomUUID()}`;
    this.scheduler = new Scheduler({ logger }); this.started = false; this.lastSnapshotAt = null;
    this.stream = adapters.stream === null ? null : (adapters.stream || new BinanceSpotStream({ symbols: config.symbols, onRows: rows => this.ingest(rows), onStatus: status => this.saveStatus(status), logger }));
    this.scheduler.add({ name: 'spot-rest', intervalMs: config.spotPollMs, task: () => this.collectSpot() });
    this.scheduler.add({ name: 'derivatives', intervalMs: config.derivativesPollMs, task: () => this.collectAdapter(this.adapters.derivatives, config.symbols) });
    this.scheduler.add({ name: 'low-frequency', intervalMs: 60 * 60_000, maxBackoffMs: 6 * 60 * 60_000, task: () => this.collectLowFrequency() });
    this.scheduler.add({ name: 'snapshot', intervalMs: config.snapshotIntervalMs, initialDelayMs: 2_000, task: () => this.buildSnapshot() });
    this.scheduler.add({ name: 'retention', intervalMs: 6 * 60 * 60_000, task: () => this.runRetention() });
    this.scheduler.add({ name: 'worker-lock', intervalMs: 30_000, initialDelayMs: 30_000, task: () => this.renewLock() });
  }

  async start() {
    if (this.started) return false;
    const lock = await this.cache.setIfAbsent('worker:market:started', this.workerId, 120_000);
    if (!lock) { this.logger?.warn('worker_duplicate_prevented', {}); return false; }
    this.started = true; this.stream?.start(); this.scheduler.start();
    this.logger?.info('worker_started', { symbols: this.config.symbols });
    return true;
  }

  async renewLock() {
    const owner = await this.cache.get('worker:market:started');
    if (owner !== this.workerId) { this.logger?.error('worker_lock_lost', {}); this.stop(); throw new Error('Worker lock lost'); }
    await this.cache.set('worker:market:started', this.workerId, 120_000);
  }

  async stop() {
    this.started = false; this.stream?.stop(); this.scheduler.stop();
    if (await this.cache.get('worker:market:started') === this.workerId) await this.cache.delete('worker:market:started');
    this.logger?.info('worker_stopped', {});
  }

  ingest(rows) {
    for (const raw of rows || []) {
      const observation = normalizeObservation(raw);
      this.observations.set(observationKey(observation.symbol, observation.metric), observation);
      this.cache.set(`market:${observationKey(observation.symbol, observation.metric)}`, JSON.stringify(observation), 2 * 60 * 60_000);
    }
  }

  async saveStatus(status) {
    const normalized = { id: status.id || status.source, kind: status.kind || 'spot', ...status };
    this.store.saveSourceStatus(normalized);
    await this.cache.set(`source:${normalized.id}`, JSON.stringify(normalized), 24 * 60 * 60_000);
  }

  async collectAdapter(adapter, ...args) {
    try { const rows = await adapter.run(...args); this.ingest(rows); return rows; }
    finally { this.store.saveSourceStatus(adapter.status); }
  }

  async collectSpot() {
    let lastError;
    for (const adapter of this.adapters.spot) {
      try {
        const rows = await this.collectAdapter(adapter, this.config.symbols);
        if (rows.length) {
          if (adapter !== this.adapters.spot[0]) this.logger?.warn('spot_fallback_active', { source: adapter.id });
          return rows;
        }
      } catch (error) { lastError = error; this.logger?.warn('spot_source_fallback', { source: adapter.id, error: error.message }); }
    }
    throw lastError || new Error('All spot sources unavailable');
  }

  async collectLowFrequency() {
    const results = await Promise.allSettled([
      this.collectAdapter(this.adapters.sentiment),
      this.collectAdapter(this.adapters.valuation, this.observations.get(observationKey('BTCUSDT', 'price'))?.value)
    ]);
    if (results.every(result => result.status === 'rejected')) throw new Error('All low-frequency sources unavailable');
    this.store.saveSourceStatus(this.adapters.liquidations.status);
  }

  async buildSnapshot() {
    if (!this.observations.size) return null;
    const snapshot = this.snapshotBuilder.build(this.observations);
    const history = this.store.listSnapshots(120);
    const candidates = this.engine.detect(snapshot, history, { includeSignals: true });
    const events = [];
    for (const candidate of candidates) {
      const event = await this.gate.admit(candidate);
      if (event) { this.store.saveEvent(event); events.push(event); this.logger?.warn('anomaly_event_created', { eventId: event.eventId, asset: event.asset, type: event.eventType, severity: event.severity }); }
    }
    this.store.saveSnapshot(snapshot); this.lastSnapshotAt = snapshot.createdAt;
    await this.cache.set('market:snapshot:latest', JSON.stringify(snapshot), Math.max(this.config.snapshotIntervalMs * 3, 60_000));
    return { snapshot, events };
  }

  runRetention() { const result = this.store.prune({ snapshotDays: this.config.snapshotRetentionDays, eventDays: this.config.eventRetentionDays }); this.logger?.info('retention_complete', result); return result; }
  status() { return { started: this.started, lastSnapshotAt: this.lastSnapshotAt, observations: this.observations.size, tasks: this.scheduler.status(), streamEnabled: Boolean(this.stream) }; }
}
