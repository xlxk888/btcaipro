import path from 'node:path';
import { DiscoveryRepository } from './repository.js';
import { SharedDiscoveryRepository } from './shared-repository.js';
import { EvmDiscoveryAdapter, SolanaDiscoveryAdapter, TronDiscoveryAdapter } from './adapters.js';
import { DISCOVERY_CHAINS } from './registry.js';
import { createAssetSearchService, DexMarketProvider } from './search.js';

export async function createDiscoveryRuntime({ file = path.resolve('data/asset-discovery.json'), databaseUrl, databasePath, repository: suppliedRepository, fetchImpl = fetch,
  chains = Object.keys(DISCOVERY_CHAINS), intervalMs = 60_000, logger } = {}) {
  chains ||= Object.keys(DISCOVERY_CHAINS);
  const repository = suppliedRepository || (databaseUrl !== undefined || databasePath !== undefined
    ? await SharedDiscoveryRepository.create({ databaseUrl, databasePath }) : new DiscoveryRepository({ file }));
  if (!suppliedRepository) await repository.load();
  if (repository instanceof SharedDiscoveryRepository && !databaseUrl && !repository.assets.size) {
    const previous = await new DiscoveryRepository({ file }).load();
    for (const asset of previous.assets.values()) repository.upsertAsset(asset);
    for (const pool of previous.pools.values()) repository.upsertPool(pool);
    for (const [key, checkpoint] of previous.cursors) repository.cursors.set(key, checkpoint);
    if (previous.assets.size || previous.cursors.size) await repository.persist();
  }
  const adapters = chains.map(chain => chain === 'solana'
    ? new SolanaDiscoveryAdapter({ chain, repository, fetchImpl })
    : chain === 'tron' ? new TronDiscoveryAdapter({ chain, repository, fetchImpl })
      : new EvmDiscoveryAdapter({ chain, repository, fetchImpl }));
  const provider = new DexMarketProvider({ fetchImpl });
  let timer, running = false, lastSeedAt = 0;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      // Warm a bounded set of older pools once per ten minutes. Provider data
      // merely supplies pool addresses; factory, token, liquidity and swaps are
      // independently checked on chain before indexing an asset.
      if (Date.now() - lastSeedAt > 600_000) {
        lastSeedAt = Date.now();
        const robinhood = adapters.find(adapter => adapter.chain === 'robinhood');
        if (robinhood) {
          try {
            const tip = Number(BigInt(await robinhood.rpc('eth_blockNumber')));
            for (const term of ['PONS', 'STONK', 'AI']) {
              const suggestions = await provider.search(term, 'robinhood');
              const seen = new Map();
              for (const pair of suggestions.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0))) {
                if (seen.size >= 3 && !seen.has(pair.id)) continue;
                const attempted = seen.get(pair.id) || 0;
                if (attempted >= 5) continue;
                seen.set(pair.id, attempted + 1);
                try {
                  const pool = await robinhood.verifySuggestedPool(pair, tip);
                  if (pool) {
                    Object.assign(pool, { liquidityUsd: pair.liquidity, volume24h: pair.volume24h,
                      price: pair.price, priceChange24h: pair.priceChange24h,
                      buys24h: pair.buys24h, sells24h: pair.sells24h,
                      marketCap: null, marketSource: 'dex-market' });
                    seen.set(pair.id, 5);
                  }
                } catch (_) { /* Unsupported or unverified pool. */ }
              }
            }
          } catch (error) { logger?.warn?.('asset_discovery_seed_failure', { error: error.message }); }
        }
      }
      // Limit concurrency and upstream load, with independent chain failures.
      for (const adapter of adapters) {
        try {
          await adapter.poll();
          if (adapter.chain === 'solana') {
            for (const asset of [...repository.assets.values()].filter(item => item.chain === 'solana' && !item.symbol).slice(0, 6)) {
              try {
                const matches = await provider.search(asset.mintAddress, 'solana');
                const pool = [...repository.pools.values()].find(item => item.chain === 'solana' &&
                  [item.token0, item.token1].includes(asset.mintAddress) && item.verifiedOnChain &&
                  item.liquidityPositive && item.firstSwapAt);
                const match = matches.find(item => item.poolAddress === pool?.poolAddress && item.mintAddress === asset.mintAddress);
                if (!match) continue;
                Object.assign(asset, { name: match.name, symbol: match.symbol, logo: match.logo, metadataSource: 'dex-market' });
                Object.assign(pool, { price: match.price, liquidityUsd: match.liquidity,
                  volume24h: match.volume24h, marketCap: null, marketSource: 'dex-market' });
              } catch (_) { /* Onchain mint and pool identities remain in the index. */ }
            }
            await repository.persist();
          }
        } catch (error) { logger?.warn?.('asset_discovery_failure', { chain: adapter.chain, error: error.message }); }
      }
    } finally { running = false; }
  };
  return {
    repository, search: createAssetSearchService({ repository, provider }), poll,
    start() { if (!timer) { void poll(); timer = setInterval(() => void poll(), intervalMs); } },
    stop() { clearInterval(timer); timer = null; }
  };
}
