import { SharedStockTokenRepository } from '../../src/stock-tokens/repository.js';
import { refreshDueStockTokens } from '../../src/stock-tokens/refresh.js';

export function createStockTokenMarketsHandler({ databaseUrl = process.env.DATABASE_URL,
  repositoryFactory = () => SharedStockTokenRepository.create({ databaseUrl, migrate: false }),
  refresh = refreshDueStockTokens } = {}) {
  let repository, initialization, reading;
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      if (!databaseUrl) return Response.json({ error: 'stock_token_registry_unconfigured', data: [], count: 0 }, { status: 503 });
      try {
        initialization ||= repositoryFactory().then(value => { repository = value; return value; });
        const url = new URL(request.url);
        reading ||= (async () => {
          const current = await initialization;
          await current.load();
          await refresh(current);
          return { data: await current.list(), health: await current.health() };
        })().finally(() => { reading = null; });
        const snapshot = await reading;
        const underlying = url.searchParams.get('underlying')?.toUpperCase();
        const venue = url.searchParams.get('venue')?.toLowerCase();
        const markets = snapshot.data.filter(market => (!underlying || market.underlyingSymbol === underlying)
          && (!venue || market.venue.toLowerCase() === venue));
        return Response.json({ data: markets, count: markets.length, health: snapshot.health }, {
          headers: { 'Cache-Control': 'no-store' }
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
