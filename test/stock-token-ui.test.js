import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const registrySource = fs.readFileSync(new URL('asset-registry.js', root), 'utf8');
const searchSource = fs.readFileSync(new URL('stock-token-search.js', root), 'utf8');
const radarSource = fs.readFileSync(new URL('market-radar.js', root), 'utf8');
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
    localStorage: storage, TextDecoder, Uint8Array, BigInt, Map, Object, Number, Array, String, URLSearchParams
  });
  vm.runInContext(registrySource, context);
  vm.runInContext(searchSource, context);
  vm.runInContext(radarSource, context);
  vm.runInContext(inlineScript, context);
  const app = structuredClone(options.data);
  for (const [name, method] of Object.entries(options.methods)) app[name] = method.bind(app);
  for (const [name, compute] of Object.entries(options.computed)) {
    Object.defineProperty(app, name, { get: compute.bind(app) });
  }
  const messages = [];
  app.showToast = message => messages.push(message);
  app.$set = (target, key, value) => { target[key] = value; return value; };
  app.$delete = (target, key) => { delete target[key]; };
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

test('AAPLX and AAPLON share one watch state but independent market IDs, removal and persistent ordering', () => {
  const { app, storage } = fixture();
  const appleX = market('Gate', { canonicalId: 'stock-token:xstocks:aaplx:gate:aaplxusdt::', displaySymbol: 'AAPLX', underlyingSymbol: 'AAPL', exchangeSymbol: 'AAPLX_USDT' });
  const appleOn = market('Gate', { canonicalId: 'stock-token:ondo:aaplon:gate:aaplonusdt::', displaySymbol: 'AAPLON', underlyingSymbol: 'AAPL', issuer: 'Ondo', exchangeSymbol: 'AAPLON_USDT' });
  app.stockTokenMarkets = [appleX, appleOn];
  app.addToWatchlist(appleX); app.addToWatchlist(appleOn);
  assert.equal(app.assetSearchMode, 'stock_tokens');
  assert.equal(app.isInWatchlist(appleX), true); assert.equal(app.isInWatchlist(appleOn), true);
  app.moveStockTokenWatch(appleX.canonicalId, -1);
  assert.deepEqual(ids(app.stockTokenWatchlist), [appleX.canonicalId, appleOn.canonicalId]);
  const { app: reloaded } = fixture(storage); reloaded.loadWatchedAssets();
  assert.deepEqual(ids(reloaded.stockTokenWatchlist), [appleX.canonicalId, appleOn.canonicalId]);
  app.removeFromWatchlist(appleX);
  assert.equal(app.isInWatchlist(appleX), false); assert.equal(app.isInWatchlist(appleOn), true);
  app.addToWatchlist(appleX); app.removeFromWatchlist(appleOn);
  assert.equal(app.isInWatchlist(appleX), true); assert.equal(app.isInWatchlist(appleOn), false);
  assert.equal(app.stockTokenMarkets.length, 2);
});

test('Stock Tokens exist only in the upper unified terminal and the lower panel is US stocks only', () => {
  const upper = html.slice(html.indexOf('<nav class="asset-section-tabs"'), html.indexOf('<div id="stock-market-card"'));
  const lower = html.slice(html.indexOf('<div id="stock-market-card"'), html.indexOf('<div class="card span-3 global-card"'));
  assert.equal((html.match(/aria-label="股票代币行情表"/g) || []).length, 1);
  assert.match(upper, /aria-label="股票代币行情表"/);
  assert.match(lower, /<h2><span>美股<\/span>/);
  assert.match(lower, /class="us-stock-table"/);
  assert.doesNotMatch(lower, /股票代币|stockToken|isInWatchlist|addToWatchlist|removeFromWatchlist/);
  assert.doesNotMatch(lower, /stock-panel-tabs/);
});

test('market browser and top cards use the same helpers and canonical-ID source of truth', () => {
  const { app } = fixture();
  const gate = market();
  app.stockTokenMarkets = [gate];
  assert.strictEqual(app.getWatchlist(), app.stockTokenWatchlist);
  assert.equal(app.isInWatchlist(gate), false);
  app.addToWatchlist(gate);
  assert.equal(app.isInWatchlist(gate), true);
  assert.deepEqual(ids(app.getWatchlist()), [gate.canonicalId]);
  app.removeFromWatchlist(gate);
  assert.equal(app.isInWatchlist(gate), false);
  assert.equal(app.getWatchlist().length, 0);
});

test('search rows react immediately to add, remove, reorder, and persisted Stock Token state', () => {
  const { app, storage } = fixture();
  const amdon = market('Gate', { canonicalId: 'stock-token:ondo:amdon:gate:amdonusdt::', displaySymbol: 'AMDON', underlyingSymbol: 'AMD', issuer: 'Ondo', exchangeSymbol: 'AMDON_USDT' });
  const appleX = market('Gate', { canonicalId: 'stock-token:xstocks:aaplx:gate:aaplxusdt::', displaySymbol: 'AAPLX', underlyingSymbol: 'AAPL', exchangeSymbol: 'AAPLX_USDT' });
  const crclX = market();
  app.stockTokenMarkets = [amdon, appleX, crclX];
  app.stockTokenReady = true;
  app.stockTokenSearchInput = 'AMD';

  assert.strictEqual(app.stockTokenDisplayRows[0], amdon);
  app.addToWatchlist(amdon);
  assert.equal(app.stockTokenSearchInput, '');
  assert.equal(app.isInWatchlist(amdon), true);
  assert.strictEqual(app.stockTokenDisplayRows[0], app.stockTokenWatchlist[0]);
  assert.equal(app.stockTokenSearchResults.length, 0);

  app.removeFromWatchlist(amdon);
  assert.equal(app.isInWatchlist(amdon), false);
  assert.equal(app.stockTokenDisplayRows.length, 0);
  app.stockTokenSearchInput = 'AMD';
  assert.strictEqual(app.stockTokenDisplayRows[0], amdon);

  app.addToWatchlist(crclX);
  app.addToWatchlist(appleX);
  app.addToWatchlist(amdon);
  app.stockTokenSearchInput = '';
  const beforeMove = app.stockTokenWatchlist;
  app.moveStockTokenWatch(amdon.canonicalId, 1);
  assert.notStrictEqual(app.stockTokenWatchlist, beforeMove);
  assert.deepEqual(ids(app.stockTokenDisplayRows), [appleX.canonicalId, amdon.canonicalId, crclX.canonicalId]);

  const { app: reloaded } = fixture(storage);
  reloaded.loadWatchedAssets();
  assert.deepEqual(ids(reloaded.stockTokenWatchlist), ids(app.stockTokenWatchlist));
});

test('Stock Token search and watchlist use one responsive market-row component', () => {
  const upper = html.slice(html.indexOf('<section v-else class="stock-token-terminal"'), html.indexOf('<div v-show="assetSearchMode === \'crypto\'"'));
  assert.match(upper, /v-for="market in stockTokenDisplayRows"/);
  assert.match(upper, /股票代币<\/div><div>最新价<\/div><div>24h涨跌<\/div><div>24h成交量<\/div><div>市值 \/ 规模<\/div><div>走势图/);
  assert.match(upper, /v-if="isInWatchlist\(market\)"/);
  assert.match(upper, /moveStockTokenWatch/);
  assert.match(upper, /removeFromWatchlist/);
  assert.match(upper, /v-else><button[^>]*addToWatchlist/);
  assert.match(html, /\.stock-token-table-row \{[^}]*grid-template-columns:minmax\(190px,22fr\)[^}]*min-width:980px;[^}]*min-height:54px;/);
  assert.match(html, /@media \(max-width: 1024px\)[\s\S]*\.stock-token-table-row \{[^}]*grid-template-areas:"identity price change" "meta meta action";[^}]*min-height:68px;/);
  assert.match(upper, /搜索股票代币或底层股票，结果可直接加入自选。/);
  assert.match(upper, /formatTimestamp\(market\.lastUpdated\)\.split\('\.'\)\[0\]/);
  assert.match(upper, /暂无K线/);
  assert.match(upper, /market\.venue === 'Robinhood Chain' \? 'Robinhood' : market\.venue/);
  assert.match(upper, /market\.sourceType === 'issuer_reference' \? '参考价' : market\.issuer/);
});

test('Crypto and Stock Tokens share the nine-column desktop grid and real mini Kline presentation', async () => {
  assert.match(html, /币种<\/div>[\s\S]*24h走势<\/div>[\s\S]*数据源<\/div>[\s\S]*操作<\/div>/);
  assert.match(html, /\.watch-row \{[^}]*grid-template-columns:\s*minmax\(190px,22fr\)[^}]*min-width:\s*980px;[^}]*min-height:\s*54px;/);
  assert.match(html, /@media \(min-width: 769px\) and \(max-width: 1024px\)[\s\S]*\.watch-row, \.stock-token-table-row \{[^}]*minmax\(190px,22fr\)/);
  assert.match(html, /class="crypto-spark"[^>]*cryptoKlineTitle\(asset\)[\s\S]*?<svg v-if="cryptoSparklinePoints\(asset\)"/);
  assert.match(html, /@media \(max-width: 768px\)[\s\S]*grid-template-areas:"token price change" "mobileMeta mobileMeta action"/);

  const { app } = fixture();
  const btc = { id: 'cex:BTCUSDT', type: 'cex', pair: 'BTCUSDT', canonicalAssetId: 'bitcoin' };
  app.fetchWithSoftTimeout = async url => {
    assert.match(url, /^\/api\/crypto\/klines\?type=cex&assetId=bitcoin&pair=BTCUSDT$/);
    return { ok: true, json: async () => ({
      status: 'ok', source: 'Binance Spot Klines', market: 'BTCUSDT', lastTimestamp: 24,
      candles: Array.from({ length: 24 }, (_, index) => ({
        timestamp: index + 1, open: 100 + index, high: 102 + index,
        low: 99 + index, close: 101 + index, volume: 10
      }))
    }) };
  };
  await app.loadCryptoMiniKline(btc);
  assert.equal(app.cryptoSparklines[btc.id].length, 24);
  assert.match(app.cryptoSparklinePoints(btc), /,/);
  assert.match(app.cryptoKlineTitle(btc), /Binance Spot Klines · BTCUSDT · 24 candles/);

  const pons = {
    id: 'evm:robinhood:pons', type: 'dex', pair: 'PONS/USDC', chainId: 'robinhood',
    tokenAddress: '0x39dbed3a2bd333467115de45665cc57f813c4571',
    dexPairAddress: '0xed50bdeea8adc232f159486192a4157281d722ff'
  };
  app.fetchWithSoftTimeout = async url => {
    assert.match(url, /type=dex&chain=robinhood&contract=0x39dbed/);
    assert.match(url, /pool=0xed50bdee/);
    return { ok: true, json: async () => ({
      status: 'ok', source: 'GeckoTerminal Pool OHLCV', market: 'robinhood:0xed50',
      candles: [
        { timestamp: 1, open: 1, high: 2, low: 1, close: 1.5, volume: 10 },
        { timestamp: 2, open: 1.5, high: 2, low: 1.2, close: 1.8, volume: 12 }
      ]
    }) };
  };
  await app.loadCryptoMiniKline(pons);
  assert.equal(app.cryptoSparklines[pons.id].length, 2);
});

test('XMR mini Kline uses the normalized server resolver and Crypto timestamps render HH:mm:ss without milliseconds', async () => {
  const { app } = fixture();
  const xmr = { id: 'cex:XMRUSDT', type: 'cex', pair: 'XMRUSDT', canonicalAssetId: 'monero' };
  app.fetchWithSoftTimeout = async url => {
    assert.match(url, /^\/api\/crypto\/klines\?type=cex&assetId=monero&pair=XMRUSDT$/);
    return { ok: true, json: async () => ({
      status: 'ok', source: 'Kraken Spot OHLC', market: 'XMR/USD',
      candles: [
        { timestamp: 1, open: 199, high: 201, low: 198, close: 200, volume: 2 },
        { timestamp: 2, open: 200, high: 203, low: 199, close: 202, volume: 3 }
      ]
    }) };
  };
  await app.loadCryptoMiniKline(xmr);
  assert.deepEqual(Array.from(app.cryptoSparklines[xmr.id], candle => candle.close), [200, 202]);
  assert.equal(app.assetTimeText({ dataTime: '2026/9/23 17:09:51.760' }), '17:09:51');
  assert.equal(app.assetTimeText({ dataTime: '2026-09-23T17:09:51.760Z' }), '17:09:51');
  assert.equal(app.assetTimeTitle({ dataTime: '2026/9/23 17:09:51.760' }), '数据 2026/9/23 17:09:51.760');
});

test('data sources panel is centered, responsive, provider-accurate, and shares the restrained primary button', () => {
  assert.match(html, /\.sources-notice \{ max-width:1200px; margin:18px auto 0;/);
  assert.match(html, /\.source-group-grid \{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(html, /@media\(max-width:900px\) \{ \.source-group-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /@media\(max-width:350px\) \{ \.source-group-grid \{ grid-template-columns:1fr/);
  assert.match(html, /class="bottom-notice-link sources-link"[^>]*>ⓘ 来源与计算说明</);
  assert.match(html, /Hyperliquid/);
  assert.match(html, /Kraken/);
  assert.match(html, /GeckoTerminal/);
  assert.match(html, /\.add-btn \{[^}]*height: 38px;[^}]*border-radius: 8px;[^}]*background: #1f8f62;/);
});

test('Market Radar UI separates official sentiment, momentum, valuation, and aggregate risk', () => {
  const { app } = fixture();
  const now = Date.now();
  app.clockNow = now;
  app.fgValue = 71;
  app.fgText = '贪婪';
  app.fgOfficialClassification = 'Greed';
  app.fgStale = false;
  app.fgDataTime = '2026/9/24 00:00:00';
  Object.assign(app.dataSources.fearGreed, { status: '轮询', lastUpdate: now });
  app.ahrValue = '0.5700';
  Object.assign(app.dataSources.ahr999, { status: '估算', lastUpdate: now });
  app.watchedAssets = [
    { id: 'btc', pair: 'BTCUSDT', price: 84000, changePct: -2.3, stale: false, sourceType: 'binance', source: 'Binance WS', dataTime: '2026/9/24 00:00:01' },
    { id: 'eth', pair: 'ETHUSDT', price: 2600, changePct: -2.6, stale: false, sourceType: 'binance', source: 'Binance WS', dataTime: '2026/9/24 00:00:02' }
  ];
  assert.equal(app.marketRadar.sentiment, '71 · 贪婪');
  assert.equal(app.marketRadar.momentum, '偏弱');
  assert.equal(app.marketRadar.valuation, '定投区间');
  assert.equal(app.marketRadar.state, '中等风险');
  const before = app.marketRadar.state;
  app.watchedAssets.push(
    { id: 'a', pair: 'AUSDT', price: 1, changePct: -10, stale: false, sourceType: 'dex' },
    { id: 'b', pair: 'BUSDT', price: 1, changePct: -10, stale: false, sourceType: 'dex' }
  );
  assert.equal(app.marketRadar.state, before);
  assert.match(app.marketRadar.basis[0].note, /Alternative\.me.*参与综合风险/);
  assert.match(app.marketRadar.basis[1].note, /Binance WS.*参与综合风险/);
  assert.doesNotMatch(html, /marketRadar\.upCount|marketRadar\.downCount/);
  assert.match(html, /综合市场状态/);
  assert.match(html, /市场情绪[\s\S]*短期动量[\s\S]*估值状态[\s\S]*综合风险/);
});

test('Stock Token scale is explicitly underlying market cap, ETF AUM, or unavailable', () => {
  const { app } = fixture();
  app.stocks = [{ symbol: 'AAPL', marketCap: 4.95e12, assetType: 'stock' }];
  const apple = market('Gate', { underlyingSymbol: 'AAPL', assetType: 'stock_token' });
  const etf = market('Gate', { underlyingSymbol: 'SPY', assetType: 'etf_token' });
  const unknown = market('Gate', { underlyingSymbol: 'XYZ', assetType: 'stock_token' });
  assert.equal(app.stockTokenScale(apple).label, '底层市值');
  assert.match(app.stockTokenScale(apple).value, /万亿/);
  assert.match(app.stockTokenScale(apple).detail, /Underlying Market Cap/);
  assert.equal(app.stockTokenScale(etf).label, 'AUM');
  assert.equal(app.stockTokenScale(etf).value, '--');
  assert.equal(app.stockTokenScale(unknown).value, '--');
});

test('US stock table maps Tencent quote amount and market cap without confusing turnover rate', () => {
  assert.match(html, /const quoteVolume = parseFloat\(arr\[37\]\);/);
  assert.match(html, /const marketCapHundredMillion = parseFloat\(arr\[45\]\);/);
  assert.match(html, /marketCapHundredMillion \* 100_000_000/);
  assert.match(html, /stock\.assetType === 'etf' \? '--' : formatMarketCap\(stock\.marketCap\)/);
});

test('Gate markets expose real Kline periods while issuer references never fabricate OHLC', async () => {
  const { app } = fixture();
  const gate = market();
  const reference = market('Robinhood Chain', { sourceType: 'issuer_reference', exchangeSymbol: 'CRCL' });
  assert.equal(app.stockTokenHasKline(gate), true);
  assert.equal(app.stockTokenHasKline(reference), false);
  app.chartAsset = { ...gate, type: 'stock_token' };
  app.chartInterval = '4H';
  app.fetchWithSoftTimeout = async url => {
    assert.match(url, /venue=Gate/); assert.match(url, /pair=CRCLX_USDT/); assert.match(url, /period=4H/);
    return { ok: true, json: async () => ({ data: [
      { time: 1, open: 90, high: 96, low: 89, close: 95, quoteVolume: 100, baseVolume: 1 },
      { time: 2, open: 95, high: 98, low: 94, close: 97, quoteVolume: 120, baseVolume: 2 }
    ] }) };
  };
  await app.loadStockTokenKlines();
  assert.equal(app.stockTokenKlines.length, 2);
  assert.match(app.stockTokenSparklinePoints(gate), /,/);
  app.chartAsset = { ...reference, type: 'stock_token' };
  assert.match(app.chartNotice, /参考价/);
});

test('legacy Stock Token variants migrate only unambiguous registry markets without clearing Crypto', async () => {
  const storage = memoryStorage();
  const { app } = fixture(storage);
  const pons = { type: 'dex', chainId: 'robinhood', tokenAddress: `0x${'a'.repeat(40)}`,
    metadata: { name: 'Pons', symbol: 'PONS' } };
  storage.setItem(app.storageKey, JSON.stringify([
    { type: 'cex', pair: 'BTCUSDT' }, { type: 'cex', pair: 'ZECUSDT' },
    { type: 'cex', pair: 'UNIUSDT' }, { type: 'cex', pair: 'XMRUSDT' }, pons,
    { type: 'stock-token', symbol: 'CRCLX', venue: 'Gate', pair: 'CRCLX_USDT' },
    { assetType: 'stockToken', symbol: 'AAPLX', venue: 'Gate', exchangeSymbol: 'AAPLX_USDT' },
    { type: 'stocks', underlying: 'AAPL' }
  ]));
  app.loadWatchedAssets();
  assert.deepEqual(Array.from(app.watchedAssets, item => item.symbol), ['BTC', 'ZEC', 'UNI', 'XMR', 'PONS']);
  assert.equal(app.stockTokenWatchlist.length, 0);
  assert.equal(app.pendingLegacyStockTokens.length, 3);
  const appleX = market('Gate', { canonicalId: 'stock-token:xstocks:aaplx:gate:aaplxusdt::',
    symbol: 'AAPLX', displaySymbol: 'AAPLX', underlyingSymbol: 'AAPL', exchangeSymbol: 'AAPLX_USDT' });
  const appleOn = market('Gate', { canonicalId: 'stock-token:ondo:aaplon:gate:aaplonusdt::',
    symbol: 'AAPLON', displaySymbol: 'AAPLON', underlyingSymbol: 'AAPL', issuer: 'Ondo', exchangeSymbol: 'AAPLON_USDT' });
  app.stockTokenMarkets = [market(), appleX, appleOn];
  assert.equal(app.migrateLegacyStockTokenWatchlist(), true);
  assert.deepEqual(ids(app.getWatchlist()), [market().canonicalId, appleX.canonicalId]);
  assert.equal(app.pendingLegacyStockTokens.length, 1);
  assert.equal(app.isInWatchlist(appleOn), false);
  const saved = JSON.parse(storage.getItem(app.storageKey));
  assert.equal(saved.filter(item => item.type === 'cex').length, 4);
  assert.equal(saved.filter(item => item.type === 'dex').length, 1);
  assert.equal(saved.filter(item => item.type === 'stock_token').length, 2);
  assert.equal(saved.some(item => item.type === 'stocks' && item.underlying === 'AAPL'), true);
  const { app: reloaded } = fixture(storage);
  reloaded.loadWatchedAssets();
  reloaded.stockTokenMarkets = app.stockTokenMarkets;
  reloaded.hydrateStockTokenWatchlist();
  assert.deepEqual(ids(reloaded.getWatchlist()), ids(app.getWatchlist()));
  assert.deepEqual(Array.from(reloaded.watchedAssets, item => item.symbol), ['BTC', 'ZEC', 'UNI', 'XMR', 'PONS']);
});

test('a storage event reloads the one persisted watchlist for every page region', () => {
  const storage = memoryStorage();
  const { app } = fixture(storage);
  const gate = market();
  app.stockTokenMarkets = [gate]; app.stockTokenReady = true;
  storage.setItem(app.storageKey, JSON.stringify([{ ...gate, type: 'stock_token' }]));
  app.handleWatchlistStorage({ key: app.storageKey });
  assert.equal(app.isInWatchlist(gate), true);
  assert.deepEqual(ids(app.getWatchlist()), [gate.canonicalId]);
  storage.setItem(app.storageKey, '[]');
  app.handleWatchlistStorage({ key: app.storageKey });
  assert.equal(app.isInWatchlist(gate), false);
  assert.equal(app.getWatchlist().length, 0);
});

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
  app.addToWatchlist(gate);
  app.addToWatchlist(bybit);
  const writes = storage.writes;
  app.addToWatchlist({ ...gate, price: 96 });
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
  app.addToWatchlist(gate);
  app.addToWatchlist(bybit);
  app.removeFromWatchlist(gate);
  const { app: reloaded } = fixture(storage);
  reloaded.loadWatchedAssets();
  assert.deepEqual(ids(reloaded.stockTokenWatchlist), [bybit.canonicalId]);
  reloaded.removeFromWatchlist(bybit);
  assert.equal(storage.getItem(app.storageKey), '[]');
  const { app: empty } = fixture(storage);
  empty.loadWatchedAssets();
  assert.equal(empty.stockTokenWatchlist.length, 0);
  assert.equal(empty.watchedAssets.length, 0);
  assert.equal(JSON.stringify(app.stockTokenMarkets), registryBefore);
  const results = context.CryptoAIStockTokenSearch.search(app.stockTokenMarkets, 'CRCLX');
  assert.equal(results.length, 2);
  empty.addToWatchlist(results.find(item => item.canonicalId === gate.canonicalId));
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
  app.addToWatchlist(gate);
  app.addToWatchlist(bybit);
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
  app.addToWatchlist(gate);
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
    assert.equal(timeout, 25000);
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
  app.addToWatchlist(gate);
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
  app.loadStockTokenMiniKline = async () => {};
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
