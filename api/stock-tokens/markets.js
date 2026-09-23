import { SharedStockTokenRepository } from '../../src/stock-tokens/repository.js';

export function createStockTokenMarketsHandler({ databaseUrl = process.env.DATABASE_URL,
  repositoryFactory = () => SharedStockTokenRepository.create({ databaseUrl, migrate: false }) } = {}) {
  let repository, initialization;
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      if (!databaseUrl) return Response.json({ error: 'stock_token_registry_unconfigured', data: [], count: 0 }, { status: 503 });
      try {
        initialization ||= repositoryFactory().then(value => { repository = value; return value; });
        const url = new URL(request.url);
        const markets = await (await initialization).list({ underlying: url.searchParams.get('underlying') || undefined,
          venue: url.searchParams.get('venue') || undefined });
        return Response.json({ data: markets, count: markets.length, health: await repository.health() }, {
          headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=120' }
        });
      } catch (_) {
        try { await repository?.close?.(); } catch (_) {}
        repository = null; initialization = null;
        return Response.json({ error: 'stock_token_registry_unavailable', data: [], count: 0 }, { status: 503 });
      }
    }
  };
}

export default createStockTokenMarketsHandler();
