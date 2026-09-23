import path from 'node:path';

const number = (value, fallback, min = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
};

export function loadConfig(env = process.env) {
  const symbols = String(env.MARKET_SYMBOLS || 'BTCUSDT,ETHUSDT')
    .split(',')
    .map(value => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);
  return {
    host: env.HOST || '127.0.0.1',
    port: number(env.PORT, 8787, 1),
    workerEnabled: bool(env.WORKER_ENABLED, true),
    stockTokenEnabled: bool(env.STOCK_TOKEN_ENABLED, true),
    stockTokenPollMs: number(env.STOCK_TOKEN_POLL_MS, 5 * 60_000, 60_000),
    stockTokenStaleMs: number(env.STOCK_TOKEN_STALE_MS, 10 * 60_000, 60_000),
    symbols: [...new Set(symbols.length ? symbols : ['BTCUSDT', 'ETHUSDT'])],
    databasePath: path.resolve(env.DATABASE_PATH || './data/crypto-ai.sqlite'),
    databaseUrl: env.DATABASE_URL || '',
    redisUrl: env.REDIS_URL || '',
    logLevel: env.LOG_LEVEL || 'info',
    corsOrigin: env.CORS_ORIGIN || '',
    spotPollMs: number(env.SPOT_POLL_MS, 30_000, 5_000),
    derivativesPollMs: number(env.DERIVATIVES_POLL_MS, 60_000, 10_000),
    snapshotIntervalMs: number(env.SNAPSHOT_INTERVAL_MS, 30_000, 10_000),
    snapshotRetentionDays: number(env.SNAPSHOT_RETENTION_DAYS, 7, 1),
    eventRetentionDays: number(env.EVENT_RETENTION_DAYS, 90, 1),
    requestTimeoutMs: number(env.REQUEST_TIMEOUT_MS, 8_000, 1_000)
  };
}
