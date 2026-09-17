import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { ResilientCache } from './cache/resilient-cache.js';
import { SQLiteEventStore } from './store/sqlite-store.js';
import { MarketWorker } from './worker/market-worker.js';

export async function createRuntime(overrides = {}) {
  const config = overrides.config || loadConfig();
  const logger = overrides.logger || createLogger(config.logLevel);
  const cache = overrides.cache || new ResilientCache({ redisUrl: config.redisUrl, logger });
  await cache.initialize?.();
  const store = overrides.store || new SQLiteEventStore(config.databasePath);
  const worker = overrides.worker || new MarketWorker({ config, cache, store, logger });
  return { config, logger, cache, store, worker };
}
