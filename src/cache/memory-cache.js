export class MemoryCache {
  constructor() {
    this.values = new Map();
  }

  _entry(key) {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry;
  }

  async get(key) {
    return this._entry(key)?.value ?? null;
  }

  async set(key, value, ttlMs = 0) {
    this.values.set(key, { value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    return true;
  }

  async setIfAbsent(key, value, ttlMs = 0) {
    if (this._entry(key)) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async delete(key) {
    return this.values.delete(key);
  }

  async keys(prefix = '') {
    return [...this.values.keys()].filter(key => this._entry(key) && key.startsWith(prefix));
  }

  status() {
    return { backend: 'memory', state: 'healthy', entries: this.values.size };
  }
}
