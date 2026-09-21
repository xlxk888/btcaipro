import { DiscoveryRepository } from '../../src/discovery/repository.js';
import { SharedDiscoveryRepository } from '../../src/discovery/shared-repository.js';
import { createAssetSearchService, DexMarketProvider } from '../../src/discovery/search.js';

async function productionRepository() {
  if (process.env.VERCEL && !process.env.DATABASE_URL) throw new Error('Shared DATABASE_URL is not configured');
  return SharedDiscoveryRepository.create({ databaseUrl: process.env.DATABASE_URL || '', databasePath: process.env.DATABASE_PATH,
    migrate: !process.env.VERCEL });
}

export function createAssetSearchHandler({ repositoryFactory = productionRepository, provider = new DexMarketProvider() } = {}) {
  const degradedService = createAssetSearchService({ repository: new DiscoveryRepository(), provider });
  let repository, service, initialization;
  async function sharedService() {
    if (service) return service;
    initialization ||= repositoryFactory().then(result => {
      repository = result;
      service = createAssetSearchService({ repository, provider });
      return service;
    }).finally(() => { initialization = null; });
    return initialization;
  }
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      const url = new URL(request.url);
      const q = url.searchParams.get('q') || '';
      const chain = url.searchParams.get('chain') || 'auto';
      let result, indexStatus = 'connected';
      try { result = await (await sharedService()).search(q, chain); }
      catch (_) {
        indexStatus = 'unavailable';
        service = null;
        if (repository) {
          try { await repository.close?.(); } catch (_) { /* Retry with a new connection next request. */ }
          repository = null;
        }
        result = await degradedService.search(q, chain);
      }
      return Response.json({ ...result, indexStatus, degraded: indexStatus !== 'connected' }, {
        status: result.status === 'ok' ? 200 : 400,
        headers: { 'Cache-Control': indexStatus === 'connected' ? 'public, max-age=0, s-maxage=60' : 'public, max-age=0, s-maxage=15' }
      });
    }
  };
}

export default createAssetSearchHandler();
