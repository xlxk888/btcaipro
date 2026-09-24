import test from 'node:test';
import assert from 'node:assert/strict';
import '../i18n.js';

const i18n = globalThis.CryptoAIi18n;
const store = value => ({ getItem: () => value });

test('zh and en dictionaries have identical keys', () => {
  assert.deepEqual(Object.keys(i18n.dictionaries['zh-CN']).sort(), Object.keys(i18n.dictionaries['en-US']).sort());
});

test('required state codes translate consistently', () => {
  for (const key of ['medium_risk', 'greed', 'weak', 'dca_zone', 'exchange_price', 'issuer_reference', 'fresh', 'stale', 'error', 'loading', 'enabled', 'disabled', 'triggered']) {
    assert.ok(i18n.dictionaries['zh-CN'][`status.${key}`]);
    assert.ok(i18n.dictionaries['en-US'][`status.${key}`]);
  }
  i18n.setLocale('zh-CN', { persist: false, navigate: false });
  assert.equal(i18n.t('status.medium_risk'), '中等风险');
  assert.equal(i18n.t('status.greed'), '贪婪');
  i18n.setLocale('en-US', { persist: false, navigate: false });
  assert.equal(i18n.t('status.medium_risk'), 'Medium Risk');
  assert.equal(i18n.t('status.weak'), 'Weak');
  assert.equal(i18n.t('status.dca_zone'), 'DCA Zone');
  assert.equal(i18n.t('status.exchange_price'), 'Exchange Price');
  assert.equal(i18n.t('status.issuer_reference'), 'Reference Price');
});

test('route takes priority over storage and browser; root follows storage then browser', () => {
  assert.equal(i18n.resolveInitialLocale({ pathname: '/zh', storage: store('en-US'), navigatorObject: { language: 'en-US' } }), 'zh-CN');
  assert.equal(i18n.resolveInitialLocale({ pathname: '/en', storage: store('zh-CN'), navigatorObject: { language: 'zh-CN' } }), 'en-US');
  assert.equal(i18n.resolveInitialLocale({ pathname: '/', storage: store('zh-CN'), navigatorObject: { language: 'en-US' } }), 'zh-CN');
  assert.equal(i18n.resolveInitialLocale({ pathname: '/', storage: store('en-US'), navigatorObject: { language: 'zh-CN' } }), 'en-US');
  assert.equal(i18n.resolveInitialLocale({ pathname: '/', storage: store(null), navigatorObject: { language: 'zh-HK' } }), 'zh-CN');
  assert.equal(i18n.resolveInitialLocale({ pathname: '/', storage: store(null), navigatorObject: { language: 'fr-FR' } }), 'en-US');
});

test('fallback and interpolation never expose an internal key', () => {
  i18n.setLocale('en-US', { persist: false, navigate: false });
  assert.equal(i18n.t('header.refresh', { time: '12:30' }), 'Updated 12:30');
  assert.equal(i18n.t('missing.readable_key'), 'readable key');
});

test('compact, currency, percent and dates follow locale', () => {
  i18n.setLocale('zh-CN', { persist: false, navigate: false });
  assert.equal(i18n.formatCompactNumber(796400), '79.64万');
  assert.equal(i18n.formatCompactNumber(1.69e12), '1.69万亿');
  assert.equal(i18n.formatPercent(-2.96), '-2.96%');
  assert.equal(i18n.formatDate('2026-09-24T12:00:00Z', { timeZone: 'UTC' }), '2026/9/24');
  i18n.setLocale('en-US', { persist: false, navigate: false });
  assert.equal(i18n.formatCompactNumber(796400), '796.4K');
  assert.equal(i18n.formatCompactNumber(1.69e12), '1.69T');
  assert.equal(i18n.formatCurrency(83932.01), '$83,932.01');
  assert.equal(i18n.formatDate('2026-09-24T12:00:00Z', { timeZone: 'UTC' }), '9/24/2026');
});
