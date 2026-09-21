import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedDiscoveryRepository } from '../src/discovery/shared-repository.js';
import { createAssetSearchService, DexMarketProvider } from '../src/discovery/search.js';
import { createNativeMarketService, MoneroNativeAssetAdapter } from '../src/market/native-asset.js';

const address = token => `0x${token.repeat(40)}`;
const quote = { id: 'monero', symbol: 'xmr', name: 'Monero', current_price: 500, price_change_percentage_24h: 2,
  total_volume: 1e8, market_cap: 9.2e9, circulating_supply: 18.4e6, last_updated: '2026-09-21T10:00:00Z', fully_diluted_valuation: 1e11 };
const response = json => ({ ok: true, json: async () => json });

test('SQLite shared index persists PONS and checkpoint across worker restart; 1000 readers never scan chains', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-db-'));
  const databasePath = path.join(dir, 'index.sqlite');
  let db, reader;
  try {
    db = await SharedDiscoveryRepository.create({ databasePath });
    db.upsertAsset({ chain: 'robinhood', chainId: 4663, contractAddress: address('a'), symbol: 'PONS', name: 'Pons', verifiedOnChain: true });
    db.upsertPool({ chain: 'robinhood', poolAddress: address('b'), token0: address('a'), token1: address('c'),
      dexName: 'Uniswap V3', liquidityPositive: true, verifiedOnChain: true, firstSwapAt: 123, liquidityUsd: 200 });
    db.cursors.set('4663:factory', 345678);
    await db.persist();
    reader = await SharedDiscoveryRepository.create({ databasePath });
    await reader.load();
    assert.equal(reader.cursors.get('4663:factory'), 345678);
    let providerCalls = 0;
    const service = createAssetSearchService({ repository: reader, provider: { async search() { providerCalls++; return []; } } });
    const results = await Promise.all(Array.from({ length: 1000 }, () => service.search('PONS')));
    assert.ok(results.every(result => result.candidates[0]?.id === `evm:4663:${address('a')}`));
    assert.equal(providerCalls, 0);
    await reader.close(); reader = null;
    const restart = await SharedDiscoveryRepository.create({ databasePath });
    await restart.load();
    assert.equal(restart.cursors.get('4663:factory'), 345678);
    await restart.close();
  } finally { if (db) await db.close(); if (reader) await reader.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('shared index preserves two AI identities and STONK returns provider candidates without inventing Robinhood address', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-ai-'));
  const db = await SharedDiscoveryRepository.create({ databasePath: path.join(dir, 'db.sqlite') });
  try {
    for (const [chain, chainId, token] of [['base', 8453, 'a'], ['robinhood', 4663, 'b']]) {
      db.upsertAsset({ chain, chainId, contractAddress: address(token), symbol: 'AI', name: 'AI', verifiedOnChain: true });
      db.upsertPool({ chain, poolAddress: address('c'), token0: address(token), token1: address('d'),
        verifiedOnChain: true, liquidityPositive: true, firstSwapAt: 10 });
    }
    await db.persist();
    const service = createAssetSearchService({ repository: db, provider: { async search(q) { return q === 'STONK' ? [{ id: `evm:8453:${address('d')}`, source: 'dex-market-unverified' }] : []; } } });
    assert.equal((await service.search('AI')).candidates.length, 2);
    assert.deepEqual((await service.search('STONK')).candidates.map(c => c.id), [`evm:8453:${address('d')}`]);
  } finally { await db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('concurrent fallback searches share one provider request', async () => {
  let calls = 0;
  const provider = new DexMarketProvider({ fetchImpl: async () => { calls++; return response({ pairs: [] }); } });
  await Promise.all(Array.from({ length: 1000 }, () => provider.search('STONK', 'robinhood')));
  assert.equal(calls, 1);
});

test('PostgreSQL repository uses the same asset/pool/state contract and JSONB checkpoints', async () => {
  const queries = [];
  class PoolClass {
    async query(sql, values = []) {
      queries.push([sql, values]);
      if (sql.startsWith('SELECT state_key')) return { rows: [{ state_key: 'solana:raydium-cpmm:pending', checkpoint: ['signature-1'] }] };
      if (sql.startsWith('SELECT')) return { rows: [] };
      return { rows: [] };
    }
    async end() {}
  }
  const db = await SharedDiscoveryRepository.create({ databaseUrl: 'postgres://shared/discovery', PoolClass });
  try {
    await db.load();
    assert.deepEqual(db.cursors.get('solana:raydium-cpmm:pending'), ['signature-1']);
    db.cursors.set('solana:raydium-cpmm:pending', ['signature-1', 'signature-2']);
    db.upsertAsset({ chain: 'robinhood', chainId: 4663, contractAddress: address('a'), symbol: 'PONS', verifiedOnChain: true });
    db.upsertPool({ chain: 'robinhood', poolAddress: address('b'), token0: address('a'), token1: address('c'), verifiedOnChain: true });
    await db.persist();
    assert.ok(queries.some(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS discovered_assets')));
    assert.ok(queries.some(([sql, values]) => sql.startsWith('INSERT INTO discovered_assets') && values[0] === `evm:4663:${address('a')}`));
    assert.ok(queries.some(([sql]) => sql.startsWith('INSERT INTO discovered_pools')));
    assert.ok(queries.some(([sql, values]) => sql.startsWith('INSERT INTO discovery_state') && values[1] === '["signature-1","signature-2"]'));
  } finally { await db.close(); }
});

test('XMR canonical primary, fallbacks, cached and unavailable; 1000 readers share one upstream request', async () => {
  let calls = 0, clock = 100000;
  const cacheMap = new Map();
  const cache = { get: key => cacheMap.get(key), set: (key, value) => cacheMap.set(key, value) };
  const cg = async () => { calls++; return response([quote]); };
  const main = createNativeMarketService({ cache, now: () => clock, fetchImpl: cg });
  const batch = await Promise.all(Array.from({ length: 1000 }, () => main.read('monero')));
  assert.ok(batch.every(value => value.marketCap === 9.2e9 && value.source === 'CoinGecko'));
  assert.equal(calls, 1);
  assert.equal((await main.read('fake-monero')).status, 'unsupported');
  assert.equal((await createNativeMarketService({ fetchImpl: async () => response([{ ...quote, id: 'fake' }]) }).read()).status, 'unavailable');

  clock += 61_000;
  const paprika = { id: 'xmr-monero', symbol: 'XMR', name: 'Monero',
    quotes: { USD: { price: 500, percent_change_24h: 3, volume_24h: 1e8, market_cap: 9.2e9 } } };
  const second = createNativeMarketService({ cache: { get: async () => null }, now: () => clock,
    fetchImpl: async url => url.includes('coinpaprika') ? response(paprika) : { ok: false, status: 429 } });
  assert.equal((await second.read()).status, 'fallback');
  assert.equal((await second.read()).marketCap, 9.2e9);
  const lore = { id: '28', symbol: 'XMR', name: 'Monero', nameid: 'monero', price_usd: '500', percent_change_24h: '1',
    volume24: 1e8, market_cap_usd: '9200000000', csupply: '18400000', fdv: '100000000000' };
  const third = createNativeMarketService({ now: () => clock, fetchImpl: async url => url.includes('coinlore') ? response([lore]) : { ok: false } });
  assert.equal((await third.read()).source, 'CoinLore');
  const broken = async () => ({ ok: false });
  assert.equal((await createNativeMarketService({ cache, now: () => clock, fetchImpl: broken }).read()).status, 'cached');
  assert.equal((await createNativeMarketService({ now: () => clock, fetchImpl: broken }).read()).status, 'unavailable');
  const badCap = await createNativeMarketService({ now: () => clock, fetchImpl: async () => response([{ ...quote, market_cap: null }]) }).read();
  assert.equal(badCap.marketCap, null);
});

test('Monero RPC endpoint failover and network outage do not affect market quotes', async () => {
  const adapter = new MoneroNativeAssetAdapter({ rpcUrls: ['https://first.example/', 'https://second.example/'], fetchImpl: async url =>
    String(url).includes('first') ? { ok: false } : response({ height: 3500000, difficulty: 2000000, target: 120, tx_pool_size: 15, synchronized: true }) });
  assert.equal((await adapter.readNetwork()).source, 'second.example');
  const primary = new MoneroNativeAssetAdapter({ rpcUrls: ['https://first.example/'], fetchImpl: async () => response({ height: 3500000, difficulty: 2000000, target: 120, tx_pool_size: 15, synchronized: true }) });
  assert.equal((await primary.readNetwork()).height, 3500000);
  assert.equal((await new MoneroNativeAssetAdapter({ rpcUrls: [], fetchImpl: async () => { throw Error(); } }).readNetwork()).status, 'unavailable');
  assert.equal((await createNativeMarketService({ fetchImpl: async () => response([quote]) }).read()).status, 'ok');
});
