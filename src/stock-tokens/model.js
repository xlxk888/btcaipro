const ETF_SYMBOLS = new Set([
  'ARKK', 'DIA', 'GLD', 'IWM', 'QQQ', 'SLV', 'SPY', 'TLT', 'USO', 'VTI', 'VOO'
]);

const ETF_NAME = /\b(ETF|FUND|TRUST|S&P\s*500|NASDAQ(?:\s*100)?|RUSSELL\s*2000|TREASURY|GOLD|SILVER|OIL)\b/i;
const STOCK_TOKEN_NAME = /\b(xStock|Ondo Tokenized|tokeni[sz]ed (?:stock|equity|ETF|fund|trust))\b/i;
const LEVERAGED_NAME = /(?:\b\d+x(?:Long|Short)\b|\b(?:Long|Short)\s+Token\b)/i;

export function normalizeUnderlyingSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/[.\s_-]/g, '');
}

export function inferUnderlyingSymbol({ baseAsset, underlyingTicker, issuer, name } = {}) {
  if (underlyingTicker) return normalizeUnderlyingSymbol(underlyingTicker);
  let symbol = normalizeUnderlyingSymbol(baseAsset);
  if (issuer === 'Ondo') symbol = symbol.replace(/ON$/, '');
  if (issuer === 'xStocks') symbol = symbol.replace(/X$/, '');
  // The naming convention is only used after authoritative exchange metadata
  // has classified the instrument as xStocks/Ondo, never as the detector.
  return symbol || normalizeUnderlyingSymbol(name?.split(/\s+/)[0]);
}

export function classifyStockToken(raw = {}) {
  const marketType = String(raw.marketType || raw.category || '').toLowerCase();
  const productType = String(raw.productType || raw.symbolType || raw.instrumentType || '').toLowerCase();
  const name = String(raw.name || raw.baseName || raw.fullName || '');
  if (['linear', 'inverse', 'perpetual', 'future', 'futures', 'cfd', 'prediction'].some(value => marketType.includes(value))) return null;
  if (/perpetual|future|cfd|prediction/.test(productType) || LEVERAGED_NAME.test(name)) return null;
  const issuer = productType === 'xstocks' || /\bxStock\b/i.test(name) ? 'xStocks'
    : /\bOndo Tokenized\b/i.test(name) ? 'Ondo' : raw.issuer || null;
  const explicitlyTokenized = productType === 'xstocks' || STOCK_TOKEN_NAME.test(name)
    || ['stock_token', 'etf_token', 'tokenized_equity'].includes(productType);
  if (!explicitlyTokenized) return null;
  const underlyingSymbol = inferUnderlyingSymbol({ ...raw, issuer, name });
  const assetType = raw.assetType === 'etf_token' || ETF_SYMBOLS.has(underlyingSymbol) || ETF_NAME.test(name)
    ? 'etf_token' : 'stock_token';
  return { issuer: issuer || 'unknown', underlyingSymbol, assetType };
}

export function createStockTokenMarket(raw, { now = Date.now(), staleAfterMs = 5 * 60_000 } = {}) {
  const classification = classifyStockToken(raw);
  if (!classification) return null;
  const updatedAt = Number(raw.lastUpdated || raw.updatedAt || now);
  const venue = String(raw.venue || raw.source || '').trim();
  const exchangeSymbol = String(raw.exchangeSymbol || '').trim();
  const baseAsset = String(raw.baseAsset || '').trim().toUpperCase();
  if (!venue || !exchangeSymbol || !baseAsset) throw new Error('Stock token market identity is incomplete');
  const canonicalId = [classification.issuer, baseAsset, venue, exchangeSymbol, raw.chainId ?? '', raw.contractAddress || '']
    .map(value => normalizeUnderlyingSymbol(value).toLowerCase()).join(':');
  const numberOrNull = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const price = numberOrNull(raw.price);
  const change24h = numberOrNull(raw.change24h);
  const volume24h = numberOrNull(raw.volume24h);
  return {
    canonicalId: `stock-token:${canonicalId}`,
    symbol: baseAsset,
    displaySymbol: raw.displaySymbol || baseAsset,
    underlyingSymbol: classification.underlyingSymbol,
    underlyingName: raw.underlyingName || String(raw.name || '').replace(/\s+(?:xStock|Ondo Tokenized).*$/i, '') || null,
    assetType: classification.assetType,
    issuer: classification.issuer,
    venue,
    exchangeSymbol,
    baseAsset,
    quoteAsset: String(raw.quoteAsset || '').toUpperCase(),
    chain: raw.chain || null,
    chainId: raw.chainId ?? null,
    contractAddress: raw.contractAddress || null,
    marketType: raw.marketType === 'tokenized_asset' ? 'tokenized_asset' : 'spot',
    price: Number.isFinite(price) && price > 0 ? price : null,
    change24h: Number.isFinite(change24h) ? change24h : null,
    volume24h: Number.isFinite(volume24h) && volume24h >= 0 ? volume24h : null,
    currency: String(raw.currency || raw.quoteAsset || 'USD').toUpperCase(),
    source: raw.source || venue,
    sourceType: raw.sourceType || 'exchange',
    underlyingReferencePrice: numberOrNull(raw.underlyingReferencePrice),
    bid: numberOrNull(raw.bid),
    ask: numberOrNull(raw.ask),
    multiplier: numberOrNull(raw.multiplier),
    marketStatus: raw.marketStatus || 'active',
    lastUpdated: updatedAt,
    lastTradeTime: raw.lastTradeTime ? Number(raw.lastTradeTime) : null,
    discoveredAt: Number(raw.discoveredAt || now),
    stale: now - updatedAt > staleAfterMs,
    verified: raw.verified !== false
  };
}
