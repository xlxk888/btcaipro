import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSourceHealthSummary } from './core/source-health.js';
import { SOURCE_DEFINITIONS } from './provenance/source-definitions.js';
import { MINER_CATALOG } from './miners/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const send = (response, status, payload, headers = {}) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  response.end(body);
};

export function createApp({ store, cache, worker, config, startedAt = Date.now() }) {
  return async function app(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const cors = config.corsOrigin ? { 'access-control-allow-origin': config.corsOrigin } : {};
    if (request.method === 'OPTIONS') { response.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, OPTIONS' }); return response.end(); }
    if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' }, cors);
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
    return send(response, 404, { error: 'not_found' }, cors);
  };
}
