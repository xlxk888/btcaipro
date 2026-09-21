import { getCache } from '@vercel/functions';
import { createNativeMarketService } from '../../src/market/native-asset.js';

let service;
export default {
  async fetch(request) {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    service ||= createNativeMarketService({ cache: getCache({ namespace: 'native-asset-market' }) });
    const data = await service.read(new URL(request.url).searchParams.get('assetId'));
    return Response.json(data, { status: data.status === 'unsupported' ? 400 : data.status === 'unavailable' ? 503 : 200,
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } });
  }
};
