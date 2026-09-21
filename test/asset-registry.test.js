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
  const app = { ...options.data, ...options.methods, pendingUpdates: {}, rafId: null };
  app.backendIsActive = () => false;
  app.showToast = () => {};
  app.routeWatchedAssets = () => {};
  app.startFallbackPolling = () => {};
  app.refreshMarketCaps = () => {};
  app.saveWatchedAssets = () => {};
  return app;
}

test('known search uses canonical identity; unknown ticker needs a contract', async () => {
  const app = fixture();
  app.assetInput = 'HYPE';
  await app.addWatchAsset();
  assert.equal(app.watchedAssets[0].id, 'hyperliquid:HYPE');
  assert.equal(app.watchedAssets[0].marketDataId, 'hyperliquid');
  assert.equal(app.watchedAssets[0].displayName, 'Hyperliquid');
  app.assetInput = 'MYSTERY';
  await app.addWatchAsset();
  assert.equal(app.watchedAssets.length, 1);
  assert.match(app.watchError, /未收录/);
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
