import { MemoryCache } from './memory-cache.js';
import { RedisCache } from './redis-cache.js';

export class ResilientCache {
  constructor({ redisUrl = '', logger, memory = new MemoryCache() } = {}) {
    this.memory = memory;
    this.redis = redisUrl ? new RedisCache(redisUrl) : null;
    this.logger = logger;
    this.redisHealthy = false;
    this.lastRedisError = null;
  }

  async initialize() {
    if (!this.redis) return this.status();
    try { this.redisHealthy = await this.redis.ping(); }
    catch (error) { this.lastRedisError = error.message; this.logger?.warn('redis_fallback', { error: error.message }); }
    return this.status();
  }

  async _redisCall(method, ...args) {
    if (this.redis && this.redisHealthy) {
      try { return { used: true, value: await this.redis[method](...args) }; }
      catch (error) {
        this.redisHealthy = false;
        this.lastRedisError = error.message;
        this.logger?.warn('redis_fallback', { operation: method, error: error.message });
      }
    }
    return { used: false, value: null };
  }

  async get(key) {
    const redis = await this._redisCall('get', key);
    return redis.used ? redis.value : this.memory.get(key);
  }
  async set(key, value, ttlMs = 0) {
    await this.memory.set(key, value, ttlMs);
    const redis = await this._redisCall('set', key, value, ttlMs);
    return redis.used ? redis.value : true;
  }
  async setIfAbsent(key, value, ttlMs = 0) {
    const redis = await this._redisCall('setIfAbsent', key, value, ttlMs);
    if (redis.used) {
      if (redis.value) await this.memory.set(key, value, ttlMs);
      return redis.value;
    }
    return this.memory.setIfAbsent(key, value, ttlMs);
  }
  async delete(key) {
    const memoryDeleted = await this.memory.delete(key);
    const redis = await this._redisCall('delete', key);
    return redis.used ? redis.value : memoryDeleted;
  }
  status() {
    if (!this.redis) return { ...this.memory.status(), redisConfigured: false };
    return { backend: this.redisHealthy ? 'redis' : 'memory', state: this.redisHealthy ? 'healthy' : 'degraded', redisConfigured: true, lastRedisError: this.lastRedisError };
  }
}
