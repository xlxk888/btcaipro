import { evaluateConfidence } from '../core/confidence.js';
import { evaluateFreshness, policyFor } from '../core/freshness.js';

export const METRICS = Object.freeze({
  PRICE: 'price', CHANGE_24H: 'change24h', VOLUME_24H: 'volume24h',
  OPEN_INTEREST: 'openInterest', FUNDING_RATE: 'fundingRate', LIQUIDATIONS: 'liquidations',
  FEAR_GREED: 'fearGreed', AHR999: 'ahr999'
});

export function observationKey(symbol, metric) {
  return `${String(symbol || 'MARKET').toUpperCase()}:${metric}`;
}

export function normalizeObservation(input, now = Date.now()) {
  const receivedAt = new Date(input.receivedAt || now).toISOString();
  const dataTime = new Date(input.dataTime || receivedAt).toISOString();
  const numericValue = Number(input.value);
  const missingFields = [];
  if (!input.source) missingFields.push('source');
  if (!input.metric) missingFields.push('metric');
  if (!Number.isFinite(numericValue)) missingFields.push('value');
  const freshness = evaluateFreshness(dataTime, input.freshnessPolicy || policyFor(input.kind), now);
  const confidence = evaluateConfidence({
    sourcePriority: input.sourcePriority,
    freshness,
    missingFields,
    consensusDeltaPct: input.consensusDeltaPct
  });
  return {
    symbol: String(input.symbol || 'MARKET').toUpperCase(),
    market: input.market || 'crypto',
    metric: input.metric || 'unknown',
    value: Number.isFinite(numericValue) ? numericValue : null,
    unit: input.unit || null,
    interval: input.interval || null,
    source: input.source || 'unknown',
    sourcePriority: input.sourcePriority || 'secondary',
    dataTime,
    receivedAt,
    stale: freshness.stale,
    status: freshness.status,
    latency: freshness.ageMs,
    confidence,
    rawValue: input.rawValue ?? input.value ?? null,
    metadata: input.metadata || {}
  };
}

export function isUsableObservation(observation) {
  return Boolean(observation && observation.value !== null && !observation.stale && observation.status !== 'unavailable');
}
