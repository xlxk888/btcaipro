import { SharedDiscoveryRepository } from '../../src/discovery/shared-repository.js';
import { createAssetSearchService, DexMarketProvider } from '../../src/discovery/search.js';

let service;
let repository;
let initialization;
async function initialize() {
  if (service) return service;
  initialization ||= (async () => {
    if (process.env.VERCEL && !process.env.DATABASE_URL) throw new Error('Shared discovery DATABASE_URL is required in production');
    repository = await SharedDiscoveryRepository.create({ databaseUrl: process.env.DATABASE_URL || '', databasePath: process.env.DATABASE_PATH });
    service = createAssetSearchService({ repository, provider: new DexMarketProvider() });
    return service;
  })().catch(error => { initialization = null; throw error; });
  return initialization;
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    try { await initialize(); } catch (_) { return Response.json({ error: 'discovery_index_unavailable' }, { status: 503 }); }
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const chain = url.searchParams.get('chain') || 'auto';
    let result;
    try { result = await service.search(q, chain); } catch (_) { return Response.json({ error: 'discovery_index_unavailable' }, { status: 503 }); }
    return Response.json(result, {
      status: result.status === 'ok' ? 200 : 400,
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' }
    });
  }
};
