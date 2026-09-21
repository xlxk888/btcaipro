const POSITIVE = value => Number.isFinite(Number(value)) && Number(value) > 0;
const MONERO = Object.freeze({ assetId: 'monero', symbol: 'XMR', name: 'Monero', network: 'Monero' });

export class MoneroNativeAssetAdapter {
  constructor({ fetchImpl = fetch, rpcUrls = (process.env.MONERO_RPC_URLS || '').split(',').map(s => s.trim()).filter(Boolean), timeoutMs = 5000 } = {}) {
    this.fetchImpl = fetchImpl; this.rpcUrls = rpcUrls; this.timeoutMs = timeoutMs;
  }
  async readNetwork() {
    for (const url of this.rpcUrls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(new URL('/get_info', url), { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!POSITIVE(data.height)) throw new Error('Invalid Monero height');
        const difficulty = Number(data.wide_difficulty || data.difficulty);
        const target = Number(data.target);
        return { assetId: MONERO.assetId, height: Number(data.height), difficulty: POSITIVE(difficulty) ? difficulty : null,
          targetBlockTime: POSITIVE(target) ? target : null, approximateHashrate: POSITIVE(difficulty) && POSITIVE(target) ? difficulty / target : null,
          txPoolSize: Number.isInteger(data.tx_pool_size) ? data.tx_pool_size : null, synchronized: Boolean(data.synchronized),
          source: new URL(url).host, updatedAt: Date.now(), status: 'ok' };
      } catch (_) { /* Try the next explicitly configured monerod node. */ }
      finally { clearTimeout(timer); }
    }
    return { assetId: MONERO.assetId, status: 'unavailable', height: null, source: null };
  }
}

export const MARKET_ROUTES = Object.freeze({
  monero: Object.freeze([
    { name: 'CoinGecko', id: 'monero', url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=monero' },
    { name: 'CoinPaprika', id: 'xmr-monero', url: 'https://api.coinpaprika.com/v1/tickers/xmr-monero?quotes=USD' },
    { name: 'CoinLore', id: '28', url: 'https://api.coinlore.net/api/ticker/?id=28' }
  ])
});

function validatedQuote(provider, json, now) {
  let value;
  if (provider.name === 'CoinGecko') {
    value = json?.find?.(coin => coin.id === provider.id && coin.symbol?.toUpperCase() === 'XMR' && coin.name === 'Monero');
    if (!value) throw new Error('Canonical CoinGecko identity mismatch');
    value = { price: value.current_price, change24h: value.price_change_percentage_24h, volume24h: value.total_volume,
      marketCap: value.market_cap, circulatingSupply: value.circulating_supply, dataTime: value.last_updated };
  } else if (provider.name === 'CoinPaprika') {
    if (json?.id !== provider.id || json.symbol !== 'XMR' || json.name !== 'Monero') throw new Error('Canonical CoinPaprika identity mismatch');
    value = { price: json.quotes?.USD?.price, change24h: json.quotes?.USD?.percent_change_24h,
      volume24h: json.quotes?.USD?.volume_24h, marketCap: json.quotes?.USD?.market_cap,
      circulatingSupply: json.circulating_supply, dataTime: json.last_updated };
  } else {
    const item = json?.[0];
    if (String(item?.id) !== provider.id || item.symbol !== 'XMR' || item.name !== 'Monero' || item.nameid !== 'monero') throw new Error('Canonical CoinLore identity mismatch');
    value = { price: item.price_usd, change24h: item.percent_change_24h, volume24h: item.volume24,
      marketCap: item.market_cap_usd, circulatingSupply: item.csupply, dataTime: null };
  }
  if (!POSITIVE(value.price) || !Number.isFinite(Number(value.change24h)) || !POSITIVE(value.volume24h)) throw new Error('Invalid market data');
  const cap = Number(value.marketCap), supply = Number(value.circulatingSupply), price = Number(value.price);
  // Verify the circulating market cap with the same provider's circulating supply and price.
  const marketCap = POSITIVE(cap) && (POSITIVE(supply) ? Math.abs(cap - supply * price) / cap < 0.05
    : provider.name === 'CoinPaprika') ? cap : null;
  return { ...MONERO, price, change24h: Number(value.change24h), volume24h: Number(value.volume24h), marketCap,
    marketCapSource: marketCap ? provider.name : null, source: provider.name,
    dataTime: value.dataTime || null, receivedAt: new Date(now).toISOString(),
    freshness: 'live', confidence: 'canonical-provider', fallbackSource: provider.name === 'CoinGecko' ? null : provider.name,
    updatedAt: now, stale: false, status: provider.name === 'CoinGecko' ? 'ok' : 'fallback' };
}

export function createNativeMarketService({ cache, fetchImpl = fetch, now = Date.now, timeoutMs = 4500,
  refreshMs = 60_000, lastGoodMs = 60 * 60_000 } = {}) {
  let lastGood, inFlight, retryAt = 0;
  const key = 'monero-market-v1';
  async function read(assetId = 'monero') {
    if (assetId !== MONERO.assetId) return { assetId, status: 'unsupported' };
    if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
    return inFlight;
  }
  async function refresh() {
    try {
      const saved = await cache?.get(key);
      if (saved?.assetId === MONERO.assetId && POSITIVE(saved.price) && saved.updatedAt <= now() && now() - saved.updatedAt < lastGoodMs && (!lastGood || saved.updatedAt > lastGood.updatedAt)) lastGood = saved;
    } catch (_) { /* Warm instance can still serve its cached value. */ }
    if (lastGood && now() - lastGood.updatedAt < refreshMs) return lastGood;
    if (now() < retryAt) return lastGood ? { ...lastGood, source: `${lastGood.source} · 缓存`, freshness: 'cached', stale: true, status: 'cached' } : { ...MONERO, status: 'unavailable' };
    for (const provider of MARKET_ROUTES.monero) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(provider.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = validatedQuote(provider, await response.json(), now());
        if (value.marketCap) {
          try { await cache?.set(`${key}:cap:${provider.name}`, { marketCap: value.marketCap, updatedAt: value.updatedAt }, { ttl: 600 }); } catch (_) {}
        } else {
          try {
            const prior = await cache?.get(`${key}:cap:${provider.name}`);
            if (POSITIVE(prior?.marketCap) && now() - prior.updatedAt <= 600_000) {
              value.marketCap = prior.marketCap;
              value.marketCapSource = provider.name;
            }
          } catch (_) {}
        }
        lastGood = value;
        try { await cache?.set(key, value, { ttl: Math.ceil(lastGoodMs / 1000) }); } catch (_) {}
        return value;
      } catch (_) { /* Validate identity and try next configured canonical provider. */ }
      finally { clearTimeout(timer); }
    }
    retryAt = now() + 30_000;
    return lastGood ? { ...lastGood, source: `${lastGood.source} · 缓存`, freshness: 'cached', stale: true, status: 'cached' }
      : { ...MONERO, price: null, marketCap: null, status: 'unavailable' };
  }
  return { read };
}
