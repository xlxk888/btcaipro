import { getCache } from '@vercel/functions';

const PRIMARY_URL = 'https://mempool.space/api/blocks/tip/height';
const FALLBACK_URL = 'https://blockstream.info/api/blocks/tip/height';
const CACHE_KEY = 'last-good-height-v1';
const REFRESH_MS = 60_000;
const RETRY_MS = 30_000;
const LAST_GOOD_TTL_SECONDS = 24 * 60 * 60;

function validSnapshot(value, now) {
  return value && Number.isSafeInteger(value.height) && value.height > 0
    && ['mempool.space', 'Blockstream'].includes(value.source)
    && Number.isFinite(value.updatedAt) && value.updatedAt > 0
    && value.updatedAt <= now + 60_000;
}

export function createBitcoinNetworkService({
  cache,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 5_000
}) {
  let lastGood = null;
  let nextAttemptAt = 0;
  let inFlight = null;
  let lastStatus = 'unavailable';

  async function fetchHeight(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'text/plain' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = (await response.text()).trim();
      if (!/^\d+$/.test(raw)) throw new Error('Invalid block height');
      const height = Number(raw);
      if (!Number.isSafeInteger(height) || height <= 0) throw new Error('Invalid block height');
      return height;
    } finally {
      clearTimeout(timer);
    }
  }

  function payload(status) {
    return {
      height: lastGood?.height ?? null,
      source: lastGood?.source ?? null,
      updatedAt: lastGood?.updatedAt ?? null,
      stale: status === 'stale',
      status
    };
  }

  async function loadLastGood() {
    try {
      const saved = await cache.get(CACHE_KEY);
      if (validSnapshot(saved, now()) && (!lastGood || saved.updatedAt > lastGood.updatedAt)) {
        lastGood = saved;
      }
    } catch (_) { /* A warm function can still serve its last good value. */ }
  }

  async function refresh() {
    await loadLastGood();
    const currentTime = now();
    if (lastGood && currentTime - lastGood.updatedAt < REFRESH_MS) {
      lastStatus = lastGood.source === 'Blockstream' ? 'fallback' : 'ok';
      nextAttemptAt = lastGood.updatedAt + REFRESH_MS;
      return payload(lastStatus);
    }
    if (currentTime < nextAttemptAt) return payload(lastGood ? lastStatus : 'unavailable');

    let height;
    let source;
    try {
      height = await fetchHeight(PRIMARY_URL);
      source = 'mempool.space';
    } catch (_) {
      try {
        height = await fetchHeight(FALLBACK_URL);
        source = 'Blockstream';
      } catch (_) {
        lastStatus = lastGood ? 'stale' : 'unavailable';
        nextAttemptAt = now() + RETRY_MS;
        return payload(lastStatus);
      }
    }

    lastGood = { height, source, updatedAt: now() };
    lastStatus = source === 'Blockstream' ? 'fallback' : 'ok';
    nextAttemptAt = lastGood.updatedAt + REFRESH_MS;
    try {
      await cache.set(CACHE_KEY, lastGood, { ttl: LAST_GOOD_TTL_SECONDS });
    } catch (_) { /* Return the valid height even if the shared cache is unavailable. */ }
    return payload(lastStatus);
  }

  async function read() {
    if (!inFlight) {
      inFlight = refresh().finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  async function handle(request) {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });
    }
    const result = await read();
    const cacheControl = result.status === 'unavailable'
      ? 'public, max-age=0, s-maxage=30'
      : result.stale
        ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=120'
        : 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';
    return Response.json(result, { headers: { 'Cache-Control': cacheControl } });
  }

  return { read, handle };
}

let productionService;

export default {
  fetch(request) {
    if (!productionService) {
      productionService = createBitcoinNetworkService({ cache: getCache({ namespace: 'bitcoin-network' }) });
    }
    return productionService.handle(request);
  }
};
