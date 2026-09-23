import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyStockToken, createStockTokenMarket, inferUnderlyingSymbol } from '../src/stock-tokens/model.js';
import { GateStockTokenAdapter, RobinhoodStockTokenAdapter } from '../src/stock-tokens/adapters.js';
import { MemoryStockTokenRepository, SharedStockTokenRepository } from '../src/stock-tokens/repository.js';
import { StockTokenWorker } from '../src/stock-tokens/worker.js';
import { createStockTokenMarketsHandler } from '../api/stock-tokens/markets.js';
import { createStockTokenRefreshHandler } from '../api/stock-tokens/refresh.js';
import '../asset-registry.js';

const response = value => ({ ok: true, async json() { return value; } });

test('detector accepts metadata-backed spot stock tokens and rejects crypto, perpetuals, equities and leveraged tokens', () => {
  assert.equal(classifyStockToken({ productType: 'xstocks', marketType: 'spot', baseAsset: 'AAPLX' }).underlyingSymbol, 'AAPL');
  assert.equal(classifyStockToken({ name: 'NVIDIA Ondo Tokenized', marketType: 'normal', baseAsset: 'NVDAON' }).underlyingSymbol, 'NVDA');
  assert.equal(classifyStockToken({ name: 'Bitcoin', marketType: 'spot', baseAsset: 'BTC' }), null);
  assert.equal(classifyStockToken({ productType: 'stock', marketType: 'linear', baseAsset: 'NVDA' }), null);
  assert.equal(classifyStockToken({ productType: 'traditional_equity', marketType: 'stock', baseAsset: 'AAPL' }), null);
  assert.equal(classifyStockToken({ name: 'NVDA3xLong', marketType: 'normal', baseAsset: 'NVDA3L' }), null);
});

test('underlying mapping normalizes xStocks, Ondo and dotted equity symbols only after classification', () => {
  assert.equal(inferUnderlyingSymbol({ baseAsset: 'AAPLX', issuer: 'xStocks' }), 'AAPL');
  assert.equal(inferUnderlyingSymbol({ baseAsset: 'NVDAON', issuer: 'Ondo' }), 'NVDA');
  assert.equal(inferUnderlyingSymbol({ baseAsset: 'CRCLX', issuer: 'xStocks' }), 'CRCL');
  assert.equal(inferUnderlyingSymbol({ underlyingTicker: 'BRK.B' }), 'BRKB');
});

test('discovery finds exactly 15 metadata-backed stock tokens among 100 markets', async () => {
  const pairs = Array.from({ length: 100 }, (_, index) => index < 15 ? {
    id: `TEST${index}X_USDT`, base: `TEST${index}X`, base_name: `Company ${index} xStock`, quote: 'USDT',
    type: 'normal', trade_status: 'tradable'
  } : { id: `COIN${index}_USDT`, base: `COIN${index}`, base_name: `Crypto ${index}`, quote: 'USDT', type: 'normal', trade_status: 'tradable' });
  const tickers = pairs.map((pair, index) => ({ currency_pair: pair.id, last: String(index + 1), change_percentage: '1.5', quote_volume: '1000' }));
  const fetchImpl = async url => response(url.includes('currency_pairs') ? pairs : tickers);
  const markets = await new GateStockTokenAdapter({ fetchImpl, retries: 0 }).discover(1_000);
  assert.equal(markets.length, 15);
  assert.ok(markets.every(market => market.marketType === 'spot' && market.sourceType === 'exchange'));
});

test('Robinhood registry preserves contract identity and labels issuer pricing as reference data', async () => {
  const assets = { assets: [{ tokenSymbol: 'SPY', tokenName: 'SPDR S&P 500 ETF Trust • Robinhood Token',
    currentMultiplier: '1.01', status: 'ASSET_STATUS_ACTIVE', deployments: [{ chainId: 4663,
      networkName: 'Robinhood Chain', contractAddress: `0x${'a'.repeat(40)}` }] }] };
  const prices = { quotes: [{ tokenSymbol: 'SPY', bid: '100', ask: '102', currency: 'USD',
    dailyTradingVolume: '999', isTradingHalt: false, generatedAt: '2026-09-23T00:00:00Z' }] };
  const fetchImpl = async url => response(url.endsWith('/assets') ? assets : prices);
  const markets = await new RobinhoodStockTokenAdapter({ fetchImpl, retries: 0 }).discover(Date.parse('2026-09-23T00:00:01Z'));
  assert.equal(markets.length, 1);
  assert.equal(markets[0].assetType, 'etf_token');
  assert.equal(markets[0].underlyingReferencePrice, 101);
  assert.equal(markets[0].price, 102.01);
  assert.equal(markets[0].volume24h, null);
  assert.equal(markets[0].sourceType, 'issuer_reference');
  assert.equal(markets[0].issuer, 'Robinhood Assets (Jersey)');
  assert.equal(markets[0].contractAddress, `0x${'a'.repeat(40)}`);
});

test('provider failure leaves cached venue data available while a secondary venue continues', async () => {
  const repository = new MemoryStockTokenRepository({ staleAfterMs: 100 });
  const market = createStockTokenMarket({ productType: 'xstocks', name: 'Circle xStock', venue: 'Gate',
    exchangeSymbol: 'CRCLX_USDT', baseAsset: 'CRCLX', quoteAsset: 'USDT', price: 120, change24h: 1,
    volume24h: 10_000, lastUpdated: 1_000 });
  await repository.replaceVenueMarkets('Gate', [market], 1_000);
  const failed = { id: 'bybit-xstocks', venue: 'Bybit', endpoint: 'bybit', async discover() { throw new Error('offline'); } };
  const fallback = { id: 'gate-stock-tokens', venue: 'Gate', endpoint: 'gate', async discover() { return [{ ...market, price: 121, lastUpdated: 2_000 }]; } };
  const worker = new StockTokenWorker({ repository, adapters: [failed, fallback], logger: { warn() {} } });
  const result = await worker.poll(2_000);
  assert.deepEqual(result.map(item => item.status), ['error', 'ok']);
  assert.equal((await repository.list({ underlying: 'CRCL', now: 2_000 }))[0].price, 121);
  assert.equal((await repository.health({ now: 2_000 })).errors[0].provider, 'bybit-xstocks');
});

test('SQLite registry survives restart and the serverless API reads only persisted markets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-token-registry-'));
  const databasePath = path.join(directory, 'registry.sqlite');
  const market = createStockTokenMarket({ productType: 'xstocks', name: 'Circle xStock', venue: 'Bybit',
    exchangeSymbol: 'CRCLXUSDT', baseAsset: 'CRCLX', quoteAsset: 'USDT', price: 95.44,
    change24h: 3.97, volume24h: 1_757_792, lastUpdated: 2_000 });
  const writer = await SharedStockTokenRepository.create({ databasePath });
  await writer.replaceVenueMarkets('Bybit', [market], 2_000);
  await writer.saveProviderState('bybit-xstocks', { status: 'ok', discovered: 1, lastDiscoveryAt: 2_000,
    lastPriceUpdateAt: 2_000, updatedAt: 2_000 });
  await writer.close();
  const reader = await SharedStockTokenRepository.create({ databasePath, migrate: false, staleAfterMs: 10_000 });
  const handler = createStockTokenMarketsHandler({ databaseUrl: 'configured', repositoryFactory: async () => reader });
  const result = await handler.fetch(new Request('https://example.test/api/stock-tokens/markets?underlying=CRCL'));
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.data[0].exchangeSymbol, 'CRCLXUSDT');
  assert.equal(body.health.discovered, 1);
  await reader.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('scheduled refresh authenticates when configured, polls providers and closes the registry', async () => {
  let closed = false;
  const repository = new MemoryStockTokenRepository();
  repository.close = async () => { closed = true; };
  const handler = createStockTokenRefreshHandler({
    databaseUrl: 'configured', cronSecret: 'secret', repositoryFactory: async () => repository,
    workerFactory: value => ({ async poll() {
      assert.equal(value, repository);
      await value.saveProviderState('test-provider', { status: 'ok', discovered: 0, lastDiscoveryAt: 1, updatedAt: 1 });
      return [{ provider: 'test-provider', status: 'ok', discovered: 0 }];
    } })
  });
  const denied = await handler.fetch(new Request('https://example.test/api/stock-tokens/refresh'));
  assert.equal(denied.status, 401);
  const result = await handler.fetch(new Request('https://example.test/api/stock-tokens/refresh', {
    headers: { authorization: 'Bearer secret' }
  }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).providers[0].status, 'ok');
  assert.equal(closed, true);
});

test('stock-token work does not change canonical crypto identities', () => {
  for (const symbol of ['BTC', 'ZEC', 'UNI', 'XMR']) {
    const matches = globalThis.CryptoAIAssets.canonical.filter(asset => asset.symbol === symbol);
    assert.ok(matches.length > 0, `${symbol} remains registered`);
    assert.ok(matches.every(asset => asset.assetType !== 'stock_token' && asset.assetType !== 'etf_token'));
  }
  assert.equal(classifyStockToken({ name: 'PONS', marketType: 'spot', baseAsset: 'PONS' }), null);
});
