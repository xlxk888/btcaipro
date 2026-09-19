export const SOURCE_TYPES = Object.freeze([
  'official', 'exchange', 'market-data', 'government', 'local-calculation', 'estimate', 'disclosure'
]);

export const SOURCE_DEFINITIONS = Object.freeze([
  { sourceId: 'binance_spot_ws', sourceName: 'Binance Spot WebSocket', sourceType: 'exchange', group: 'spot', role: 'primary', enabled: true, freshnessMs: 45_000, sourceUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams' },
  { sourceId: 'binance_spot_rest', sourceName: 'Binance Spot REST', sourceType: 'exchange', group: 'spot', role: 'primary', enabled: true, freshnessMs: 120_000, sourceUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints' },
  { sourceId: 'okx_spot', sourceName: 'OKX Spot', sourceType: 'exchange', group: 'spot', role: 'fallback', enabled: true, freshnessMs: 120_000, sourceUrl: 'https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-ticker' },
  { sourceId: 'coingecko_spot', sourceName: 'CoinGecko', sourceType: 'market-data', group: 'spot', role: 'fallback', enabled: true, freshnessMs: 300_000, sourceUrl: 'https://docs.coingecko.com/reference/simple-price' },
  { sourceId: 'binance_derivatives', sourceName: 'Binance Futures', sourceType: 'exchange', group: 'derivatives', role: 'primary', enabled: true, freshnessMs: 180_000, sourceUrl: 'https://developers.binance.com/docs/derivatives' },
  { sourceId: 'fear_greed', sourceName: 'Alternative.me Fear & Greed', sourceType: 'market-data', group: 'sentiment', role: 'primary', enabled: true, freshnessMs: 36 * 60 * 60_000, sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/' },
  { sourceId: 'ahr999_local', sourceName: 'Crypto AI AHR999', sourceType: 'local-calculation', group: 'valuation', role: 'primary', enabled: true, freshnessMs: 36 * 60 * 60_000, sourceUrl: '/sources#ahr999', calculationMethod: 'ahr999_geom200_power_fit_v1' },
  { sourceId: 'mempool_network', sourceName: 'mempool.space', sourceType: 'market-data', group: 'bitcoin-network', role: 'primary', enabled: true, freshnessMs: 60 * 60_000, sourceUrl: 'https://mempool.space/docs/api' },
  { sourceId: 'miner_catalog', sourceName: 'Crypto AI Miner Catalog', sourceType: 'official', group: 'miner', role: 'primary', enabled: true, freshnessMs: 365 * 24 * 60 * 60_000, sourceUrl: '/api/miners/catalog' },
  { sourceId: 'liquidations', sourceName: 'Liquidations', sourceType: 'market-data', group: 'liquidations', role: 'primary', enabled: false, freshnessMs: 0, sourceUrl: null }
]);

export const sourceDefinition = id => SOURCE_DEFINITIONS.find(source => source.sourceId === id) || null;

export function createProvenance(input = {}) {
  const definition = sourceDefinition(input.sourceId) || {};
  return {
    sourceId: input.sourceId || definition.sourceId || 'unknown',
    sourceName: input.sourceName || definition.sourceName || input.source || 'Unknown',
    sourceType: input.sourceType || definition.sourceType || 'market-data',
    sourceUrl: input.sourceUrl ?? definition.sourceUrl ?? null,
    dataTime: input.dataTime || null,
    receivedAt: input.receivedAt || null,
    updatedAt: input.updatedAt || input.receivedAt || null,
    freshness: input.freshness || null,
    confidence: input.confidence || null,
    calculationMethod: input.calculationMethod || definition.calculationMethod || null,
    fallbackSource: input.fallbackSource || null
  };
}

export function validateProvenance(value) {
  if (!value || typeof value !== 'object') return false;
  return Boolean(value.sourceId && value.sourceName && SOURCE_TYPES.includes(value.sourceType));
}
