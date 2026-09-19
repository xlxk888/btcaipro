import { SQLiteEventStore } from './sqlite-store.js';
import { PostgresEventStore } from './postgres-store.js';

export const REPOSITORY_METHODS = Object.freeze([
  'saveSnapshot', 'latestSnapshot', 'listSnapshots', 'saveEvent', 'listEvents',
  'latestEvent', 'saveSourceStatus', 'listSourceStatuses', 'prune', 'close'
]);

export function assertRepository(store) {
  for (const method of REPOSITORY_METHODS) if (typeof store?.[method] !== 'function') throw new TypeError(`Repository missing method: ${method}`);
  return store;
}

export async function createEventStore(config, options = {}) {
  if (config.databaseUrl) return assertRepository(await PostgresEventStore.create(config.databaseUrl, options));
  return assertRepository(new SQLiteEventStore(config.databasePath));
}
