import { createCryptoKlineService } from '../../src/market/crypto-klines.js';

export function createCryptoKlinesHandler(options = {}) {
  const service = options.service || createCryptoKlineService(options);
  return {
    async fetch(request) {
      if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      const url = new URL(request.url);
      const type = url.searchParams.get('type') === 'dex' ? 'dex' : 'cex';
      const input = type === 'dex'
        ? {
            type,
            chain: String(url.searchParams.get('chain') || '').trim(),
            contract: String(url.searchParams.get('contract') || '').trim(),
            pool: String(url.searchParams.get('pool') || '').trim()
          }
        : {
            type,
            canonicalAssetId: String(url.searchParams.get('assetId') || '').trim(),
            pair: String(url.searchParams.get('pair') || '').trim()
          };
      const invalid = type === 'dex' ? !input.chain || !input.contract : !input.canonicalAssetId || !input.pair;
      if (invalid) return Response.json({ error: 'invalid_kline_identity', candles: [] }, { status: 400 });
      const result = await service.resolve(input);
      return Response.json(result, {
        status: result.status === 'ok' ? 200 : 503,
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=300' }
      });
    }
  };
}

export default createCryptoKlinesHandler();
