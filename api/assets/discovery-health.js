import { SharedDiscoveryRepository } from '../../src/discovery/shared-repository.js';
import { SharedStockTokenRepository } from '../../src/stock-tokens/repository.js';

const defaultDiscoveryRepositoryFactory = databaseUrl => SharedDiscoveryRepository.create({ databaseUrl, migrate: false });
const defaultStockTokenRepositoryFactory = databaseUrl => SharedStockTokenRepository.create({ databaseUrl, migrate: false });

export function createDiscoveryHealthHandler({ databaseUrl = process.env.DATABASE_URL,
  repositoryFactory = () => defaultDiscoveryRepositoryFactory(databaseUrl),
  stockTokenRepositoryFactory = null } = {}) {
  let repository, stockTokenRepository, initialization;
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      if (!databaseUrl) return Response.json({ database: 'unconfigured', workerRunning: false,
        lastCheckpoint: null, lastSuccessfulScan: null, indexedAssetCount: 0, indexedPoolCount: 0,
        lastError: null, status: 'degraded' }, { headers: { 'Cache-Control': 'no-store' } });
      try {
        initialization ||= repositoryFactory().then(value => { repository = value; return value; });
        const health = await (await initialization).health();
        try {
          if (stockTokenRepositoryFactory) {
            stockTokenRepository ||= await stockTokenRepositoryFactory();
            health.stockTokens = await stockTokenRepository.health();
          }
        } catch (_) {
          health.stockTokens = { discovered: 0, active: 0, withPrice: 0, stale: 0,
            errors: [{ provider: 'registry', error: 'unavailable', timestamp: Date.now() }],
            lastDiscoveryAt: null, lastPriceUpdateAt: null };
        }
        return Response.json(health, { headers: { 'Cache-Control': 'no-store' } });
      } catch (_) {
        try { await repository?.close?.(); await stockTokenRepository?.close?.(); } catch (_) {}
        repository = null; initialization = null;
        stockTokenRepository = null;
        return Response.json({ database: 'disconnected', workerRunning: false, lastCheckpoint: null,
          lastSuccessfulScan: null, indexedAssetCount: null, indexedPoolCount: null, lastError: null,
          status: 'degraded' }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }
  };
}

export default createDiscoveryHealthHandler({
  stockTokenRepositoryFactory: () => defaultStockTokenRepositoryFactory(process.env.DATABASE_URL)
});
