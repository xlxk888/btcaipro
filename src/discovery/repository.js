import fs from 'node:fs/promises';
import path from 'node:path';

export function assetIdentity(chain, address, numericChainId) {
  if (chain === 'solana') return `solana:${address}`;
  if (chain === 'tron') return `tron:${address}`;
  if (!Number.isInteger(numericChainId)) throw new Error('EVM chainId required');
  return `evm:${numericChainId}:${address.toLowerCase()}`;
}

export class DiscoveryRepository {
  constructor({ file } = {}) {
    this.file = file;
    this.assets = new Map();
    this.pools = new Map();
    this.cursors = new Map();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (!this.file) return this;
    try {
      const content = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.assets = new Map(content.assets || []);
      this.pools = new Map(content.pools || []);
      this.cursors = new Map(content.cursors || []);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }

  async persist() {
    if (!this.file) return;
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ assets: [...this.assets], pools: [...this.pools], cursors: [...this.cursors] }));
      await fs.rename(temporary, this.file);
    });
    return this.writeQueue;
  }

  upsertPool(pool) {
    const address = pool.chain === 'solana' ? pool.poolAddress : pool.poolAddress.toLowerCase();
    const key = `${pool.chain}:${address}`;
    const old = this.pools.get(key) || {};
    this.pools.set(key, { ...old, ...pool, poolAddress: address, discoveredAt: old.discoveredAt || pool.discoveredAt || Date.now() });
    return this.pools.get(key);
  }

  upsertAsset(asset) {
    const id = assetIdentity(asset.chain, asset.contractAddress || asset.mintAddress, asset.chainId);
    const old = this.assets.get(id) || {};
    this.assets.set(id, { ...old, ...asset, id, discoveredAt: old.discoveredAt || asset.discoveredAt || Date.now() });
    return this.assets.get(id);
  }

  search(q, chain = 'auto', { minLiquidity = 0, minVolume = 0, minTrades = 1, minAgeMs = 0 } = {}) {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return [...this.assets.values()].flatMap(asset => {
      if (chain !== 'auto' && asset.chain !== chain) return [];
      if (![asset.name, asset.symbol, asset.contractAddress, asset.mintAddress].some(value => value?.toLowerCase().includes(term))) return [];
      const pools = [...this.pools.values()].filter(pool => pool.chain === asset.chain &&
        [pool.token0, pool.token1].some(address => address === (asset.chain === 'solana'
          ? asset.mintAddress : asset.contractAddress?.toLowerCase())) &&
        pool.verifiedOnChain && pool.liquidityPositive && pool.firstSwapAt &&
        (pool.liquidityUsd ?? 1) > minLiquidity && (pool.volume24h ?? 0) >= minVolume &&
        (pool.trades24h ?? 1) >= minTrades && Date.now() - pool.discoveredAt >= minAgeMs);
      if (!asset.verifiedOnChain || !pools.length) return [];
      pools.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
      const best = pools[0];
      return [{ ...asset, poolAddress: best.poolAddress, dex: best.dexName,
        liquidity: best.liquidityUsd ?? null, volume24h: best.volume24h ?? null,
        price: best.price ?? null, priceChange24h: best.priceChange24h ?? null,
        buys24h: best.buys24h ?? null, sells24h: best.sells24h ?? null,
        marketCap: best.marketCap ?? null, pools: pools.length,
        source: 'onchain-index', verifiedOnChain: true }];
    });
  }
}
