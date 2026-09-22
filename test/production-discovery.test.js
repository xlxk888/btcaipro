import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedDiscoveryRepository } from '../src/discovery/shared-repository.js';
import { DiscoveryRepository } from '../src/discovery/repository.js';
import { createDiscoveryRuntime } from '../src/discovery/worker.js';
import { ChainDiscoveryAdapter } from '../src/discovery/adapters.js';
import { createAssetSearchHandler } from '../api/assets/search.js';
import { createDiscoveryHealthHandler } from '../api/assets/discovery-health.js';

const PONS = '0x39dbed3a2bd333467115de45665cc57f813c4571';
const poolAddress = '0xed50bdeea8adc232f159486192a4157281d722ff';
const address = digit => `0x${digit.repeat(40)}`;

class SharedPgPool {
  static data = { assets: new Map(), pools: new Map(), state: new Map() };
  constructor() { this.data = SharedPgPool.data; }
  async query(sql, args = []) {
    const bindCount = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
    if (bindCount !== args.length) {
      const error = new Error('bind message supplies a different number of parameters');
      error.code = '08P01';
      throw error;
    }
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.startsWith('INSERT INTO discovered_assets')) {
      this.data.assets.set(args[0], { asset_id: args[0], chain: args[1], payload: JSON.parse(args[12]) }); return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO discovered_pools')) {
      this.data.pools.set(args[0], { pool_id: args[0], chain: args[1], payload: JSON.parse(args[12]) }); return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO discovery_state')) {
      this.data.state.set(args[0], { state_key: args[0], checkpoint: JSON.parse(args[1]), updated_at: args[2] }); return { rows: [] };
    }
    if (sql.startsWith('SELECT COUNT(*) AS count FROM discovered_assets')) return { rows: [{ count: this.data.assets.size }] };
    if (sql.startsWith('SELECT COUNT(*) AS count FROM discovered_pools')) return { rows: [{ count: this.data.pools.size }] };
    if (sql.startsWith('SELECT asset_id, payload FROM discovered_assets WHERE')) {
      const [chain, pattern] = args, needle = pattern.slice(1, -1);
      return { rows: [...this.data.assets.values()].filter(row => (chain === 'auto' || row.chain === chain) &&
        [row.payload.name, row.payload.symbol, row.payload.contractAddress, row.payload.mintAddress]
          .some(value => value?.toLowerCase().includes(needle))).slice(0, 200) };
    }
    if (sql.startsWith('SELECT pool_id,payload FROM discovered_pools WHERE')) {
      const [chain, token] = args;
      return { rows: [...this.data.pools.values()].filter(row => row.chain === chain &&
        [row.payload.token0, row.payload.token1].includes(token)) };
    }
    if (sql.startsWith('SELECT asset_id, payload FROM discovered_assets')) return { rows: [...this.data.assets.values()] };
    if (sql.startsWith('SELECT pool_id, payload FROM discovered_pools')) return { rows: [...this.data.pools.values()] };
    if (sql.startsWith('SELECT state_key, checkpoint FROM discovery_state')) return { rows: [...this.data.state.values()] };
    if (sql.startsWith('SELECT checkpoint FROM discovery_state')) return { rows: [this.data.state.get(args[0])].filter(Boolean) };
    if (sql.startsWith('SELECT state_key, checkpoint, updated_at FROM discovery_state')) return {
      rows: [...this.data.state.values()].filter(row => row.state_key !== '__discovery_worker__' && !row.state_key.endsWith(':pending'))
        .sort((a, b) => b.updated_at - a.updated_at).slice(0, 1)
    };
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  async end() {}
}

test('PostgreSQL readIndex binds pool lookup correctly and returns the PONS pool', async () => {
  SharedPgPool.data = { assets: new Map(), pools: new Map(), state: new Map() };
  const repository = await SharedDiscoveryRepository.create({ databaseUrl: 'postgres://test/shared', PoolClass: SharedPgPool });
  try {
    repository.upsertAsset({ chain: 'robinhood', chainId: 4663, contractAddress: PONS,
      name: 'Pons', symbol: 'PONS', verifiedOnChain: true });
    repository.upsertPool({ chain: 'robinhood', poolAddress, token0: PONS, token1: address('a'),
      verifiedOnChain: true, liquidityPositive: true, firstSwapAt: 123 });
    await repository.persist();
    const index = await repository.readIndex('PONS', 'robinhood');
    assert.equal(index.assets.size, 1);
    assert.equal(index.pools.size, 1);
    assert.equal(index.search('PONS')[0].poolAddress, poolAddress);
  } finally {
    await repository.close();
  }
});

test('persistent worker writes PostgreSQL and Vercel handler reads the same PONS, AI and checkpoints', async () => {
  SharedPgPool.data = { assets: new Map(), pools: new Map(), state: new Map() };
  const repository = await SharedDiscoveryRepository.create({ databaseUrl: 'postgres://test/shared', PoolClass: SharedPgPool });
  await repository.load();
  let scans = 0;
  const adapter = {
    chain: 'robinhood',
    async rpc() { return '0x1000'; },
    async poll() {
      scans++;
      repository.upsertAsset({ chain: 'robinhood', chainId: 4663, contractAddress: PONS,
        name: 'Pons', symbol: 'PONS', verifiedOnChain: true });
      repository.upsertPool({ chain: 'robinhood', poolAddress, token0: PONS, token1: address('a'),
        dexName: 'Uniswap V3', verifiedOnChain: true, liquidityPositive: true, firstSwapAt: 123,
        liquidityUsd: 1_000_000, volume24h: 100_000 });
      for (const [chainId, token] of [[4663, address('b')], [8453, address('c')]]) {
        const chain = chainId === 4663 ? 'robinhood' : 'base';
        repository.upsertAsset({ chain, chainId, contractAddress: token, name: 'AI', symbol: 'AI', verifiedOnChain: true });
        repository.upsertPool({ chain, poolAddress: address(chainId === 4663 ? 'd' : 'e'), token0: token,
          token1: address('f'), verifiedOnChain: true, liquidityPositive: true, firstSwapAt: 123 });
      }
      repository.cursors.set('4663:factory', 345678);
      await repository.persist();
      return { status: 'indexed', chain: 'robinhood', pools: 3 };
    }
  };
  const runtime = await createDiscoveryRuntime({ repository, suppliedAdapters: [adapter], chains: ['robinhood'],
    fetchImpl: async () => ({ ok: true, json: async () => ({ pairs: [] }) }) });
  await runtime.poll();
  assert.equal(SharedPgPool.data.assets.size, 3, JSON.stringify([...SharedPgPool.data.assets.keys()]));
  const reader = await SharedDiscoveryRepository.create({ databaseUrl: 'postgres://test/shared', PoolClass: SharedPgPool, migrate: false });
  await reader.load();
  assert.equal(reader.cursors.get('4663:factory'), 345678);
  const provider = { async search() { return []; } };
  const handler = createAssetSearchHandler({ repositoryFactory: async () => reader, provider });
  const search = async (q, chain = 'auto') => {
    const response = await handler.fetch(new Request(`https://example.test/api/assets/search?q=${q}&chain=${chain}`));
    assert.equal(response.status, 200);
    return response.json();
  };
  const pons = await search('PONS', 'robinhood');
  assert.equal(pons.indexStatus, 'connected');
  assert.deepEqual([pons.candidates[0].chainId, pons.candidates[0].contractAddress,
    pons.candidates[0].poolAddress, pons.candidates[0].verifiedOnChain], [4663, PONS, poolAddress, true]);
  const ai = await search('AI');
  assert.equal(ai.candidates.length, 2, JSON.stringify(ai.candidates.map(item => item.id)));
  assert.equal((await search('STONK', 'robinhood')).candidates.length, 0);
  await Promise.all(Array.from({ length: 1000 }, () => search('PONS', 'robinhood')));
  assert.equal(scans, 1);
  const health = await reader.health();
  assert.equal(health.database, 'connected');
  assert.equal(health.workerRunning, true);
  assert.equal(health.indexedAssetCount, 3);
  assert.equal(health.indexedPoolCount, 3);
  assert.equal(health.lastCheckpoint.value, 345678);
  assert.equal(health.lastSuccessfulScan.chain, 'robinhood');
  assert.equal(health.lastError, null);
  const healthApi = createDiscoveryHealthHandler({ databaseUrl: 'postgres://test/shared', repositoryFactory: async () => reader });
  const healthResponse = await healthApi.fetch(new Request('https://example.test/api/assets/discovery-health'));
  assert.equal((await healthResponse.json()).indexedAssetCount, 3);
  const workerState = repository.cursors.get('__discovery_worker__');
  workerState.running = false;
  await repository.persist();
  assert.equal((await reader.health()).workerRunning, false);
  assert.equal((await search('PONS', 'robinhood')).candidates[0].contractAddress, PONS);
  const restarted = await SharedDiscoveryRepository.create({ databaseUrl: 'postgres://test/shared', PoolClass: SharedPgPool });
  await restarted.load();
  assert.equal(restarted.cursors.get('4663:factory'), 345678);
  await restarted.close(); await reader.close(); await repository.close();
});

test('missing database and stopped worker degrade search without a crash or invented STONK', async () => {
  const handler = createAssetSearchHandler({ repositoryFactory: async () => { throw new Error('DB unavailable'); },
    provider: { async search() { return []; } } });
  const known = await handler.fetch(new Request('https://example.test/api/assets/search?q=UNI'));
  assert.equal(known.status, 200);
  assert.equal((await known.json()).candidates[0].canonicalAssetId, 'uniswap');
  const unknown = await handler.fetch(new Request('https://example.test/api/assets/search?q=STONK&chain=robinhood'));
  assert.equal(unknown.status, 200);
  const data = await unknown.json();
  assert.equal(data.indexStatus, 'unavailable');
  assert.deepEqual(data.candidates, []);
  const health = createDiscoveryHealthHandler({ databaseUrl: '' });
  assert.equal((await (await health.fetch(new Request('https://example.test/api/assets/discovery-health'))).json()).status, 'degraded');
});

test('RPC endpoint failover and bounded per-chain retry resume without moving checkpoint on failure', async () => {
  const repository = new DiscoveryRepository();
  const requests = [];
  const rpc = new ChainDiscoveryAdapter({ chain: 'robinhood', repository,
    rpcUrls: ['https://first.example', 'https://second.example'], fetchImpl: async url => {
      requests.push(url);
      return url.includes('first') ? { ok: false, status: 429 } : { ok: true, json: async () => ({ result: '0x1237' }) };
    } });
  assert.equal(await rpc.rpc('eth_chainId'), '0x1237');
  assert.deepEqual(requests, ['https://first.example', 'https://second.example']);
  let clock = 100_000, attempts = 0;
  const runtime = await createDiscoveryRuntime({ repository, chains: ['base'], now: () => clock,
    suppliedAdapters: [{ chain: 'base', async poll() { attempts++; if (attempts === 1) throw new Error('HTTP 429'); return { status: 'indexed' }; } }] });
  await runtime.poll();
  assert.equal(attempts, 1);
  assert.equal(repository.cursors.get('__discovery_worker__').lastError.reason, 'HTTP 429');
  await runtime.poll();
  assert.equal(attempts, 1);
  clock += 15_001;
  await runtime.poll();
  assert.equal(attempts, 2);
  assert.equal(repository.cursors.get('__discovery_worker__').lastError, null);
});
