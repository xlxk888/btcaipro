import { MoneroNativeAssetAdapter } from '../../src/market/native-asset.js';

const adapter = new MoneroNativeAssetAdapter();
export default {
  async fetch(request) {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const result = await adapter.readNetwork();
    return Response.json(result, { status: result.status === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' } });
  }
};
