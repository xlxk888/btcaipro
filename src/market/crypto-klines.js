const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CANDLES = 24;

const DEX_NETWORKS = Object.freeze({
  ethereum: { dexscreener: 'ethereum', gecko: 'eth' },
  bsc: { dexscreener: 'bsc', gecko: 'bsc' },
  arbitrum: { dexscreener: 'arbitrum', gecko: 'arbitrum' },
  base: { dexscreener: 'base', gecko: 'base' },
  polygon: { dexscreener: 'polygon', gecko: 'polygon_pos' },
  avalanche: { dexscreener: 'avalanche', gecko: 'avax' },
  robinhood: { dexscreener: 'robinhood', gecko: 'robinhood' },
  hyperliquid: { dexscreener: 'hyperevm', gecko: 'hyperevm' },
  solana: { dexscreener: 'solana', gecko: 'solana' }
});

const MARKET_PLANS = Object.freeze({
  hyperliquid: [
    { provider: 'hyperliquid', coin: 'HYPE', market: 'HYPE Perpetual' },
    { provider: 'okx', instrument: 'HYPE-USDT', market: 'HYPE/USDT' }
  ],
  monero: [{ provider: 'kraken', pair: 'XMRUSD', market: 'XMR/USD' }]
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCandle({ timestamp, open, high, low, close, volume }) {
  const candle = {
    timestamp: finite(timestamp),
    open: finite(open),
    high: finite(high),
    low: finite(low),
    close: finite(close),
    volume: finite(volume)
  };
  return candle.timestamp > 0 && candle.open > 0 && candle.high > 0
    && candle.low > 0 && candle.close > 0 && candle.volume >= 0 ? candle : null;
}

function normalized(list) {
  return list.map(normalizeCandle).filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_CANDLES);
}

async function fetchJson(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(options.headers || {}) }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readBinance(fetchImpl, plan) {
  const pair = String(plan.pair || '').toUpperCase();
  if (!/^[A-Z0-9]{5,24}$/.test(pair)) throw new Error('invalid_pair');
  const url = 'https://data-api.binance.vision/api/v3/klines?symbol=' + encodeURIComponent(pair) + '&interval=1h&limit=24';
  const payload = await fetchJson(fetchImpl, url);
  return normalized((Array.isArray(payload) ? payload : []).map(row => ({
    timestamp: row?.[0], open: row?.[1], high: row?.[2], low: row?.[3], close: row?.[4], volume: row?.[5]
  })));
}

async function readOkx(fetchImpl, plan) {
  const instrument = String(plan.instrument || '').toUpperCase();
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(instrument)) throw new Error('invalid_instrument');
  const url = 'https://www.okx.com/api/v5/market/candles?instId=' + encodeURIComponent(instrument) + '&bar=1H&limit=24';
  const payload = await fetchJson(fetchImpl, url);
  if (payload?.code && payload.code !== '0') throw new Error('OKX ' + payload.code);
  return normalized((Array.isArray(payload?.data) ? payload.data : []).map(row => ({
    timestamp: row?.[0], open: row?.[1], high: row?.[2], low: row?.[3], close: row?.[4], volume: row?.[5]
  })));
}

async function readHyperliquid(fetchImpl, plan, now) {
  const endTime = now();
  const payload = await fetchJson(fetchImpl, 'https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin: plan.coin, interval: '1h', startTime: endTime - 26 * 60 * 60 * 1000, endTime }
    })
  });
  return normalized((Array.isArray(payload) ? payload : []).map(row => ({
    timestamp: row?.t, open: row?.o, high: row?.h, low: row?.l, close: row?.c, volume: row?.v
  })));
}

async function readKraken(fetchImpl, plan) {
  const pair = String(plan.pair || '').toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(pair)) throw new Error('invalid_pair');
  const url = 'https://api.kraken.com/0/public/OHLC?pair=' + encodeURIComponent(pair) + '&interval=60';
  const payload = await fetchJson(fetchImpl, url);
  if (Array.isArray(payload?.error) && payload.error.length) throw new Error(payload.error.join(','));
  const key = Object.keys(payload?.result || {}).find(item => item !== 'last');
  const rows = key ? payload.result[key] : [];
  return normalized((Array.isArray(rows) ? rows : []).map(row => ({
    timestamp: Number(row?.[0]) * 1000,
    open: row?.[1], high: row?.[2], low: row?.[3], close: row?.[4], volume: row?.[6]
  })));
}

function sameAddress(left, right) {
  if (!left || !right) return false;
  const a = String(left);
  const b = String(right);
  return a.startsWith('0x') || b.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function resolveDexPool(fetchImpl, { chain, contract, pool }) {
  const network = DEX_NETWORKS[chain];
  if (!network || !contract) throw new Error('no_supported_ohlcv_provider');
  if (pool) return { pool, network };
  const url = 'https://api.dexscreener.com/tokens/v1/' + encodeURIComponent(network.dexscreener) + '/' + encodeURIComponent(contract);
  const payload = await fetchJson(fetchImpl, url);
  const pair = (Array.isArray(payload) ? payload : [])
    .filter(item => item?.chainId === network.dexscreener
      && sameAddress(item?.baseToken?.address, contract) && item?.pairAddress)
    .sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
  if (!pair) throw new Error('no_matching_dex_pool');
  return { pool: pair.pairAddress, network };
}

async function readGeckoTerminal(fetchImpl, input) {
  const { pool, network } = await resolveDexPool(fetchImpl, input);
  const url = new URL('https://api.geckoterminal.com/api/v2/networks/' + encodeURIComponent(network.gecko) + '/pools/' + encodeURIComponent(pool) + '/ohlcv/hour');
  url.searchParams.set('aggregate', '1');
  url.searchParams.set('limit', '24');
  url.searchParams.set('currency', 'usd');
  url.searchParams.set('token', 'base');
  const payload = await fetchJson(fetchImpl, url, {
    headers: { accept: 'application/json;version=20230203' }
  });
  if (!sameAddress(payload?.meta?.base?.address, input.contract)) throw new Error('ohlcv_pool_identity_mismatch');
  const candles = normalized((payload?.data?.attributes?.ohlcv_list || []).map(row => ({
    timestamp: Number(row?.[0]) * 1000,
    open: row?.[1], high: row?.[2], low: row?.[3], close: row?.[4], volume: row?.[5]
  })));
  return { candles, pool, network: network.gecko };
}

export function createCryptoKlineService({ fetchImpl = fetch, now = Date.now, ttlMs = CACHE_TTL_MS } = {}) {
  const cache = new Map();

  async function resolve(input = {}) {
    const type = input.type === 'dex' ? 'dex' : 'cex';
    const identity = type === 'dex'
      ? [input.chain || '', input.contract || '', input.pool || ''].join(':')
      : [input.canonicalAssetId || '', input.pair || ''].join(':');
    const cacheKey = (type + ':' + identity).toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.cachedAt < ttlMs) return { ...cached.value, cached: true };

    let value;
    if (type === 'dex') {
      try {
        const result = await readGeckoTerminal(fetchImpl, input);
        if (result.candles.length < 2) throw new Error('insufficient_ohlcv_candles');
        value = {
          status: 'ok', source: 'GeckoTerminal Pool OHLCV', market: input.chain + ':' + result.pool,
          pool: result.pool, candles: result.candles, lastTimestamp: result.candles.at(-1).timestamp
        };
      } catch (error) {
        value = { status: 'unavailable', reason: error?.message || 'no_supported_ohlcv_provider', candles: [] };
      }
    } else {
      const canonicalAssetId = String(input.canonicalAssetId || '');
      const pair = String(input.pair || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const base = pair.endsWith('USDT') ? pair.slice(0, -4) : '';
      const plans = MARKET_PLANS[canonicalAssetId] || [
        { provider: 'binance', pair, market: pair },
        ...(base ? [{ provider: 'okx', instrument: base + '-USDT', market: base + '/USDT' }] : [])
      ];
      const attempts = [];
      for (const plan of plans) {
        try {
          const candles = plan.provider === 'binance' ? await readBinance(fetchImpl, plan)
            : plan.provider === 'okx' ? await readOkx(fetchImpl, plan)
              : plan.provider === 'hyperliquid' ? await readHyperliquid(fetchImpl, plan, now)
                : plan.provider === 'kraken' ? await readKraken(fetchImpl, plan) : [];
          if (candles.length < 2) throw new Error('insufficient_ohlcv_candles');
          const source = plan.provider === 'binance' ? 'Binance Spot Klines'
            : plan.provider === 'okx' ? 'OKX Market Candles'
              : plan.provider === 'hyperliquid' ? 'Hyperliquid Candle Snapshot'
                : 'Kraken Spot OHLC';
          value = {
            status: 'ok', source, market: plan.market, candles,
            lastTimestamp: candles.at(-1).timestamp, attempts
          };
          break;
        } catch (error) {
          attempts.push({ provider: plan.provider, error: error?.message || 'unavailable' });
        }
      }
      value ||= { status: 'unavailable', reason: 'all_kline_providers_failed', attempts, candles: [] };
    }

    cache.set(cacheKey, { cachedAt: now(), value });
    return value;
  }

  return { resolve };
}

export { normalizeCandle, DEX_NETWORKS, MARKET_PLANS };
