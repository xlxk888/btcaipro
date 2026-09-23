import { createStockTokenMarket } from './model.js';

class StockTokenAdapter {
  constructor({ id, venue, fetchImpl = fetch, timeoutMs = 8_000, retries = 2, logger } = {}) {
    this.id = id; this.venue = venue; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.retries = retries; this.logger = logger;
    this.endpoint = null;
  }

  async json(url, options = {}) {
    this.endpoint = url;
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { signal: controller.signal,
          headers: { accept: 'application/json', 'user-agent': 'CryptoAI/3.0', ...(options.headers || {}) } });
        if (!response.ok) throw new Error(`${this.id} HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
      } finally { clearTimeout(timer); }
    }
    throw lastError;
  }
}

export class BybitStockTokenAdapter extends StockTokenAdapter {
  constructor(options = {}) { super({ id: 'bybit-xstocks', venue: 'Bybit', ...options }); }
  async discover(now = Date.now()) {
    const instrumentsUrl = 'https://api.bybit.com/v5/market/instruments-info?category=spot&symbolType=xstocks';
    const tickersUrl = 'https://api.bybit.com/v5/market/tickers?category=spot';
    const [instruments, tickers] = await Promise.all([this.json(instrumentsUrl), this.json(tickersUrl)]);
    if (instruments.retCode !== 0 || tickers.retCode !== 0) throw new Error('Bybit API rejected stock-token discovery');
    const quoteBySymbol = new Map((tickers.result?.list || []).map(item => [item.symbol, item]));
    return (instruments.result?.list || []).map(item => {
      const quote = quoteBySymbol.get(item.symbol) || {};
      return createStockTokenMarket({
        productType: item.symbolType, name: item.fullName || `${item.baseCoin} xStock`,
        underlyingTicker: item.underlyingTicker, venue: this.venue, exchangeSymbol: item.symbol,
        baseAsset: item.baseCoin, quoteAsset: item.quoteCoin, marketStatus: item.status === 'Trading' ? 'active' : 'inactive',
        price: quote.lastPrice, change24h: quote.price24hPcnt === '' ? null : Number(quote.price24hPcnt) * 100,
        volume24h: quote.turnover24h, source: this.venue, lastUpdated: tickers.time || now,
        lastTradeTime: null, verified: item.symbolType === 'xstocks'
      }, { now });
    }).filter(Boolean);
  }
}

export class GateStockTokenAdapter extends StockTokenAdapter {
  constructor(options = {}) { super({ id: 'gate-stock-tokens', venue: 'Gate', ...options }); }
  async discover(now = Date.now()) {
    const pairsUrl = 'https://api.gateio.ws/api/v4/spot/currency_pairs';
    const tickersUrl = 'https://api.gateio.ws/api/v4/spot/tickers';
    const [pairs, tickers] = await Promise.all([this.json(pairsUrl), this.json(tickersUrl)]);
    const quoteBySymbol = new Map(tickers.map(item => [item.currency_pair, item]));
    return pairs.map(item => {
      const quote = quoteBySymbol.get(item.id) || {};
      return createStockTokenMarket({
        marketType: item.type, name: item.base_name, venue: this.venue, exchangeSymbol: item.id,
        baseAsset: item.base, quoteAsset: item.quote, marketStatus: item.trade_status === 'tradable' ? 'active' : 'inactive',
        price: quote.last, change24h: quote.change_percentage, volume24h: quote.quote_volume,
        source: this.venue, lastUpdated: now, lastTradeTime: null,
        verified: /\b(xStock|Ondo Tokenized)\b/i.test(item.base_name || '')
      }, { now });
    }).filter(Boolean);
  }
}

export class OkxStockTokenAdapter extends StockTokenAdapter {
  constructor(options = {}) { super({ id: 'okx-stock-tokens', venue: 'OKX', ...options }); }
  async discover(now = Date.now()) {
    const instruments = await this.json('https://www.okx.com/api/v5/public/instruments?instType=SPOT');
    // OKX only becomes discoverable when its official response marks an
    // instrument as a stock. No ticker suffix is accepted as proof.
    return (instruments.data || []).map(item => createStockTokenMarket({
      productType: item.stk ? 'tokenized_equity' : '', name: item.stk || '', venue: this.venue,
      exchangeSymbol: item.instId, baseAsset: item.baseCcy, quoteAsset: item.quoteCcy,
      marketStatus: item.state === 'live' ? 'active' : 'inactive', lastUpdated: now, source: this.venue
    }, { now })).filter(Boolean);
  }
}

export class KrakenStockTokenAdapter extends StockTokenAdapter {
  constructor(options = {}) { super({ id: 'kraken-stock-tokens', venue: 'Kraken', ...options }); }
  async discover(now = Date.now()) {
    const response = await this.json('https://api.kraken.com/0/public/AssetPairs');
    if (response.error?.length) throw new Error(`Kraken ${response.error.join(', ')}`);
    // Current AssetPairs has no stock-token product field in some regions.
    // Consume only future/region-specific explicit metadata; never infer from X.
    return Object.values(response.result || {}).map(item => createStockTokenMarket({
      productType: item.asset_class || item.product_type || '', name: item.description || '',
      venue: this.venue, exchangeSymbol: item.altname, baseAsset: item.base, quoteAsset: item.quote,
      marketStatus: item.status === 'online' ? 'active' : 'inactive', lastUpdated: now, source: this.venue
    }, { now })).filter(Boolean);
  }
}

export class RobinhoodStockTokenAdapter extends StockTokenAdapter {
  constructor(options = {}) { super({ id: 'robinhood-stock-tokens', venue: 'Robinhood Chain', ...options }); }
  async discover(now = Date.now()) {
    const assetsUrl = 'https://api.robinhood.com/rhj/assets';
    const pricesUrl = 'https://api.robinhood.com/rhj/prices';
    const [assets, prices] = await Promise.all([this.json(assetsUrl), this.json(pricesUrl)]);
    const quoteBySymbol = new Map((prices.quotes || []).map(item => [item.tokenSymbol, item]));
    return (assets.assets || []).flatMap(asset => {
      const quote = quoteBySymbol.get(asset.tokenSymbol) || {};
      const bid = Number(quote.bid), ask = Number(quote.ask), multiplier = Number(asset.currentMultiplier);
      const reference = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
      const tokenPrice = reference && multiplier > 0 ? reference * multiplier : null;
      const lastUpdated = Date.parse(quote.generatedAt) || now;
      return (asset.deployments || []).map(deployment => createStockTokenMarket({
        productType: 'stock_token', issuer: 'Robinhood Assets (Jersey)',
        assetType: /\b(ETF|fund|trust)\b/i.test(asset.tokenName || '') ? 'etf_token' : undefined,
        name: asset.tokenName, underlyingName: String(asset.tokenName || '').replace(/\s*[•-]\s*Robinhood Token$/i, ''),
        underlyingTicker: asset.tokenSymbol, venue: this.venue, exchangeSymbol: asset.tokenSymbol,
        baseAsset: asset.tokenSymbol, quoteAsset: quote.currency || 'USD', chain: deployment.networkName || 'Robinhood Chain',
        chainId: deployment.chainId, contractAddress: deployment.contractAddress, marketType: 'tokenized_asset',
        marketStatus: asset.status === 'ASSET_STATUS_ACTIVE' && !quote.isTradingHalt ? 'active' : 'inactive',
        price: tokenPrice, change24h: null, volume24h: null, underlyingReferencePrice: reference,
        bid, ask, multiplier, currency: quote.currency || 'USD', source: 'Robinhood', sourceType: 'issuer_reference',
        lastUpdated, lastTradeTime: null, verified: Boolean(deployment.contractAddress && deployment.chainId)
      }, { now })).filter(Boolean);
    });
  }
}

export class BinanceStockTokenAdapter extends StockTokenAdapter {
  constructor({ apiKey = process.env.BINANCE_API_KEY, ...options } = {}) {
    super({ id: 'binance-bstocks', venue: 'Binance', ...options }); this.apiKey = apiKey;
  }
  async discover(now = Date.now()) {
    if (!this.apiKey) throw new Error('BINANCE_API_KEY is required for official bStocks metadata');
    const assetsUrl = 'https://api.binance.com/sapi/v1/equity/market/tokenized-assets';
    const tickersUrl = 'https://api.binance.com/api/v3/ticker/24hr';
    const [assets, tickers] = await Promise.all([
      this.json(assetsUrl, { headers: { 'X-MBX-APIKEY': this.apiKey } }), this.json(tickersUrl)
    ]);
    const quoteBySymbol = new Map(tickers.map(item => [item.symbol, item]));
    return assets.map(asset => {
      const exchangeSymbol = `${asset.assetCode}USDT`;
      const quote = quoteBySymbol.get(exchangeSymbol) || {};
      return createStockTokenMarket({
        productType: 'stock_token', name: asset.assetName, underlyingTicker: asset.underlyingEquitySymbol,
        venue: this.venue, exchangeSymbol, baseAsset: asset.assetCode, quoteAsset: 'USDT', chain: 'BNB Smart Chain',
        marketStatus: quote.lastPrice ? 'active' : 'inactive', price: quote.lastPrice,
        change24h: quote.priceChangePercent, volume24h: quote.quoteVolume, multiplier: asset.multiplier,
        source: this.venue, lastUpdated: quote.closeTime || now, lastTradeTime: null,
        verified: asset.multiplierValid === true
      }, { now });
    }).filter(Boolean);
  }
}

export function createStockTokenAdapters(options = {}) {
  return [new BybitStockTokenAdapter(options), new GateStockTokenAdapter(options),
    new RobinhoodStockTokenAdapter(options), new OkxStockTokenAdapter(options), new KrakenStockTokenAdapter(options),
    ...(process.env.BINANCE_API_KEY ? [new BinanceStockTokenAdapter(options)] : [])];
}
