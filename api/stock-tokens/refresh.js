import { SharedStockTokenRepository } from '../../src/stock-tokens/repository.js';
import { createStockTokenAdapters } from '../../src/stock-tokens/adapters.js';
import { StockTokenWorker } from '../../src/stock-tokens/worker.js';

export function createStockTokenRefreshHandler({
  databaseUrl = process.env.DATABASE_URL,
  cronSecret = process.env.CRON_SECRET,
  repositoryFactory = () => SharedStockTokenRepository.create({ databaseUrl, migrate: true }),
  workerFactory = repository => new StockTokenWorker({
    repository,
    adapters: createStockTokenAdapters({ timeoutMs: 6_000, retries: 1 })
  })
} = {}) {
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      if (!databaseUrl) return Response.json({ error: 'stock_token_registry_unconfigured' }, { status: 503 });

      let repository;
      const startedAt = Date.now();
      try {
        repository = await repositoryFactory();
        const providers = await workerFactory(repository).poll();
        return Response.json({
          ok: true,
          durationMs: Date.now() - startedAt,
          providers,
          health: await repository.health()
        }, { headers: { 'Cache-Control': 'private, no-store' } });
      } catch (error) {
        return Response.json({
          error: 'stock_token_refresh_failed',
          message: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt
        }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
      } finally {
        try { await repository?.close?.(); } catch (_) {}
      }
    }
  };
}

export default createStockTokenRefreshHandler();
