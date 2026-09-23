import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSourceHealthSummary } from './core/source-health.js';
import { SOURCE_DEFINITIONS } from './provenance/source-definitions.js';
import { MINER_CATALOG } from './miners/catalog.js';
import { createStockTokenKlinesHandler } from '../api/stock-tokens/klines.js';
import { createCryptoKlinesHandler } from '../api/crypto/klines.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stockTokenKlines = createStockTokenKlinesHandler();
const cryptoKlines = createCryptoKlinesHandler();
const send = (response, status, payload, headers = {}) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  response.end(body);
};

export function createApp({ store, cache, worker, discovery, nativeMarket, moneroNetwork, stockTokens, config, startedAt = Date.now() }) {
  return async function app(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const cors = config.corsOrigin ? { 'access-control-allow-origin': config.corsOrigin } : {};
    if (request.method === 'OPTIONS') { response.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, OPTIONS' }); return response.end(); }
    if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' }, cors);
    if (url.pathname === '/api/assets/search') {
      const result = await discovery.search.search(url.searchParams.get('q'), url.searchParams.get('chain') || 'auto');
      return send(response, result.status === 'invalid-query' || result.status === 'invalid-chain' ? 400 : 200, result,
        { ...cors, 'cache-control': 'public, max-age=0, s-maxage=60' });
    }
    if (url.pathname === '/api/assets/discovery-health') {
      try {
        const health = await discovery.repository.health();
        let stockTokenHealth = null;
        try { stockTokenHealth = stockTokens?.repository ? await stockTokens.repository.health() : null; }
        catch (_) { stockTokenHealth = { discovered: 0, active: 0, withPrice: 0, stale: 0,
          errors: [{ provider: 'registry', error: 'unavailable', timestamp: Date.now() }],
          lastDiscoveryAt: null, lastPriceUpdateAt: null }; }
        return send(response, 200, { ...health, stockTokens: stockTokenHealth }, { ...cors, 'cache-control': 'no-store' });
      }
      catch (_) { return send(response, 200, { database: 'disconnected', workerRunning: false, status: 'degraded' }, { ...cors, 'cache-control': 'no-store' }); }
    }
    if (url.pathname === '/api/stock-tokens/markets') {
      if (!stockTokens?.repository) return send(response, 503, { error: 'stock_token_registry_unavailable' }, cors);
      const markets = await stockTokens.repository.list({ underlying: url.searchParams.get('underlying') || undefined,
        venue: url.searchParams.get('venue') || undefined });
      return send(response, 200, { data: markets, count: markets.length, health: await stockTokens.repository.health() },
        { ...cors, 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=120' });
    }
    if (url.pathname === '/api/stock-tokens/klines') {
      const result = await stockTokenKlines.fetch(new Request(`http://localhost${url.pathname}${url.search}`));
      return send(response, result.status, await result.json(), { ...cors, 'cache-control': result.headers.get('cache-control') || 'no-store' });
    }
    if (url.pathname === '/api/crypto/klines') {
      const result = await cryptoKlines.fetch(new Request('http://localhost' + url.pathname + url.search));
      return send(response, result.status, await result.json(), { ...cors, 'cache-control': result.headers.get('cache-control') || 'no-store' });
    }
    if (url.pathname === '/api/assets/market') {
      const result = await nativeMarket.read(url.searchParams.get('assetId'));
      return send(response, result.status === 'unsupported' ? 400 : result.status === 'unavailable' ? 503 : 200, result,
        { ...cors, 'cache-control': 'public, max-age=0, s-maxage=60' });
    }
    if (url.pathname === '/api/monero/network') {
      const result = await moneroNetwork.readNetwork();
      return send(response, result.status === 'ok' ? 200 : 503, result, cors);
    }
    if (url.pathname === '/api/health') return send(response, 200, { status: 'ok', service: 'crypto-ai-market', now: new Date().toISOString(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), worker: worker?.status() || { started: false }, cache: cache.status(), database: { state: 'healthy', backend: store.constructor.name } }, cors);
    if (url.pathname === '/api/market/snapshot') {
      let snapshot = null; const cached = await cache.get('market:snapshot:latest');
      try { snapshot = cached ? JSON.parse(cached) : null; } catch {}
      snapshot ||= await store.latestSnapshot();
      return send(response, snapshot ? 200 : 503, snapshot ? { data: snapshot } : { error: 'snapshot_unavailable' }, cors);
    }
    if (url.pathname === '/api/market/quotes') {
      const snapshot = await store.latestSnapshot();
      if (!snapshot) return send(response, 503, { error: 'snapshot_unavailable' }, cors);
      const requested = (url.searchParams.get('symbols') || '').toUpperCase().split(',').filter(Boolean);
      const assets = Object.fromEntries(Object.entries(snapshot.assets).filter(([symbol]) => !requested.length || requested.includes(symbol)));
      return send(response, 200, { data: { createdAt: snapshot.createdAt, assets } }, cors);
    }
    if (url.pathname === '/api/events' || url.pathname === '/api/events/latest') {
      const latest = url.pathname.endsWith('/latest');
      const events = await store.listEvents({ limit: latest ? 1 : (Number(url.searchParams.get('limit')) || 50), asset: url.searchParams.get('asset')?.toUpperCase(), type: url.searchParams.get('type') });
      return send(response, 200, latest ? { data: events[0] || null } : { data: events, count: events.length }, cors);
    }
    if (url.pathname === '/api/sources/status') {
      const statuses = await store.listSourceStatuses();
      return send(response, 200, { data: statuses, summary: getSourceHealthSummary(statuses), cache: cache.status() }, cors);
    }
    if (url.pathname === '/api/sources/definitions') return send(response, 200, { data: SOURCE_DEFINITIONS }, cors);
    if (url.pathname === '/api/miners/catalog') return send(response, 200, { data: MINER_CATALOG, provenance: { sourceId: 'miner_catalog', sourceName: 'Crypto AI Miner Catalog', sourceType: 'official', calculationMethod: null } }, cors);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = fs.readFileSync(path.join(root, 'index.html'));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length }); return response.end(body);
    }
    if (url.pathname === '/sources' || url.pathname === '/sources.html') {
      const body = fs.readFileSync(path.join(root, 'sources.html'));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length }); return response.end(body);
    }
    if (url.pathname === '/asset-registry.js') {
      const body = fs.readFileSync(path.join(root, 'asset-registry.js'));
      response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'content-length': body.length }); return response.end(body);
    }
    if (url.pathname === '/stock-token-search.js') {
      const body = fs.readFileSync(path.join(root, 'stock-token-search.js'));
      response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'content-length': body.length }); return response.end(body);
    }
    if (url.pathname === '/market-radar.js') {
      const body = fs.readFileSync(path.join(root, 'market-radar.js'));
      response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'content-length': body.length }); return response.end(body);
    }
    return send(response, 404, { error: 'not_found' }, cors);
  };
}
