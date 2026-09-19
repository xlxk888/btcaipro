import { SOURCE_DEFINITIONS } from '../provenance/source-definitions.js';

export const SOURCE_HEALTH = Object.freeze({
  HEALTHY: 'healthy', FALLBACK: 'fallback', STALE: 'stale', DISABLED: 'disabled', ERROR: 'error', UNAVAILABLE: 'unavailable', IDLE: 'idle'
});

const normalizeState = state => String(state || 'idle').toLowerCase();

export function getSourceHealthSummary(statuses = [], { definitions = SOURCE_DEFINITIONS, now = Date.now() } = {}) {
  const statusById = new Map(statuses.filter(Boolean).map(status => [status.id || status.sourceId, status]));
  const groupAvailability = new Map();

  for (const definition of definitions) {
    const status = statusById.get(definition.sourceId);
    const state = normalizeState(status?.state);
    if (definition.enabled !== false && ['healthy', 'fallback'].includes(state)) groupAvailability.set(definition.group, { definition, status });
  }

  const sources = definitions.map(definition => {
    const status = statusById.get(definition.sourceId) || {};
    let statusCode = normalizeState(status.state);
    const lastSuccess = status.lastSuccess || status.dataTime || null;
    const ageMs = lastSuccess ? Math.max(0, now - Date.parse(lastSuccess)) : null;
    const stale = status.stale === true || (ageMs !== null && definition.freshnessMs > 0 && ageMs > definition.freshnessMs);
    if (definition.enabled === false || statusCode === 'disabled') statusCode = SOURCE_HEALTH.DISABLED;
    else if (['error', 'unavailable'].includes(statusCode) && definition.role === 'primary' && groupAvailability.get(definition.group)) statusCode = SOURCE_HEALTH.FALLBACK;
    else if (stale && !['error', 'unavailable'].includes(statusCode)) statusCode = SOURCE_HEALTH.STALE;
    else if (!Object.values(SOURCE_HEALTH).includes(statusCode) && statusCode !== 'running') statusCode = SOURCE_HEALTH.IDLE;
    else if (statusCode === 'running') statusCode = SOURCE_HEALTH.HEALTHY;

    const critical = ['error', 'unavailable'].includes(statusCode) || (statusCode === 'stale' && status.criticalStale === true);
    return {
      ...definition,
      status: statusCode,
      critical,
      enabled: definition.enabled !== false,
      activeSource: status.activeSource || (statusCode === 'fallback' ? status.fallbackSource || groupAvailability.get(definition.group)?.definition.sourceName || 'fallback' : definition.sourceName),
      fallbackSource: status.fallbackSource || (statusCode === 'fallback' ? groupAvailability.get(definition.group)?.definition.sourceName || null : null),
      dataTime: status.dataTime || lastSuccess,
      receivedAt: status.receivedAt || status.updatedAt || status.lastAttempt || null,
      freshness: stale ? 'stale' : ageMs === null ? 'unknown' : 'fresh',
      confidence: status.confidence || (statusCode === 'healthy' ? 'high' : statusCode === 'fallback' ? 'medium' : 'low'),
      errorReason: status.lastError || status.disabledReason || null,
      lastSuccess,
      ageMs
    };
  });

  const criticalCount = sources.filter(source => source.critical).length;
  return {
    status: criticalCount ? SOURCE_HEALTH.ERROR : sources.some(source => source.status === SOURCE_HEALTH.FALLBACK) ? SOURCE_HEALTH.FALLBACK : SOURCE_HEALTH.HEALTHY,
    criticalCount,
    fallbackCount: sources.filter(source => source.status === SOURCE_HEALTH.FALLBACK).length,
    staleCount: sources.filter(source => source.status === SOURCE_HEALTH.STALE).length,
    disabledCount: sources.filter(source => source.status === SOURCE_HEALTH.DISABLED).length,
    total: sources.length,
    generatedAt: new Date(now).toISOString(),
    sources
  };
}
