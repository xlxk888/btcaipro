import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiscoveryRepository, assetIdentity } from '../src/discovery/repository.js';
import { createAssetSearchService, DexMarketProvider } from '../src/discovery/search.js';
import { EvmDiscoveryAdapter, SolanaDiscoveryAdapter, TronDiscoveryAdapter } from '../src/discovery/adapters.js';
import { DEX_REGISTRY, DISCOVERY_CHAINS, PAIR_CREATED, POOL_CREATED, SWAP, V3_SWAP, RAYDIUM_CPMM } from '../src/discovery/registry.js';
import { encodeBase58 } from '../src/discovery/base58.js';

const a = `0x${'a'.repeat(40)}`, b = `0x${'b'.repeat(40)}`, poolAddress = `0x${'c'.repeat(40)}`;
const pad = address => `0x${address.slice(2).padStart(64, '0')}`;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const encodeString = value => `0x${word(32)}${word(value.length)}${Buffer.from(value).toString('hex').padEnd(64, '0')}`;

function stored({ symbol = 'PONS', chain = 'robinhood', chainId = 4663, contractAddress = a, pool = poolAddress } = {}) {
  const repo = new DiscoveryRepository();
  repo.upsertAsset({ name: symbol, symbol, chain, chainId, contractAddress, verifiedOnChain: true });
  repo.upsertPool({ chain, token0: contractAddress, token1: b, poolAddress: pool,
    dexName: 'Uniswap V2', liquidityPositive: true, firstSwapAt: 123, verifiedOnChain: true, liquidityUsd: 12 });
  return repo;
}

test('canonical UNI and HYPE precede independent onchain candidates', async () => {
  const repo = stored();
  const provider = { async search() { return []; } };
  const service = createAssetSearchService({ repository: repo, provider });
  assert.equal((await service.search('UNI')).candidates[0].canonicalAssetId, 'uniswap');
  assert.equal((await service.search('HYPE')).candidates[0].canonicalAssetId, 'hyperliquid');
  const pons = (await service.search('PONS')).candidates[0];
  assert.equal(pons.id, `evm:4663:${a}`);
  assert.equal(pons.poolAddress, poolAddress);
  assert.equal(pons.verifiedOnChain, true);
});

test('STONK and AI are indexed by exact chain and contract, not symbol', async () => {
  const repo = stored({ symbol: 'STONK' });
  const other = stored({ symbol: 'AI', chain: 'base', chainId: 8453 });
  for (const pool of other.pools.values()) repo.upsertPool(pool);
  for (const asset of other.assets.values()) repo.upsertAsset(asset);
  repo.upsertAsset({ name: 'AI', symbol: 'AI', chain: 'robinhood', chainId: 4663, contractAddress: b, verifiedOnChain: true });
  repo.upsertPool({ chain: 'robinhood', token0: b, token1: a, poolAddress: `0x${'d'.repeat(40)}`,
    liquidityPositive: true, firstSwapAt: 12, verifiedOnChain: true });
  const service = createAssetSearchService({ repository: repo, provider: { async search() { return []; } } });
  assert.equal((await service.search('STONK', 'robinhood')).candidates[0].id, `evm:4663:${a}`);
  assert.equal((await service.search('STONK', 'base')).candidates.length, 0);
  assert.deepEqual((await service.search('AI')).candidates.map(item => item.id).sort(), [`evm:4663:${b}`, `evm:8453:${a}`].sort());
});

test('asset and pool identity deduplicate independently; additional pools aggregate', () => {
  const repo = stored();
  repo.upsertPool({ chain: 'robinhood', token0: a, token1: b, poolAddress: `0x${'d'.repeat(40)}`,
    liquidityPositive: true, firstSwapAt: 2, verifiedOnChain: true, liquidityUsd: 50 });
  assert.equal(repo.search('PONS').length, 1);
  assert.equal(repo.search('PONS')[0].pools, 2);
  assert.equal(repo.search('PONS')[0].liquidity, 50);
  repo.upsertAsset({ name: 'PONS', symbol: 'PONS', chain: 'base', chainId: 8453, contractAddress: a, verifiedOnChain: true });
  assert.equal(repo.search('PONS').length, 1); // no verified pool on Base
  assert.notEqual(assetIdentity('base', a, 8453), assetIdentity('robinhood', a, 4663));
  assert.equal(assetIdentity('solana', 'So11111111111111111111111111111111111111112'), 'solana:So11111111111111111111111111111111111111112');
});

test('empty liquidity, absent swaps and unverified contracts never enter candidate index', () => {
  const repo = stored();
  const pool = [...repo.pools.values()][0];
  pool.liquidityPositive = false;
  assert.equal(repo.search('PONS').length, 0);
  pool.liquidityPositive = true; pool.firstSwapAt = null;
  assert.equal(repo.search('PONS').length, 0);
  pool.firstSwapAt = 1; repo.assets.get(`evm:4663:${a}`).verifiedOnChain = false;
  assert.equal(repo.search('PONS').length, 0);
});

test('provider outage preserves onchain identity; FDV is never market cap', async () => {
  const repo = stored();
  const service = createAssetSearchService({ repository: repo,
    provider: { async search() { throw new Error('429'); } } });
  assert.equal((await service.search('PONS')).candidates[0].source, 'onchain-index');
  const market = new DexMarketProvider({ fetchImpl: async () => ({ ok: true, json: async () => ({ pairs: [{
    chainId: 'robinhood', pairAddress: poolAddress, dexId: 'uniswap',
    baseToken: { symbol: 'PONS', name: 'Pons', address: a },
    liquidity: { usd: 42 }, txns: { h24: { buys: 1, sells: 0 } }, fdv: 900, marketCap: 900
  }] }) }) });
  assert.equal((await market.search('PONS'))[0].marketCap, null);
});

test('shared provider cache and repository serve multiple users without repeated upstream calls', async () => {
  let requests = 0, now = 1000;
  const provider = new DexMarketProvider({ now: () => now, fetchImpl: async () => {
    requests++;
    return { ok: true, json: async () => ({ pairs: [] }) };
  } });
  const service = createAssetSearchService({ repository: stored(), provider });
  await service.search('STONK'); await service.search('STONK');
  assert.equal(requests, 1);
  now += 61_000; await service.search('STONK');
  assert.equal(requests, 2);
});

test('indexed assets, pools and cursors survive repository reload across server users', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crypto-ai-discovery-'));
  const file = path.join(dir, 'index.json');
  try {
    const first = new DiscoveryRepository({ file });
    for (const asset of stored().assets.values()) first.upsertAsset(asset);
    for (const pool of stored().pools.values()) first.upsertPool(pool);
    first.cursors.set('4663:factory', 200);
    await first.persist();
    const second = await new DiscoveryRepository({ file }).load();
    assert.equal(second.search('PONS')[0].id, `evm:4663:${a}`);
    assert.equal(second.cursors.get('4663:factory'), 200);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('official factory registry covers seven EVM chains and Robinhood V3; HyperEVM remains pending', () => {
  assert.equal(new Set(DEX_REGISTRY.map(dex => dex.chain)).size, 7);
  assert.equal(DEX_REGISTRY.find(dex => dex.chain === 'robinhood' && dex.poolType === 'v3').chainId, 4663);
  assert.equal(DISCOVERY_CHAINS.hyperliquid.status, 'pending-factory');
  assert.equal(new TronDiscoveryAdapter({ chain: 'tron', repository: stored() }).poll().then(Boolean) instanceof Promise, true);
});

test('PairCreated logs, liquidity, Swap and token metadata index a non-CEX token', async () => {
  const repo = new DiscoveryRepository();
  const factory = DEX_REGISTRY.find(item => item.chain === 'robinhood' && item.poolType === 'v2');
  const calls = [];
  const fetchImpl = async (_url, request) => {
    const { method, params } = JSON.parse(request.body); calls.push(method);
    let result = '0x';
    if (method === 'eth_chainId') result = '0x1237';
    if (method === 'eth_blockNumber') result = '0x1000';
    if (method === 'eth_getLogs') {
      result = params[0].topics[0] === PAIR_CREATED ? [{ topics: [PAIR_CREATED, pad(a), pad(b)], data: `0x${poolAddress.slice(2).padStart(64, '0')}${word(1)}`, blockNumber: '0xff0' }]
        : params[0].topics[0] === SWAP ? [{ blockNumber: '0xff1' }] : [];
    }
    if (method === 'eth_getCode') result = '0x1234';
    if (method === 'eth_getBlockByNumber') result = { timestamp: '0x100' };
    if (method === 'eth_call') {
      const selector = params[0].data;
      result = selector === '0x0902f1ac' ? `0x${word(10)}${word(20)}${word(123)}`
        : selector === '0x06fdde03' ? encodeString('New Token')
          : selector === '0x95d89b41' ? encodeString('NEW') : `0x${word(18)}`;
    }
    return { ok: true, json: async () => ({ result }) };
  };
  const adapter = new EvmDiscoveryAdapter({ chain: 'robinhood', repository: repo, factories: [factory], fetchImpl });
  await adapter.poll();
  assert.equal(repo.search('NEW').length, 2); // both mocked ERC20 contracts have the same symbol, distinct addresses
  assert.equal(repo.search('NEW')[0].verifiedOnChain, true);
  assert.ok(calls.includes('eth_getLogs'));
});

test('V3 PoolCreated and Swap use verified factory and live liquidity', async () => {
  const repo = new DiscoveryRepository();
  const factory = DEX_REGISTRY.find(item => item.chain === 'robinhood' && item.poolType === 'v3');
  const fetchImpl = async (_url, request) => {
    const { method, params } = JSON.parse(request.body);
    let result = '0x';
    if (method === 'eth_chainId') result = '0x1237';
    if (method === 'eth_blockNumber') result = '0x1000';
    if (method === 'eth_getLogs') result = params[0].topics[0] === POOL_CREATED
      ? [{ topics: [POOL_CREATED, pad(a), pad(b), `0x${word(3000)}`], data: `0x${word(60)}${poolAddress.slice(2).padStart(64, '0')}`, blockNumber: '0xff0' }]
      : params[0].topics[0] === V3_SWAP ? [{ blockNumber: '0xff1' }] : [];
    if (method === 'eth_getCode') result = '0x1234';
    if (method === 'eth_getBlockByNumber') result = { timestamp: '0x100' };
    if (method === 'eth_call') {
      result = params[0].data === '0x1a686502' ? `0x${word(42)}`
        : params[0].data === '0x06fdde03' ? encodeString('Pons')
          : params[0].data === '0x95d89b41' ? encodeString('PONS') : `0x${word(18)}`;
    }
    return { ok: true, json: async () => ({ result }) };
  };
  await new EvmDiscoveryAdapter({ chain: 'robinhood', repository: repo, factories: [factory], fetchImpl }).poll();
  assert.equal(repo.search('PONS').length, 2);
  assert.equal(repo.search('PONS')[0].dex, 'Uniswap V3');
});

test('Solana verifies mint, Raydium CPMM pool, vault balances and an actual swap', async () => {
  const mintAddress = encodeBase58(Buffer.alloc(32, 1));
  const quoteMint = encodeBase58(Buffer.alloc(32, 2));
  const vault0 = encodeBase58(Buffer.alloc(32, 3));
  const vault1 = encodeBase58(Buffer.alloc(32, 4));
  const pool = encodeBase58(Buffer.alloc(32, 5));
  const data = Buffer.alloc(637);
  for (const [offset, byte] of [[168, 1], [200, 2], [72, 3], [104, 4]]) data.fill(byte, offset, offset + 32);
  const repo = new DiscoveryRepository();
  const adapter = new SolanaDiscoveryAdapter({ chain: 'solana', repository: repo,
    fetchImpl: async (_url, request) => {
      const { method, params } = JSON.parse(request.body);
      const result = method === 'getSignaturesForAddress'
        ? [{ signature: params[0] === RAYDIUM_CPMM ? 'initialization' : 'swap', err: null }]
        : method === 'getTransaction' ? params[0] === 'initialization'
          ? { blockTime: 123, meta: { logMessages: ['Program log: Instruction: Initialize'] }, transaction: { message: { instructions: [{ programId: RAYDIUM_CPMM, accounts: ['x', 'x', 'x', pool] }] } } }
          : { blockTime: 124, meta: { logMessages: ['Program log: Instruction: SwapBaseInput'] }, transaction: { message: { instructions: [{ programId: RAYDIUM_CPMM, accounts: [pool] }] } } }
          : method === 'getAccountInfo' ? params[0] === pool
            ? { value: { owner: RAYDIUM_CPMM, data: [data.toString('base64'), 'base64'] } }
            : { value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { parsed: { type: 'mint', info: { decimals: 9 } } } } }
            : { value: { amount: '100' } };
      return { ok: true, json: async () => ({ result }) };
    } });
  assert.equal((await adapter.verifyMint(mintAddress)).mintAddress, mintAddress);
  assert.equal((await adapter.poll()).status, 'limited-recent-raydium-cpmm');
  assert.equal(repo.pools.get(`solana:${pool}`).token0, mintAddress);
  assert.equal(repo.pools.get(`solana:${pool}`).liquidityPositive, true);
  assert.equal(repo.assets.get(`solana:${mintAddress}`).verifiedOnChain, true);
});
