import '../../asset-registry.js';
import { DISCOVERY_CHAINS } from './registry.js';

const MARKET_CHAIN = { hyperliquid: 'hyperevm' };
const MARKET_TO_CHAIN = Object.fromEntries(Object.keys(DISCOVERY_CHAINS).map(chain => [MARKET_CHAIN[chain] || chain, chain]));
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class DexMarketProvider {
  constructor({ fetchImpl = fetch, now = Date.now, ttlMs = 60_000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }
  async search(q, chain = 'auto') {
    const key = `${chain}:${q.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return cached.items;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await this.fetchImpl(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`DEX market HTTP ${response.status}`);
      const items = (await response.json()).pairs || [];
      const mapped = items.flatMap(pair => {
        const matchedChain = MARKET_TO_CHAIN[pair.chainId];
        if (!matchedChain || (chain !== 'auto' && matchedChain !== chain)) return [];
        const token = pair.baseToken;
        const address = token?.address;
        if (!address || ![token.name, token.symbol, address].some(value => value?.toLowerCase() === q.toLowerCase())) return [];
        if (matchedChain === 'solana' ? !MINT.test(address) : !ADDRESS.test(address)) return [];
        const liquidity = Number(pair.liquidity?.usd);
        const trades = Number(pair.txns?.h24?.buys || 0) + Number(pair.txns?.h24?.sells || 0);
        if (!(liquidity > 0) || trades < 1 || !pair.pairAddress) return [];
        const evm = matchedChain !== 'solana';
        const chainId = evm ? DISCOVERY_CHAINS[matchedChain]?.chainId : 'solana';
        const contractAddress = evm ? address.toLowerCase() : undefined;
        const mintAddress = evm ? undefined : address;
        return [{ id: evm ? `evm:${chainId}:${contractAddress}` : `solana:${mintAddress}`,
          name: token.name, symbol: token.symbol, chain: matchedChain, chainId,
          contractAddress, mintAddress, poolAddress: pair.pairAddress,
          dex: pair.dexId, logo: pair.info?.imageUrl || null,
          price: Number(pair.priceUsd) || null, liquidity, volume24h: Number(pair.volume?.h24) || null,
          priceChange24h: Number(pair.priceChange?.h24) || null,
          buys24h: Number(pair.txns?.h24?.buys) || null, sells24h: Number(pair.txns?.h24?.sells) || null,
          // Market cap is not trusted without an independently verified circulating supply.
          marketCap: null, discoveredAt: pair.pairCreatedAt || null,
          source: 'dex-market-unverified', verifiedOnChain: false }];
      });
      this.cache.set(key, { items: mapped, expires: this.now() + this.ttlMs });
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
      return mapped;
    } finally { clearTimeout(timer); }
  }
}

export function createAssetSearchService({ repository, provider = new DexMarketProvider() }) {
  return {
    async search(q, chain = 'auto') {
      q = String(q || '').trim().slice(0, 80);
      if (!q || !/^[\p{L}\p{N}\s.\-_:$]+$/u.test(q)) return { candidates: [], status: 'invalid-query' };
      if (chain !== 'auto' && !DISCOVERY_CHAINS[chain] && chain !== 'bitcoin') return { candidates: [], status: 'invalid-chain' };
      const canonical = globalThis.CryptoAIAssets.searchCandidates(q, chain)
        .filter(item => item.canonicalAssetId)
        .map(item => ({ ...item, chain: item.network, source: 'canonical-registry', verifiedOnChain: item.assetType === 'native' }));
      // Preserve canonical global search behavior; discovered assets always require exact chain identity.
      if (canonical.length) return { candidates: canonical, status: 'ok' };
      const indexed = repository.search(q, chain);
      let fallback = [];
      try { fallback = await provider.search(q, chain); } catch (_) { /* Own index survives provider outages. */ }
      const byId = new Map();
      for (const candidate of [...fallback, ...indexed, ...canonical]) byId.set(candidate.id, candidate);
      return { candidates: [...byId.values()].sort((a, b) => {
        const rank = { 'canonical-registry': 0, 'onchain-index': 1, 'dex-market-unverified': 2 };
        return rank[a.source] - rank[b.source] || (b.liquidity || 0) - (a.liquidity || 0);
      }), status: 'ok' };
    }
  };
}
