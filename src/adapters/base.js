export class MarketDataAdapter {
  constructor({ id, kind, logger, timeoutMs = 8_000 }) {
    this.id = id;
    this.kind = kind;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.status = { id, kind, state: 'idle', lastAttempt: null, lastSuccess: null, latencyMs: null, errorCount: 0, lastError: null, disabledReason: null };
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'CryptoAI/3.0', ...(options.headers || {}) } });
      if (!response.ok) throw new Error(`${this.id} HTTP ${response.status}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async run(...args) {
    const started = Date.now();
    this.status.lastAttempt = new Date(started).toISOString();
    this.status.state = 'running';
    try {
      const rows = await this.fetch(...args);
      this.status.state = 'healthy';
      this.status.lastSuccess = new Date().toISOString();
      this.status.latencyMs = Date.now() - started;
      this.status.errorCount = 0;
      this.status.lastError = null;
      this.logger?.info('source_success', { source: this.id, latencyMs: this.status.latencyMs, observations: rows.length });
      return rows;
    } catch (error) {
      this.status.state = 'error';
      this.status.latencyMs = Date.now() - started;
      this.status.errorCount += 1;
      this.status.lastError = error.message;
      this.logger?.warn('source_failure', { source: this.id, latencyMs: this.status.latencyMs, error: error.message, errorCount: this.status.errorCount });
      throw error;
    }
  }
}

export class DisabledAdapter extends MarketDataAdapter {
  constructor({ id, kind, reason, logger }) {
    super({ id, kind, logger });
    this.reason = reason;
    this.status.state = 'disabled';
    this.status.disabledReason = reason;
  }
  async fetch() { return []; }
  async run() { return []; }
}
