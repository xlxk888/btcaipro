import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { ResilientCache } from './cache/resilient-cache.js';
import { createEventStore } from './store/repository.js';
import { MarketWorker } from './worker/market-worker.js';
import { createDiscoveryRuntime } from './discovery/worker.js';

export async function createRuntime(overrides = {}) {
  const config = overrides.config || loadConfig();
  const logger = overrides.logger || createLogger(config.logLevel);
  const cache = overrides.cache || new ResilientCache({ redisUrl: config.redisUrl, logger });
  await cache.initialize?.();
  const store = overrides.store || await createEventStore(config);
  const worker = overrides.worker || new MarketWorker({ config, cache, store, logger });
  const discovery = overrides.discovery || await createDiscoveryRuntime({ logger,
    chains: process.env.DISCOVERY_CHAINS?.split(',').map(value => value.trim()).filter(Boolean) });
  return { config, logger, cache, store, worker, discovery };
}
