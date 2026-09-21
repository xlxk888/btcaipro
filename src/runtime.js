import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { ResilientCache } from './cache/resilient-cache.js';
import { createEventStore } from './store/repository.js';
import { MarketWorker } from './worker/market-worker.js';
import { createDiscoveryRuntime } from './discovery/worker.js';
import { createNativeMarketService, MoneroNativeAssetAdapter } from './market/native-asset.js';

export async function createRuntime(overrides = {}) {
  const config = overrides.config || loadConfig();
  const logger = overrides.logger || createLogger(config.logLevel);
  const cache = overrides.cache || new ResilientCache({ redisUrl: config.redisUrl, logger });
  await cache.initialize?.();
  const store = overrides.store || await createEventStore(config);
  const worker = overrides.worker || new MarketWorker({ config, cache, store, logger });
  const discoveryChains = process.env.DISCOVERY_CHAINS?.split(',').map(value => value.trim()).filter(Boolean);
  const discovery = overrides.discovery || await createDiscoveryRuntime({ logger,
    databaseUrl: config.databaseUrl, databasePath: config.databasePath,
    chains: discoveryChains?.length ? discoveryChains : undefined });
  const nativeMarket = overrides.nativeMarket || createNativeMarketService({ cache: {
    get: async key => { const value = await cache.get(`native:${key}`); return value ? JSON.parse(value) : null; },
    set: (key, value, options) => cache.set(`native:${key}`, JSON.stringify(value), options.ttl * 1000)
  } });
  const moneroNetwork = overrides.moneroNetwork || new MoneroNativeAssetAdapter();
  return { config, logger, cache, store, worker, discovery, nativeMarket, moneroNetwork };
}
