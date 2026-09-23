import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const registrySource = fs.readFileSync(new URL('asset-registry.js', root), 'utf8');
const searchSource = fs.readFileSync(new URL('stock-token-search.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const inlineScript = html.split('<script>')[1].split('</script>')[0];

function memoryStorage() {
  const entries = new Map();
  return {
    writes: 0,
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, String(value)); this.writes += 1; }
  };
}

function fixture(storage = memoryStorage()) {
  let options;
  const context = vm.createContext({
    Vue: function Vue(config) { options = config; },
    localStorage: storage, TextDecoder, Uint8Array, BigInt, Map, Object, Number, Array, String
  });
  vm.runInContext(registrySource, context);
  vm.runInContext(searchSource, context);
  vm.runInContext(inlineScript, context);
  const app = structuredClone(options.data);
  for (const [name, method] of Object.entries(options.methods)) app[name] = method.bind(app);
  for (const [name, compute] of Object.entries(options.computed)) {
    Object.defineProperty(app, name, { get: compute.bind(app) });
  }
  const messages = [];
  app.showToast = message => messages.push(message);
  // Prevent market streams and background polling; persistence and asset logic stay real.
  app.routeWatchedAssets = () => {};
  app.startFallbackPolling = () => {};
  app.scheduleMarketCapRefresh = () => {};
  app.fetchWithSoftTimeout = async url => { throw new Error(`Unexpected network request: ${url}`); };
  return { app, storage, context, messages };
}

function market(venue = 'Gate', overrides = {}) {
  const exchangeSymbol = venue === 'Gate' ? 'CRCLX_USDT' : 'CRCLXUSDT';
  return {
    canonicalId: `stock-token:xstocks:crclx:${venue.toLowerCase()}:crclxusdt::`,
    symbol: 'CRCLX', displaySymbol: 'CRCLX', underlyingSymbol: 'CRCL', underlyingName: 'Circle',
    venue, issuer: 'xStocks', exchangeSymbol, assetType: 'stock_token', sourceType: 'exchange',
    price: 95, change24h: 2.5, volume24h: 1000, lastUpdated: Date.now(), stale: false,
    ...overrides
  };
}

const ids = items => Array.from(items, item => item.canonicalId);
const response = markets => ({ ok: true, json: async () => ({ data: markets, health: {} }) });

test('shared storage round-trips Crypto and separate venues without duplicate Stock Token additions', async () => {
  const { app, storage, messages } = fixture();
  for (const symbol of ['BTC', 'ZEC']) {
    app.assetInput = symbol;
    await app.addWatchAsset();
  }
  const dex = app.createDexAsset(`0x${'a'.repeat(40)}`, 'ethereum', { name: 'Example Token', symbol: 'EXAMPLE' });
  app.finishAddWatchAsset(dex);
  const cryptoIds = Array.from(app.watchedAssets, asset => asset.id);
  const gate = market();
  const bybit = market('Bybit');
  app.addStockTokenToWatchlist(gate);
  app.addStockTokenToWatchlist(bybit);
  const writes = storage.writes;
  app.addStockTokenToWatchlist({ ...gate, price: 96 });
  assert.equal(app.stockTokenWatchlist.length, 2);
  assert.equal(storage.writes, writes);
  assert.match(messages.at(-1), /已在自选中/);

  const saved = JSON.parse(storage.getItem(app.storageKey));
  assert.deepEqual(saved.filter(item => item.type === 'stock_token').map(item => item.canonicalId), [bybit.canonicalId, gate.canonicalId]);
  assert.equal(saved.filter(item => item.type === 'cex').length, 2);
  assert.equal(saved.filter(item => item.type === 'dex').length, 1);
  const { app: reloaded } = fixture(storage);
  reloaded.loadWatchedAssets();
  assert.deepEqual(Array.from(reloaded.watchedAssets, asset => asset.id), cryptoIds);
  assert.deepEqual(ids(reloaded.stockTokenWatchlist), [bybit.canonicalId, gate.canonicalId]);
  assert.ok(reloaded.stockTokenWatchlist.every(item => item.stale));
  assert.ok(reloaded.watchedAssets.every(item => item.type !== 'stock_token'));
  reloaded.removeWatchAsset(dex.id);
  const { app: afterCryptoRemoval } = fixture(storage);
  afterCryptoRemoval.loadWatchedAssets();
  assert.deepEqual(ids(afterCryptoRemoval.stockTokenWatchlist), [bybit.canonicalId, gate.canonicalId]);
  assert.equal(afterCryptoRemoval.watchedAssets.length, 2);
});

test('Stock Token removal persists, an empty list stays empty, and registry assets remain searchable and re-addable', () => {
  const { app, storage, context } = fixture();
  const gate = market();
  const bybit = market('Bybit');
  app.stockTokenMarkets = [gate, bybit];
  const registryBefore = JSON.stringify(app.stockTokenMarkets);
  app.addStockTokenToWatchlist(gate);
  app.addStockTokenToWatchlist(bybit);
  app.removeStockTokenFromWatchlist(gate.canonicalId);
  const { app: reloaded } = fixture(storage);
  reloaded.loadWatchedAssets();
  assert.deepEqual(ids(reloaded.stockTokenWatchlist), [bybit.canonicalId]);
  reloaded.removeStockTokenFromWatchlist(bybit.canonicalId);
  assert.equal(storage.getItem(app.storageKey), '[]');
  const { app: empty } = fixture(storage);
  empty.loadWatchedAssets();
  assert.equal(empty.stockTokenWatchlist.length, 0);
  assert.equal(empty.watchedAssets.length, 0);
  assert.equal(JSON.stringify(app.stockTokenMarkets), registryBefore);
  const results = context.CryptoAIStockTokenSearch.search(app.stockTokenMarkets, 'CRCLX');
  assert.equal(results.length, 2);
  empty.addStockTokenToWatchlist(results.find(item => item.canonicalId === gate.canonicalId));
  const { app: addedAgain } = fixture(storage);
  addedAgain.loadWatchedAssets();
  assert.deepEqual(ids(addedAgain.stockTokenWatchlist), [gate.canonicalId]);
});

test('restoring saved markets deduplicates canonical IDs and marks snapshots stale', () => {
  const { app, storage } = fixture();
  const gate = { ...market(), type: 'stock_token' };
  const bybit = { ...market('Bybit'), type: 'stock_token' };
  storage.setItem(app.storageKey, JSON.stringify([gate, null, { ...gate, price: 96 }, bybit, { type: 'cex', pair: 'BTCUSDT' }]));
  app.loadWatchedAssets();
  assert.deepEqual(ids(app.stockTokenWatchlist), [gate.canonicalId, bybit.canonicalId]);
  assert.ok(app.stockTokenWatchlist.every(item => item.stale));
  assert.equal(app.watchedAssets.length, 1);
  assert.equal(app.watchedAssets[0].symbol, 'BTC');
});

test('quote hydration updates matching markets and marks missing markets stale without rewriting saved choices', () => {
  const { app, storage } = fixture();
  const gate = market();
  const bybit = market('Bybit');
  app.addStockTokenToWatchlist(gate);
  app.addStockTokenToWatchlist(bybit);
  // Another tab has removed its selection while this tab still has an older view.
  storage.setItem(app.storageKey, '[]');
  const writes = storage.writes;
  app.stockTokenMarkets = [{ ...gate, price: 101, change24h: 3, stale: false }];
  app.hydrateStockTokenWatchlist();
  assert.equal(storage.writes, writes);
  assert.equal(storage.getItem(app.storageKey), '[]');
  const current = app.stockTokenWatchlist.find(item => item.canonicalId === gate.canonicalId);
  assert.equal(current.price, 101);
  assert.equal(current.stale, false);
  const missing = app.stockTokenWatchlist.find(item => item.canonicalId === bybit.canonicalId);
  assert.equal(missing.price, bybit.price);
  assert.equal(missing.stale, true);
});

test('initial registry errors are unavailable rather than a ready zero-market result, and retry recovers', async () => {
  const { app } = fixture();
  const gate = market();
  app.addStockTokenToWatchlist(gate);
  const failedResponses = [
    async () => { throw new Error('Connection refused'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => ({ unexpected: [] }) }),
    async () => response([])
  ];
  for (const failed of failedResponses) {
    app.fetchWithSoftTimeout = failed;
    await app.fetchStockTokens();
    assert.equal(app.stockTokenReady, false);
    assert.equal(app.stockTokenLoading, false);
    assert.ok(app.stockTokenLoadError);
    assert.match(app.stockTokenLoadMessage, /暂时无法获取/);
    assert.equal(app.stockTokenMarkets.length, 0);
    assert.equal(app.stockTokenWatchlist[0].stale, true);
  }
  app.fetchWithSoftTimeout = async (url, timeout) => {
    assert.equal(url, '/api/stock-tokens/markets');
    assert.equal(timeout, 10000);
    return response([gate]);
  };
  await app.fetchStockTokens();
  assert.equal(app.stockTokenReady, true);
  assert.equal(app.stockTokenLoadError, '');
  assert.equal(app.stockTokenStats.total, 1);
  assert.equal(app.stockTokenWatchlist[0].stale, false);
});

test('failed registry refresh retains cached markets and watchlist as stale until recovery', async () => {
  const { app } = fixture();
  const gate = market();
  app.fetchWithSoftTimeout = async () => response([gate]);
  await app.fetchStockTokens();
  app.addStockTokenToWatchlist(gate);
  app.fetchWithSoftTimeout = async () => ({ ok: false, status: 500 });
  await app.fetchStockTokens();
  assert.equal(app.stockTokenReady, true);
  assert.equal(app.stockTokenStats.total, 1);
  assert.equal(app.stockTokenStats.stale, 1);
  assert.equal(app.stockTokenWatchlist[0].price, gate.price);
  assert.equal(app.stockTokenWatchlist[0].stale, true);
  assert.match(app.stockTokenLoadMessage, /上次记录/);
  app.fetchWithSoftTimeout = async () => response([{ ...gate, price: 99 }]);
  await app.fetchStockTokens();
  assert.equal(app.stockTokenLoadError, '');
  assert.equal(app.stockTokenMarkets[0].stale, false);
  assert.equal(app.stockTokenWatchlist[0].stale, false);
  assert.equal(app.stockTokenWatchlist[0].price, 99);
});

test('Stock Tokens submission only uses registry data and mode switches clear old Crypto errors and candidates', async () => {
  const { app, context } = fixture();
  const gate = market();
  const ondo = market('Gate', { canonicalId: 'stock-token:ondo:crclon:gate:crclonusdt::', symbol: 'CRCLON', displaySymbol: 'CRCLON', issuer: 'Ondo', exchangeSymbol: 'CRCLON_USDT' });
  const reference = market('Robinhood Chain', {
    canonicalId: 'stock-token:robinhood:crcl:robinhood:crcl:4663:fixture', symbol: 'CRCL', displaySymbol: 'CRCL',
    issuer: 'Robinhood Assets (Jersey)', exchangeSymbol: 'CRCL', sourceType: 'issuer_reference'
  });
  const registry = [gate, ondo, reference];
  let requests = 0;
  app.fetchWithSoftTimeout = async url => {
    requests += 1;
    assert.equal(url, '/api/stock-tokens/markets');
    return response(registry);
  };
  app.assetSearchMode = 'stock_tokens';
  app.assetInput = `0x${'a'.repeat(40)}`;
  app.selectedChainId = 'ethereum';
  app.stockTokenSearchInput = 'CRCL';
  // Trap accidental calls to Crypto discovery or address validation in this mode.
  context.CryptoAIAssets = {
    ...context.CryptoAIAssets,
    searchCandidates: () => { assert.fail('Stock Tokens invoked Crypto search'); }
  };
  app.isLikelyContract = () => { assert.fail('Stock Tokens invoked Crypto address validation'); };
  await app.addWatchAsset();
  assert.equal(requests, 1);
  assert.equal(app.watchedAssets.length, 0);
  assert.equal(app.stockTokenWatchlist.length, 0);
  assert.deepEqual(ids(app.stockTokenSearchResults), registry.map(item => item.canonicalId));
  assert.match(app.stockTokenPriceType(reference), /参考价/);
  assert.doesNotMatch(app.stockTokenPriceType(reference), /成交价/);
  app.stockTokenSearchInput = 'CRCLX';
  assert.deepEqual(ids(app.stockTokenSearchResults), [gate.canonicalId]);
  await app.addWatchAsset();
  assert.equal(requests, 1);

  for (const mode of ['crypto', 'stock_tokens']) {
    app.watchError = '请先选择对应链';
    app.assetCandidates = [{ id: 'old-crypto-result' }];
    app.selectAssetSearchMode(mode);
    assert.equal(app.assetSearchMode, mode);
    assert.equal(app.watchError, '');
    assert.equal(app.assetCandidates.length, 0);
  }
  assert.equal(app.selectedChainId, 'ethereum');
  assert.equal(app.assetInput, `0x${'a'.repeat(40)}`);
});
