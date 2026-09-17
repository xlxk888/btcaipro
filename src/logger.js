const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACTED_KEYS = /secret|token|password|authorization|cookie|api[_-]?key/i;

function sanitize(value, depth = 0) {
  if (depth > 5) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    REDACTED_KEYS.test(key) ? '[redacted]' : sanitize(item, depth + 1)
  ]));
}

export function createLogger(level = 'info', sink = console) {
  const threshold = LEVELS[level] || LEVELS.info;
  const write = (name, message, context = {}) => {
    if (LEVELS[name] < threshold) return;
    const entry = JSON.stringify({ time: new Date().toISOString(), level: name, message, ...sanitize(context) });
    const method = name === 'error' ? 'error' : name === 'warn' ? 'warn' : 'log';
    sink[method](entry);
  };
  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context)
  };
}
