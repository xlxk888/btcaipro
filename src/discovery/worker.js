import path from 'node:path';
import { DiscoveryRepository } from './repository.js';
import { SharedDiscoveryRepository, DISCOVERY_WORKER_STATE_KEY } from './shared-repository.js';
import { EvmDiscoveryAdapter, SolanaDiscoveryAdapter, TronDiscoveryAdapter } from './adapters.js';
import { DISCOVERY_CHAINS } from './registry.js';
import { createAssetSearchService, DexMarketProvider } from './search.js';

export async function createDiscoveryRuntime({ file = path.resolve('data/asset-discovery.json'), databaseUrl, databasePath, repository: suppliedRepository, fetchImpl = fetch,
  chains = Object.keys(DISCOVERY_CHAINS), intervalMs = 60_000, logger, now = Date.now, suppliedAdapters } = {}) {
  chains ||= Object.keys(DISCOVERY_CHAINS);
  const repository = suppliedRepository || (databaseUrl !== undefined || databasePath !== undefined
    ? await SharedDiscoveryRepository.create({ databaseUrl, databasePath }) : new DiscoveryRepository({ file }));
  if (!suppliedRepository) await repository.load();
  if (!suppliedRepository && repository instanceof SharedDiscoveryRepository && !databaseUrl && !repository.assets.size) {
    const previous = await new DiscoveryRepository({ file }).load();
    for (const asset of previous.assets.values()) repository.upsertAsset(asset);
    for (const pool of previous.pools.values()) repository.upsertPool(pool);
    for (const [key, checkpoint] of previous.cursors) repository.cursors.set(key, checkpoint);
    if (previous.assets.size || previous.cursors.size) await repository.persist();
  }
  const adapters = suppliedAdapters || chains.map(chain => {
    const configured = process.env[`DISCOVERY_RPC_URLS_${chain.toUpperCase()}`]?.split(',').map(url => url.trim()).filter(Boolean);
    const options = { chain, repository, fetchImpl, rpcUrls: configured };
    return chain === 'solana' ? new SolanaDiscoveryAdapter(options)
      : chain === 'tron' ? new TronDiscoveryAdapter(options) : new EvmDiscoveryAdapter(options);
  });
  const provider = new DexMarketProvider({ fetchImpl });
  let timer, running = false, lastSeedAt = 0, activePoll;
  const workerState = repository.cursors.get(DISCOVERY_WORKER_STATE_KEY) || {};
  const retryAt = new Map(), failures = new Map();
  async function saveWorkerState(patch) {
    Object.assign(workerState, patch, { heartbeatAt: now() });
    repository.cursors.set(DISCOVERY_WORKER_STATE_KEY, workerState);
    await repository.persist();
  }
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await saveWorkerState({ running: true });
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
        if (now() < (retryAt.get(adapter.chain) || 0)) continue;
        try {
          const result = await adapter.poll();
          failures.delete(adapter.chain);
          retryAt.delete(adapter.chain);
          if (result?.status !== 'limited' && result?.status !== 'pending-factory') {
            workerState.lastSuccessfulScan = { chain: adapter.chain, at: now() };
            if (workerState.lastError?.chain === adapter.chain) workerState.lastError = null;
          }
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
          await saveWorkerState({ running: true });
        } catch (error) {
          const count = (failures.get(adapter.chain) || 0) + 1;
          failures.set(adapter.chain, count);
          retryAt.set(adapter.chain, now() + Math.min(300_000, 15_000 * 2 ** Math.min(count - 1, 5)));
          workerState.lastError = { chain: adapter.chain, at: now(), reason: /HTTP \d+/.exec(error.message)?.[0] || error.name || 'RPC error' };
          logger?.warn?.('asset_discovery_failure', { chain: adapter.chain, error: error.message });
          await saveWorkerState({ running: true });
        }
      }
    } finally { running = false; }
  };
  return {
    repository, search: createAssetSearchService({ repository, provider }), poll,
    start() { if (!timer) { activePoll = poll(); timer = setInterval(() => { activePoll = poll(); }, intervalMs); } },
    async stop() { if (!timer) return; clearInterval(timer); timer = null; await activePoll; await saveWorkerState({ running: false }); }
  };
}
