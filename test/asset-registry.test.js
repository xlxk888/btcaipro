import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = new URL('../', import.meta.url);
const registrySource = fs.readFileSync(new URL('asset-registry.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const inlineScript = html.split('<script>')[1].split('</script>')[0];
let options;
const context = vm.createContext({
  Vue: function Vue(config) { options = config; },
  TextDecoder, Uint8Array, BigInt, Map, Object, Number, Array, String,
  requestAnimationFrame(callback) { callback(); return 1; }
});
vm.runInContext(registrySource, context);
vm.runInContext(inlineScript, context);
const registry = context.CryptoAIAssets;

function fixture() {
  const app = { ...options.data, ...options.methods, watchedAssets: [], pendingUpdates: {}, rafId: null };
  app.backendIsActive = () => false;
  app.showToast = () => {};
  app.routeWatchedAssets = () => {};
  app.startFallbackPolling = () => {};
  app.refreshMarketCaps = () => {};
  app.scheduleMarketCapRefresh = () => {};
  app.saveWatchedAssets = () => {};
  return app;
}

test('canonical names add globally; unknown names and auto addresses require a chain', async () => {
  const app = fixture();
  for (const [name, id, marketDataId] of [
    ['UNI', 'canonical:uniswap', 'uniswap'],
    ['HYPE', 'hyperliquid:HYPE', 'hyperliquid'],
    ['BTC', 'bitcoin:BTC', 'bitcoin'],
    ['ETH', 'evm:1:native', 'ethereum'],
    ['ZEC', 'canonical:zcash', 'zcash']
  ]) {
    app.selectedChainId = 'arbitrum';
    app.assetInput = name;
    await app.addWatchAsset();
    assert.equal(app.watchedAssets[0].id, id);
    assert.equal(app.watchedAssets[0].marketDataId, marketDataId);
  }
  assert.match(app.watchedAssets.find(asset => asset.symbol === 'HYPE').logoUrl, /coins\/images\/50882/);
  app.selectedChainId = 'auto';
  app.assetInput = 'UNKNOWN';
  await app.addWatchAsset();
  assert.equal(app.watchedAssets.length, 5);
  assert.match(app.watchError, /选择对应链/);
  app.assetInput = `0x${'a'.repeat(40)}`;
  await app.addWatchAsset();
  assert.match(app.watchError, /选择对应链/);
  app.selectedChainId = 'robinhood';
  for (const symbol of ['PONS', 'STONK', '7777', 'SHROOM']) {
    app.assetInput = symbol;
    await app.addWatchAsset();
    assert.equal(app.watchedAssets.length, 5);
    assert.match(app.watchError, /Robinhood Chain 未收录/);
  }
  app.selectedChainId = 'bitcoin';
  app.assetInput = `0x${'a'.repeat(40)}`;
  await app.addWatchAsset();
  assert.match(app.watchError, /仅支持 BTC 原生资产/);
});

test('duplicate symbols expose candidates with distinct network and address', () => {
  const robinhoodAddress = `0x${'a'.repeat(40)}`;
  const ethereumAddress = `0x${'b'.repeat(40)}`;
  const entries = [
    { chainId: 4663, contractAddress: robinhoodAddress, symbol: 'PONS', name: 'Robinhood PONS' },
    { chainId: 1, contractAddress: ethereumAddress, symbol: 'PONS', name: 'Ethereum PONS' }
  ];
  const candidates = registry.searchCandidates('PONS', null, entries);
  assert.equal(candidates.length, 2);
  assert.deepEqual(Array.from(candidates, item => item.network), ['Robinhood Chain', 'Ethereum']);
  assert.deepEqual(Array.from(candidates, item => item.contractAddress), [robinhoodAddress, ethereumAddress]);
  assert.equal(registry.searchCandidates('PONS', 'robinhood', entries).length, 1);
  assert.equal(registry.searchCandidates('PONS', 'base', entries).length, 0);
  assert.equal(registry.searchCandidates('PONS', 'auto', entries).length, 0);
  assert.equal(registry.searchCandidates('STONK', null, [{ chainId: 4663, symbol: 'STONK' }]).length, 0);
  assert.equal(registry.search('PONS'), null);
});

test('ambiguous registry search opens a picker before adding', async () => {
  const candidates = registry.searchCandidates('PONS', null, [
    { chainId: 4663, contractAddress: `0x${'a'.repeat(40)}`, symbol: 'PONS', name: 'Robinhood PONS' },
    { chainId: 1, contractAddress: `0x${'b'.repeat(40)}`, symbol: 'PONS', name: 'Ethereum PONS' }
  ]);
  context.CryptoAIAssets = { ...registry, searchCandidates: () => candidates };
  try {
    const app = fixture();
    app.assetInput = 'PONS';
    await app.addWatchAsset();
    assert.equal(app.watchedAssets.length, 0);
    assert.equal(app.assetCandidates.length, 2);
    assert.match(app.watchError, /多个已收录资产/);
  } finally {
    context.CryptoAIAssets = registry;
  }
});

test('chain alias needs an explicit address on that exact chain', () => {
  const robinhoodAddress = `0x${'a'.repeat(40)}`;
  const ethereumAddress = `0x${'b'.repeat(40)}`;
  const mint = 'So11111111111111111111111111111111111111112';
  const tronAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const entries = [
    { chainId: 4663, contractAddress: robinhoodAddress, symbol: 'PONS' },
    { chainId: 1, contractAddress: ethereumAddress, symbol: 'PONS' },
    { chainId: 'solana', mintAddress: mint, symbol: 'PONS' },
    { chainId: 'tron', contractAddress: tronAddress, symbol: 'PONS' },
    { chainId: 4663, symbol: 'STONK' }
  ];
  assert.equal(registry.searchOnChain('PONS', 'robinhood', entries).contractAddress, robinhoodAddress);
  assert.equal(registry.searchOnChain('PONS', 'ethereum', entries).contractAddress, ethereumAddress);
  assert.equal(registry.searchOnChain('PONS', 'solana', entries).mintAddress, mint);
  assert.equal(registry.searchOnChain('PONS', 'tron', entries).contractAddress, tronAddress);
  assert.equal(registry.searchOnChain('PONS', 'base', entries), null);
  assert.equal(registry.searchOnChain('PONS', 'robinhood', [
    entries[0], { chainId: 4663, contractAddress: ethereumAddress, symbol: 'PONS' }
  ]), null);
  assert.equal(registry.searchOnChain('STONK', 'robinhood', entries), null);
  assert.equal(registry.searchOnChain('PONS', 'bitcoin', entries), null);
  assert.equal(registry.identity(registry.byChain.solana, mint), `solana:${mint}`);
  assert.equal(registry.identity(registry.byChain.tron, tronAddress), `tron:${tronAddress}`);
});

test('chain and address form a unique identity', () => {
  const app = fixture();
  const address = `0x${'a'.repeat(40)}`;
  const ethereum = app.createDexAsset(address, 'ethereum');
  const base = app.createDexAsset(address.toUpperCase().replace('0X', '0x'), 'base');
  const robinhood = app.createDexAsset(address, 'robinhood');
  assert.notEqual(ethereum.id, base.id);
  assert.notEqual(base.id, robinhood.id);
  assert.equal(robinhood.id, `evm:4663:${address}`);
  assert.equal(registry.byChain.hyperliquid.chainId, 999);
  assert.equal(registry.byChain.hyperliquid.rpc[0], 'https://rpc.hyperliquid.xyz/evm');
  assert.equal(registry.byChain.hyperliquid.marketChainId, 'hyperevm');
  const hyperEvmAsset = app.createDexAsset(address, 'hyperliquid');
  assert.equal(hyperEvmAsset.id, `evm:999:${address}`);
  app.chartAsset = hyperEvmAsset;
  assert.match(options.computed.chartExternalUrl.call(app), /dexscreener\.com\/hyperevm\//);
  assert.match(options.computed.chartUrl.call(app), /dexscreener\.com\/hyperevm\//);
  assert.equal(registry.byChain.bitcoin.addressType, 'native-only');
});

test('Robinhood metadata checks RPC chain ID before accepting token data', async () => {
  const chain = registry.byChain.robinhood;
  const address = `0x${'a'.repeat(40)}`;
  const calls = [];
  const fetcher = async (_url, request) => {
    const { method, params } = JSON.parse(request.body);
    calls.push(method);
    if (method === 'eth_chainId') return { ok: true, json: async () => ({ result: '0x1' }) };
    if (method === 'eth_call') return { ok: true, json: async () => ({ result: params[0].data }) };
  };
  await assert.rejects(registry.adapters.evm.metadata(chain, address, fetcher), /chainId/);
  assert.deepEqual(calls, ['eth_chainId']);
  assert.equal(await registry.adapters.tron.validate('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', webcrypto.subtle), true);
  assert.equal(registry.adapters.solana.validate('So11111111111111111111111111111111111111112'), true);
});

test('Solana Mint metadata retries another public RPC after a blocked endpoint', async () => {
  const urls = [];
  const metadata = await registry.adapters.solana.metadata(registry.byChain.solana, 'So11111111111111111111111111111111111111112', async url => {
    urls.push(url);
    if (urls.length === 1) return { ok: false, status: 403 };
    return { ok: true, json: async () => ({ result: { value: {
      owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      data: { parsed: { type: 'mint', info: { decimals: 9 } } }
    } } }) };
  });
  assert.equal(metadata.decimals, 9);
  assert.equal(urls.length, 2);
});

test('HyperEVM DEX lookup uses its provider chain name and ignores FDV', async () => {
  const app = fixture();
  const address = `0x${'a'.repeat(40)}`;
  const asset = app.createDexAsset(address, 'hyperliquid', { symbol: 'PURR', name: 'Purr', metadataStatus: '链上已核验' });
  app.watchedAssets = [asset];
  app.fetchWithSoftTimeout = async url => {
    assert.match(url, /\/tokens\/v1\/hyperevm\//);
    return { ok: true, json: async () => [{
      chainId: 'hyperevm', baseToken: { address, symbol: 'PURR', name: 'Purr' },
      quoteToken: { symbol: 'WHYPE' }, pairAddress: `0x${'b'.repeat(40)}`,
      priceUsd: '1.5', liquidity: { usd: 1000 }, volume: { h24: 100 },
      fullyDilutedValuation: 999999
    }] };
  };
  app.markSource = () => {};
  app.evaluatePriceAlerts = () => {};
  app.queueAssetUpdate = function queueAssetUpdate(id, patch) {
    this.pendingUpdates[id] = patch;
    this.flushQueuedUpdates();
  };
  await app.pollDexAssets([asset]);
  assert.equal(asset.price, 1.5);
  assert.equal(asset.marketCap, null);
  assert.equal(asset.id, `evm:999:${address}`);
});

test('market cap updates survive active backend quotes and use canonical provider ID', async () => {
  const app = fixture();
  const btc = app.createKnownAsset(registry.search('BTC'));
  assert.equal(btc.marketDataId, 'bitcoin');
  app.watchedAssets = [btc];
  app.backendIsActive = () => true;
  app.fetchWithSoftTimeout = async url => {
    assert.match(url, /ids=bitcoin/);
    return { ok: true, json: async () => [{ id: 'bitcoin', current_price: 100, circulating_supply: 20, image: 'https://example.test/btc.png' }] };
  };
  let sourceError;
  app.markSource = (_key, _status, error) => { if (error) sourceError = error; };
  app.evaluatePriceAlerts = () => {};
  app.queueAssetUpdate = function queueAssetUpdate(id, patch) {
    this.pendingUpdates[id] = patch;
    this.flushQueuedUpdates();
  };
  await options.methods.refreshMarketCaps.call(app);
  assert.equal(app.watchedAssets[0].id, btc.id);
  if (sourceError) throw sourceError;
  assert.equal(btc.marketCap, 2000);
  assert.equal(btc.logoUrl, 'https://example.test/btc.png');
  assert.equal(app.formatMarketCap(null), '--');
});

test('market cap and logo lookup use five canonical IDs and never substitute FDV', async () => {
  const app = fixture();
  const symbols = ['BTC', 'ETH', 'UNI', 'HYPE', 'ZEC'];
  app.watchedAssets = symbols.map(symbol => app.createKnownAsset(registry.search(symbol)));
  const ids = ['bitcoin', 'ethereum', 'uniswap', 'hyperliquid', 'zcash'];
  app.fetchWithSoftTimeout = async url => {
    for (const id of ids) assert.ok(url.includes(id));
    return { ok: true, json: async () => ids.map((id, index) => ({
      id, current_price: 10 + index, circulating_supply: index === 4 ? null : 100,
      market_cap: index === 4 ? null : (10 + index) * 100,
      fully_diluted_valuation: 999999,
      image: `https://example.test/${id}.png`
    })) };
  };
  app.markSource = () => {};
  app.evaluatePriceAlerts = () => {};
  app.queueAssetUpdate = function queueAssetUpdate(id, patch) {
    this.pendingUpdates[id] = patch;
    this.flushQueuedUpdates();
  };
  await options.methods.refreshMarketCaps.call(app);
  for (let index = 0; index < 4; index++) {
    assert.equal(app.watchedAssets[index].marketCap, (10 + index) * 100);
    assert.equal(app.watchedAssets[index].logoUrl, `https://example.test/${ids[index]}.png`);
  }
  assert.equal(app.watchedAssets[4].marketCap, null);
});

test('market cap fallback uses fixed canonical IDs without changing price or volume', async () => {
  const app = fixture();
  const cases = [
    ['BTC', 'btc-bitcoin', 1_700_000_000_000],
    ['ETH', 'eth-ethereum', 330_000_000_000],
    ['UNI', 'uni-uniswap', 5_500_000_000],
    ['HYPE', 'hype-hyperliquid', 21_000_000_000],
    ['ZEC', 'zec-zcash', 25_000_000_000]
  ];
  app.watchedAssets = cases.map(([symbol]) => app.createKnownAsset(registry.search(symbol)));
  app.watchedAssets.forEach((asset, index) => { asset.price = index + 1; asset.volume = index + 10; });
  const requested = [];
  app.fetchWithSoftTimeout = async url => {
    requested.push(url);
    if (url.includes('coingecko.com')) return { ok: false, status: 429 };
    const [, id, marketCap] = cases.find(([, id]) => url.includes(`/tickers/${id}?`));
    return { ok: true, json: async () => ({ id, last_updated: new Date().toISOString(), quotes: { USD: { market_cap: marketCap, fully_diluted_valuation: marketCap * 2 } } }) };
  };
  app.markSource = () => {};
  app.evaluatePriceAlerts = () => {};
  app.queueAssetUpdate = function queueAssetUpdate(id, patch) {
    this.pendingUpdates[id] = patch;
    this.flushQueuedUpdates();
  };
  await options.methods.refreshMarketCaps.call(app);
  assert.equal(requested.length, 6);
  cases.forEach(([symbol, id, cap], index) => {
    assert.ok(requested.some(url => url.includes(`/tickers/${id}?`)));
    const asset = app.watchedAssets[index];
    assert.equal(asset.symbol, symbol);
    assert.equal(asset.marketCap, cap);
    assert.equal(asset.price, index + 1);
    assert.equal(asset.volume, index + 10);
  });
});

test('market cap fallback rejects mismatched provider ID and FDV-only records', async () => {
  const app = fixture();
  const uni = app.createKnownAsset(registry.search('UNI'));
  app.watchedAssets = [uni];
  app.fetchWithSoftTimeout = async url => url.includes('coingecko.com')
    ? { ok: false, status: 429 }
    : { ok: true, json: async () => ({ id: 'another-uniswap', last_updated: new Date().toISOString(), quotes: { USD: { market_cap: null, fully_diluted_valuation: 99_000_000_000 } } }) };
  app.markSource = () => {};
  await options.methods.refreshMarketCaps.call(app);
  assert.equal(uni.marketCap, null);
});
