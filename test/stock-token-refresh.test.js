import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStockTokenMarketsHandler } from '../api/stock-tokens/markets.js';
import { MemoryStockTokenRepository, SharedStockTokenRepository } from '../src/stock-tokens/repository.js';
import { GateStockTokenAdapter, RobinhoodStockTokenAdapter } from '../src/stock-tokens/adapters.js';
import { createStockTokenMarket } from '../src/stock-tokens/model.js';
import { refreshDueStockTokens, STOCK_TOKEN_REFRESH_MS } from '../src/stock-tokens/refresh.js';

const quote = (time, price = 95, venue = 'Gate') => createStockTokenMarket({ productType: 'xstocks',
  venue, exchangeSymbol: 'CRCLX_USDT', baseAsset: 'CRCLX', quoteAsset: 'USDT', price,
  change24h: price / 10, volume24h: price * 100, lastUpdated: time }, { now: time });
const request = () => new Request('https://example.test/api/stock-tokens/markets');
const response = body => ({ ok: true, json: async () => body });

test('warm market API reloads externally refreshed database quotes instead of retaining its first snapshot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-refresh-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const writer = await SharedStockTokenRepository.create({ databasePath });
  const reader = await SharedStockTokenRepository.create({ databasePath });
  try {
    const before = Date.now() - 600_000;
    await writer.replaceVenueMarkets('Gate', [quote(before)]);
    const handler = createStockTokenMarketsHandler({ databaseUrl: 'test', repositoryFactory: async () => reader, refresh: async () => {} });
    const first = await (await handler.fetch(request())).json();
    assert.equal(first.data[0].lastUpdated, before);
    assert.equal(first.data[0].stale, true);
    const after = Date.now();
    await writer.replaceVenueMarkets('Gate', [quote(after, 96)]);
    const result = await handler.fetch(request());
    const second = await result.json();
    assert.equal(second.data[0].lastUpdated, after);
    assert.equal(second.data[0].price, 96);
    assert.equal(second.data[0].stale, false);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  } finally {
    await writer.close(); await reader.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('concurrent market readers share one database reload and one bounded refresh', async () => {
  const repository = new MemoryStockTokenRepository();
  let loads = 0, refreshes = 0;
  repository.load = async () => { loads++; return repository; };
  const handler = createStockTokenMarketsHandler({ databaseUrl: 'test', repositoryFactory: async () => repository,
    refresh: async repo => { refreshes++; await repo.replaceVenueMarkets('Gate', [quote(Date.now())]); } });
  const results = await Promise.all(Array.from({ length: 100 }, () => handler.fetch(request())));
  assert.equal(loads, 1); assert.equal(refreshes, 1);
  assert.ok(results.every(result => result.status === 200));
});

test('two successive due cycles refresh real quote fields and timestamps without relaxing five-minute stale threshold', async () => {
  const repository = new MemoryStockTokenRepository();
  const times = [];
  const adapter = { id: 'gate-stock-tokens', venue: 'Gate', async discover(now) { times.push(now); return [quote(now, 95 + times.length)]; } };
  for (const now of [1_000_000, 1_000_001, 1_060_000, 1_120_000]) {
    await refreshDueStockTokens(repository, { now, adapters: [adapter] });
  }
  assert.deepEqual(times, [1_000_000, 1_060_000, 1_120_000]);
  const latest = (await repository.list({ now: 1_120_000 }))[0];
  assert.equal(latest.lastUpdated, 1_120_000); assert.equal(latest.price, 98);
  assert.equal(latest.volume24h, 9800); assert.equal(latest.change24h, 9.8);
  assert.equal(latest.stale, false); assert.equal(repository.staleAfterMs, 300_000);
  assert.equal(STOCK_TOKEN_REFRESH_MS, 60_000);
});

test('failed upstream keeps real old quotes stale and retries only after the refresh interval', async () => {
  const repository = new MemoryStockTokenRepository();
  await repository.replaceVenueMarkets('Gate', [quote(1_000)]);
  let calls = 0;
  const adapter = { id: 'gate-stock-tokens', venue: 'Gate', async discover() { calls++; throw new Error('Gate HTTP 503'); } };
  await refreshDueStockTokens(repository, { now: 1_000_000, adapters: [adapter] });
  await refreshDueStockTokens(repository, { now: 1_000_001, adapters: [adapter] });
  const saved = (await repository.list({ now: 1_000_001 }))[0];
  assert.equal(saved.lastUpdated, 1_000); assert.equal(saved.stale, true); assert.equal(calls, 1);
  assert.equal(repository.providers.get(adapter.id).status, 'error');
});

test('refresh rechecks persisted attempt time after acquiring the cross-instance lock', async () => {
  const repository = new MemoryStockTokenRepository();
  let called = false;
  const adapter = { id: 'gate-stock-tokens', async discover() { called = true; } };
  repository.withRefreshLock = async task => {
    const updated = new MemoryStockTokenRepository();
    updated.providers.set(adapter.id, { updatedAt: 1_000_000 });
    await task(updated);
  };
  await refreshDueStockTokens(repository, { now: 1_000_001, adapters: [adapter] });
  assert.equal(called, false);
});

test('provider-scoped persistence cannot overwrite another providers newly refreshed database snapshot', async () => {
  const calls = [];
  const repository = new SharedStockTokenRepository({ pool: { query: async (sql, params) => { calls.push({ sql, params }); } } });
  repository.markets.set('old-other', quote(1, 1, 'Other'));
  repository.providers.set('old-other', { provider: 'old-other', status: 'ok', updatedAt: 1 });
  await repository.replaceVenueMarkets('Gate', [quote(2)]);
  assert.equal(calls.length, 1);
  assert.ok(JSON.parse(calls[0].params[0]).every(row => row.venue === 'Gate'));
  await repository.saveProviderState('gate-stock-tokens', { status: 'ok', updatedAt: 2 });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].params[0]).map(row => row.provider), ['gate-stock-tokens']);
});

test('database refresh lock is transaction-scoped and always releases its client', async () => {
  for (const acquired of [true, false]) {
    const queries = []; let released = false, called = false;
    const client = { query: async sql => { queries.push(sql); return { rows: sql.includes('pg_try') ? [{ acquired }] : [] }; }, release() { released = true; } };
    const repository = new SharedStockTokenRepository({ pool: { connect: async () => client } });
    assert.equal(await repository.withRefreshLock(async () => { called = true; }), acquired);
    assert.equal(called, acquired); assert.equal(released, true);
    assert.match(queries[1], /pg_try_advisory_xact_lock/);
    assert.equal(queries.at(-1), acquired ? 'COMMIT' : 'ROLLBACK');
  }
});

test('database refresh errors roll back and release the lock', async () => {
  const queries = []; let released = false;
  const client = { query: async sql => { queries.push(sql); return { rows: sql.includes('pg_try') ? [{ acquired: true }] : [] }; }, release() { released = true; } };
  const repository = new SharedStockTokenRepository({ pool: { connect: async () => client } });
  await assert.rejects(repository.withRefreshLock(async () => { throw new Error('DB write failed'); }), /DB write failed/);
  assert.equal(queries.at(-1), 'ROLLBACK'); assert.equal(released, true);
});

test('Robinhood reference timestamps keep their own UTC/CST-equivalent quote time and never fabricate freshness', async () => {
  const timestamp = Date.parse('2026-09-23T06:00:00Z');
  const assets = { assets: [{ tokenSymbol: 'AAPL', tokenName: 'Apple', currentMultiplier: '1', status: 'ASSET_STATUS_ACTIVE',
    deployments: [{ chainId: 4663, contractAddress: '0xabc' }] }] };
  for (const generatedAt of ['2026-09-23T06:00:00Z', '2026-09-23T14:00:00+08:00', undefined, 'invalid']) {
    const prices = { quotes: [{ tokenSymbol: 'AAPL', bid: '100', ask: '102', generatedAt }] };
    const adapter = new RobinhoodStockTokenAdapter({ retries: 0, fetchImpl: async url => response(url.endsWith('/assets') ? assets : prices) });
    const [market] = await adapter.discover(timestamp + 1_000);
    assert.equal(market.lastUpdated, generatedAt && generatedAt !== 'invalid' ? timestamp : 0);
    assert.equal(market.stale, !generatedAt || generatedAt === 'invalid');
    assert.equal(market.price, 101); assert.equal(market.sourceType, 'issuer_reference');
    assert.equal(market.change24h, null); assert.equal(market.volume24h, null); assert.equal(market.lastTradeTime, null);
  }
});

test('Gate metadata without a valid ticker does not create a fresh timestamp or a last trade time', async () => {
  const pairs = [{ id: 'CRCLX_USDT', base: 'CRCLX', base_name: 'Circle xStock', quote: 'USDT', trade_status: 'tradable' }];
  const adapter = new GateStockTokenAdapter({ retries: 0, fetchImpl: async url => response(url.includes('currency_pairs') ? pairs : []) });
  const [market] = await adapter.discover(1_000_000);
  assert.equal(market.lastUpdated, 0); assert.equal(market.stale, true);
  assert.equal(market.price, null); assert.equal(market.lastTradeTime, null);
});
