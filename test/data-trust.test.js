import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSourceHealthSummary } from '../src/core/source-health.js';
import { calculateMinerEconomics, calculateShutdownPrice } from '../src/miners/miner-economics.js';
import { MINER_CATALOG, validateMinerCatalog } from '../src/miners/catalog.js';
import { createProvenance, validateProvenance } from '../src/provenance/source-definitions.js';
import { assertRepository, createEventStore, REPOSITORY_METHODS } from '../src/store/repository.js';
import { PostgresEventStore } from '../src/store/postgres-store.js';

const healthDefinitions = [
  { sourceId: 'primary', sourceName: 'Primary', sourceType: 'exchange', group: 'spot', role: 'primary', enabled: true, freshnessMs: 60_000 },
  { sourceId: 'fallback', sourceName: 'Fallback', sourceType: 'exchange', group: 'spot', role: 'fallback', enabled: true, freshnessMs: 60_000 },
  { sourceId: 'off', sourceName: 'Off', sourceType: 'market-data', group: 'optional', role: 'primary', enabled: false, freshnessMs: 0 }
];

test('source health excludes disabled sources from critical count', () => {
  const summary = getSourceHealthSummary([{ id: 'off', state: 'disabled', disabledReason: 'not configured' }], { definitions: healthDefinitions });
  assert.equal(summary.disabledCount, 1); assert.equal(summary.criticalCount, 0);
});

test('healthy fallback converts failed primary to fallback without a red incident', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const summary = getSourceHealthSummary([
    { id: 'primary', state: 'error', lastError: 'offline' },
    { id: 'fallback', state: 'healthy', lastSuccess: new Date(now).toISOString() }
  ], { definitions: healthDefinitions, now });
  assert.equal(summary.sources.find(source => source.sourceId === 'primary').status, 'fallback');
  assert.equal(summary.fallbackCount, 1); assert.equal(summary.criticalCount, 0);
});

test('unavailable source without usable fallback is critical', () => {
  const summary = getSourceHealthSummary([{ id: 'primary', state: 'unavailable' }], { definitions: healthDefinitions });
  assert.equal(summary.criticalCount, 1); assert.equal(summary.status, 'error');
});

test('miner economics and shutdown price are deterministic', () => {
  const input = { hashrateTH: 200, powerW: 3500, difficulty: 100e12, blockReward: 3.125, feeReward: 0.05, btcPrice: 80_000, electricityUsdPerKwh: 0.055 };
  const result = calculateMinerEconomics(input);
  assert.ok(result.btcPerDay > 0); assert.equal(result.electricityKwhPerDay, 84);
  assert.equal(result.shutdownPriceUsd, calculateShutdownPrice(input));
  assert.equal(result.profitable, input.btcPrice > result.shutdownPriceUsd);
});

test('miner catalog is extensible, unique, and covers four manufacturers', () => {
  const validation = validateMinerCatalog();
  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.deepEqual([...new Set(MINER_CATALOG.map(row => row.manufacturer))].sort(), ['Bitdeer', 'Bitmain', 'Canaan', 'MicroBT']);
  assert.ok(MINER_CATALOG.every(row => row.algorithm === 'SHA-256' && row.officialSource));
});

test('provenance validates normalized source identity and calculation method', () => {
  const value = createProvenance({ sourceId: 'ahr999_local', sourceName: 'Crypto AI AHR999', dataTime: '2026-01-01T00:00:00Z' });
  assert.equal(validateProvenance(value), true); assert.equal(value.sourceType, 'local-calculation'); assert.match(value.calculationMethod, /ahr999/);
});

test('SQLite and PostgreSQL adapters satisfy the same repository interface', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-ai-repository-'));
  const sqlite = await createEventStore({ databaseUrl: '', databasePath: path.join(directory, 'test.sqlite') });
  assertRepository(sqlite); assert.ok(REPOSITORY_METHODS.every(method => typeof sqlite[method] === 'function'));
  await sqlite.close(); fs.rmSync(directory, { recursive: true, force: true });

  class FakePool {
    constructor(options) { this.options = options; this.queries = []; }
    async query(sql, values = []) { this.queries.push({ sql, values }); return { rows: [], rowCount: 0 }; }
    async end() {}
  }
  const postgres = await PostgresEventStore.create('postgresql://example.invalid/cryptoai', { PoolClass: FakePool });
  assertRepository(postgres); assert.ok(postgres.pool.queries[0].sql.includes('CREATE TABLE IF NOT EXISTS snapshots'));
  await postgres.close();
});
