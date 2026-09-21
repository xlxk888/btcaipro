import { SharedDiscoveryRepository } from '../../src/discovery/shared-repository.js';

export function createDiscoveryHealthHandler({ databaseUrl = process.env.DATABASE_URL,
  repositoryFactory = () => SharedDiscoveryRepository.create({ databaseUrl, migrate: false }) } = {}) {
  let repository, initialization;
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      if (!databaseUrl) return Response.json({ database: 'unconfigured', workerRunning: false,
        lastCheckpoint: null, lastSuccessfulScan: null, indexedAssetCount: 0, indexedPoolCount: 0,
        lastError: null, status: 'degraded' }, { headers: { 'Cache-Control': 'no-store' } });
      try {
        initialization ||= repositoryFactory().then(value => { repository = value; return value; });
        return Response.json(await (await initialization).health(), { headers: { 'Cache-Control': 'no-store' } });
      } catch (_) {
        try { await repository?.close?.(); } catch (_) {}
        repository = null; initialization = null;
        return Response.json({ database: 'disconnected', workerRunning: false, lastCheckpoint: null,
          lastSuccessfulScan: null, indexedAssetCount: null, indexedPoolCount: null, lastError: null,
          status: 'degraded' }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }
  };
}

export default createDiscoveryHealthHandler();
