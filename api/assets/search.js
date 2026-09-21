import { getCache } from '@vercel/functions';
import { DiscoveryRepository } from '../../src/discovery/repository.js';
import { createAssetSearchService, DexMarketProvider } from '../../src/discovery/search.js';

// The serverless reader never scans chains. A shared discovery worker must
// publish an index snapshot to this namespace before onchain results appear.
let service;
let lastSnapshotAt = 0;
let cache;
let repository;
function initialize() {
  if (service) return;
  cache = getCache({ namespace: 'asset-discovery' });
  repository = new DiscoveryRepository();
  service = createAssetSearchService({ repository, provider: new DexMarketProvider() });
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    initialize();
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const chain = url.searchParams.get('chain') || 'auto';
    if (Date.now() - lastSnapshotAt > 60_000) {
      try {
        const snapshot = await cache.get('index-v1');
        if (snapshot?.assets && snapshot?.pools) {
          repository.assets = new Map(snapshot.assets);
          repository.pools = new Map(snapshot.pools);
        }
      } catch (_) { /* A warm instance keeps its last verified index. */ }
      lastSnapshotAt = Date.now();
    }
    const result = await service.search(q, chain);
    return Response.json(result, {
      status: result.status === 'ok' ? 200 : 400,
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' }
    });
  }
};
