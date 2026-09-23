import { GateStockTokenAdapter, RobinhoodStockTokenAdapter } from './adapters.js';
import { StockTokenWorker } from './worker.js';

export const STOCK_TOKEN_REFRESH_MS = 60_000;

// Reuse the existing worker and database when the scheduler has not refreshed
// recently. The DB lock + persisted attempt time bound work across warm/cold
// instances. Bybit and all other providers are deliberately out of scope.
export async function refreshDueStockTokens(repository, {
  now = Date.now(), intervalMs = STOCK_TOKEN_REFRESH_MS,
  adapters = [new GateStockTokenAdapter({ timeoutMs: 4_000, retries: 0 }),
    new RobinhoodStockTokenAdapter({ timeoutMs: 4_000, retries: 0 })]
} = {}) {
  const due = repo => adapters.filter(adapter => {
    const lastAttempt = Number(repo.providers.get(adapter.id)?.updatedAt) || 0;
    return !lastAttempt || now - lastAttempt >= intervalMs;
  });
  if (!due(repository).length) return;
  await repository.withRefreshLock(async locked => {
    const pending = due(locked);
    if (!pending.length) return;
    try { await new StockTokenWorker({ repository: locked, adapters: pending }).poll(now); }
    catch (error) {
      // Provider failures are persisted by the worker; retain honest old quotes.
      // Persistence/DB failures must still escape and fail the API request.
      if (error.message !== 'All stock-token providers unavailable') throw error;
    }
  });
}
