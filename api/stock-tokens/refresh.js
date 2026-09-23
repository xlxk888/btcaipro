import { SharedStockTokenRepository } from '../../src/stock-tokens/repository.js';
import { createStockTokenAdapters } from '../../src/stock-tokens/adapters.js';
import { StockTokenWorker } from '../../src/stock-tokens/worker.js';

export function createStockTokenRefreshHandler({
  databaseUrl = process.env.DATABASE_URL,
  cronSecret = process.env.CRON_SECRET,
  repositoryFactory = () => SharedStockTokenRepository.create({ databaseUrl, migrate: true }),
  adapterFactory = () => createStockTokenAdapters({ timeoutMs: 6_000, retries: 1 }),
  workerFactory = (repository, adapters) => new StockTokenWorker({
    repository,
    adapters
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
        const provider = new URL(request.url).searchParams.get('provider');
        const available = adapterFactory();
        const adapters = provider ? available.filter(adapter => adapter.id === provider) : available;
        if (provider && adapters.length === 0) {
          return Response.json({ error: 'unknown_stock_token_provider', provider }, { status: 400 });
        }
        repository = await repositoryFactory();
        let providers, refreshError;
        const acquired = await repository.withRefreshLock(async locked => {
          try { providers = await workerFactory(locked, adapters).poll(); }
          catch (error) { refreshError = error; }
        });
        if (!acquired) return Response.json({ ok: true, skipped: 'refresh_in_progress' }, {
          status: 202, headers: { 'Cache-Control': 'private, no-store' }
        });
        if (refreshError) throw refreshError;
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
