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
  app.saveWatchedAssets = () => {};
  return app;
}

test('selected chain does not turn a global ticker into a chain asset', async () => {
  const app = fixture();
  app.assetInput = 'HYPE';
  await app.addWatchAsset();
  assert.equal(app.watchedAssets.length, 0);
  assert.match(app.watchError, /合约\/Mint 地址/);
  app.selectedChainId = 'robinhood';
  for (const symbol of ['PONS', 'STONK', '7777', 'SHROOM']) {
    app.assetInput = symbol;
    await app.addWatchAsset();
    assert.equal(app.watchedAssets.length, 0);
    assert.match(app.watchError, /Robinhood Chain 未收录/);
  }
  app.selectedChainId = 'bitcoin';
  app.assetInput = 'ETH';
  await app.addWatchAsset();
  assert.equal(app.watchedAssets.length, 0);
  app.assetInput = 'BTC';
  await app.addWatchAsset();
  assert.equal(app.watchedAssets[0].id, 'bitcoin:BTC');
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
