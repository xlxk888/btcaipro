import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const registrySource = fs.readFileSync(new URL('asset-registry.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const inlineScript = html.split('<script>')[1].split('</script>')[0];
let options;
const context = vm.createContext({
  Vue: function Vue(config) { options = config; },
  TextDecoder, Uint8Array, BigInt, Map, Object, Number, Array, String
});
vm.runInContext(registrySource, context);
vm.runInContext(inlineScript, context);

function fixture(saved = new Map()) {
  context.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  };
  return {
    ...options.data,
    ...options.methods,
    dataSources: JSON.parse(JSON.stringify(options.data.dataSources)),
    halvingCurrentHeight: null,
    halvingDaysRemaining: null,
    halvingHeightUpdatedAt: null
  };
}

const networkResponse = (height, status = 'ok', updatedAt = Date.now()) => ({
  ok: true,
  json: async () => ({ height, source: status === 'fallback' ? 'Blockstream' : 'mempool.space', updatedAt, stale: status === 'stale', status })
});

test('halving height reads the server endpoint and saves the last good height', async () => {
  const saved = new Map();
  const app = fixture(saved);
  const requested = [];
  app.fetchWithSoftTimeout = async url => {
    requested.push(url);
    return networkResponse(968000);
  };
  await app.fetchHalvingCountdown();
  assert.deepEqual(requested, ['/api/bitcoin/network']);
  assert.equal(app.halvingCurrentHeight, 968000);
  assert.equal(app.halvingDaysRemaining, 570);
  assert.match(app.halvingEtaText, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(app.dataSources.mempool.status, '轮询');
  assert.equal(JSON.parse(saved.get(app.halvingHeightStorageKey)).height, 968000);
});

test('halving height shows the server fallback without a red source error', async () => {
  const app = fixture();
  app.fetchWithSoftTimeout = async () => networkResponse(968001, 'fallback');
  await app.fetchHalvingCountdown();
  assert.equal(app.halvingCurrentHeight, 968001);
  assert.equal(app.dataSources.mempool.status, '备用');
  assert.equal(app.sourceBadge(app.dataSources.mempool), 'warn');
  assert.match(app.halvingDataStatus, /Blockstream 备用/);
  app.dataSourceList = [{ key: 'mempool', label: '备用', badge: 'warn', relevant: true, countsForHealth: true }];
  assert.equal(options.computed.sourceHealthText.call(app), '备用数据源运行中');
});

test('halving height displays server stale data without losing countdown values', async () => {
  const app = fixture();
  app.fetchWithSoftTimeout = async () => networkResponse(968002, 'stale', Date.now() - 3600000);
  await app.fetchHalvingCountdown();
  assert.equal(app.halvingCurrentHeight, 968002);
  assert.equal(app.dataSources.mempool.status, '旧数据');
  assert.equal(app.sourceBadge(app.dataSources.mempool), 'warn');
  assert.match(app.halvingDataStatus, /旧数据/);
  assert.match(app.halvingEtaText, /^\d{4}-\d{2}-\d{2}$/);
  app.dataSourceList = [{ key: 'mempool', label: '旧数据', badge: 'warn', relevant: true, countsForHealth: true }];
  assert.equal(options.computed.sourceHealthText.call(app), '部分数据延迟');
});

test('halving height displays a saved value while live requests are pending', async () => {
  const saved = new Map([['crypto_ai_halving_height_v1', JSON.stringify({ height: 968003, updatedAt: Date.now() - 60000 })]]);
  const app = fixture(saved);
  let resolveRequest;
  app.fetchWithSoftTimeout = () => new Promise(resolve => { resolveRequest = resolve; });
  const pending = app.fetchHalvingCountdown();
  assert.equal(app.halvingCurrentHeight, 968003);
  assert.match(app.halvingDataStatus, /旧数据 · 正在刷新/);
  resolveRequest(networkResponse(968004));
  await pending;
  assert.equal(app.halvingCurrentHeight, 968004);
  assert.equal(app.dataSources.mempool.status, '轮询');
});

test('halving height shows unavailable only without any valid provider or cached height', async () => {
  const app = fixture();
  app.fetchWithSoftTimeout = async () => networkResponse(null, 'unavailable');
  await app.fetchHalvingCountdown();
  assert.equal(app.halvingCurrentHeight, null);
  assert.equal(app.halvingDaysRemaining, null);
  assert.equal(app.dataSources.mempool.status, '异常');
  assert.equal(app.sourceBadge(app.dataSources.mempool), 'bad');
  app.dataSourceList = [{ key: 'mempool', label: '异常', badge: 'bad', relevant: true, countsForHealth: true }];
  assert.equal(options.computed.sourceHealthText.call(app), '1 个数据源异常');
});

test('halving height keeps a browser saved value if the server endpoint is unavailable', async () => {
  const saved = new Map([['crypto_ai_halving_height_v1', JSON.stringify({ height: 968005, updatedAt: Date.now() - 60000 })]]);
  const app = fixture(saved);
  app.fetchWithSoftTimeout = async () => ({ ok: false, status: 503 });
  await app.fetchHalvingCountdown();
  assert.equal(app.halvingCurrentHeight, 968005);
  assert.equal(app.dataSources.mempool.status, '旧数据');
  assert.match(app.halvingEtaText, /^\d{4}-\d{2}-\d{2}$/);
});
