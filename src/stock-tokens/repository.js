import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const migrationRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'store', 'migrations');

export class MemoryStockTokenRepository {
  constructor({ staleAfterMs = 5 * 60_000 } = {}) {
    this.markets = new Map(); this.providers = new Map(); this.staleAfterMs = staleAfterMs;
  }
  async load() { return this; }
  async replaceVenueMarkets(venue, markets, at = Date.now()) {
    const found = new Set(markets.map(market => market.canonicalId));
    for (const market of this.markets.values()) {
      if (market.venue === venue && !found.has(market.canonicalId)) market.marketStatus = 'inactive';
    }
    for (const market of markets) {
      const previous = this.markets.get(market.canonicalId);
      this.markets.set(market.canonicalId, { ...previous, ...market,
        discoveredAt: previous?.discoveredAt || market.discoveredAt || at });
    }
    await this.persist();
  }
  async saveProviderState(provider, state) { this.providers.set(provider, { provider, ...state }); await this.persist(); }
  async list({ underlying, venue, active = true, now = Date.now() } = {}) {
    return [...this.markets.values()].filter(market => (!underlying || market.underlyingSymbol === underlying.toUpperCase())
      && (!venue || market.venue.toLowerCase() === venue.toLowerCase()) && (!active || market.marketStatus === 'active'))
      .map(market => ({ ...market, stale: now - market.lastUpdated > this.staleAfterMs }))
      .sort((a, b) => a.underlyingSymbol.localeCompare(b.underlyingSymbol) || a.venue.localeCompare(b.venue));
  }
  async health({ now = Date.now() } = {}) {
    const markets = await this.list({ active: false, now });
    const active = markets.filter(market => market.marketStatus === 'active');
    const states = [...this.providers.values()];
    const errors = states.filter(state => state.status === 'error' && state.error).map(state => state.error);
    return {
      discovered: markets.length,
      active: active.length,
      withPrice: active.filter(market => market.price > 0).length,
      stale: active.filter(market => market.stale).length,
      stocks: active.filter(market => market.assetType === 'stock_token').length,
      etfs: active.filter(market => market.assetType === 'etf_token').length,
      errors,
      providers: states,
      lastDiscoveryAt: Math.max(0, ...states.map(state => Number(state.lastDiscoveryAt) || 0)) || null,
      lastPriceUpdateAt: Math.max(0, ...markets.filter(market => market.price > 0).map(market => Number(market.lastUpdated) || 0)) || null
    };
  }
  async persist() {}
  async close() {}
}

export class SharedStockTokenRepository extends MemoryStockTokenRepository {
  constructor({ db, pool, staleAfterMs } = {}) { super({ staleAfterMs }); this.db = db; this.pool = pool; }
  static async create({ databaseUrl = '', databasePath = path.resolve('data/crypto-ai.sqlite'), PoolClass,
    migrate = true, staleAfterMs } = {}) {
    if (databaseUrl) {
      const Pool = PoolClass || (await import('pg')).Pool;
      const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5000 });
      try { if (migrate) await pool.query(fs.readFileSync(path.join(migrationRoot, 'postgres', '003_stock_tokens.sql'), 'utf8')); }
      catch (error) { await pool.end(); throw error; }
      return new SharedStockTokenRepository({ pool, staleAfterMs }).load();
    }
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
    if (migrate) db.exec(fs.readFileSync(path.join(migrationRoot, '003_stock_tokens.sql'), 'utf8'));
    return new SharedStockTokenRepository({ db, staleAfterMs }).load();
  }
  async rows(sql, params = []) { return this.pool ? (await this.pool.query(sql, params)).rows : this.db.prepare(sql).all(...params); }
  async load() {
    const markets = await this.rows('SELECT market_id, payload FROM stock_token_markets');
    const states = await this.rows('SELECT provider, endpoint, status, discovered, last_discovery_at, last_price_update_at, error, updated_at FROM stock_token_state');
    this.markets = new Map(markets.map(row => [row.market_id, typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload]));
    this.providers = new Map(states.map(row => [row.provider, {
      provider: row.provider, endpoint: row.endpoint, status: row.status, discovered: Number(row.discovered),
      lastDiscoveryAt: row.last_discovery_at ? Number(row.last_discovery_at) : null,
      lastPriceUpdateAt: row.last_price_update_at ? Number(row.last_price_update_at) : null,
      error: row.error ? typeof row.error === 'string' ? JSON.parse(row.error) : row.error : null,
      updatedAt: Number(row.updated_at)
    }]));
    return this;
  }
  async persist() {
    if (this.db) this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const market of this.markets.values()) {
        const values = [market.canonicalId, market.venue, market.issuer, market.underlyingSymbol,
          market.assetType, market.marketStatus, market.price, market.lastUpdated, JSON.stringify(market)];
        if (this.pool) await this.pool.query('INSERT INTO stock_token_markets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(market_id) DO UPDATE SET venue=excluded.venue,issuer=excluded.issuer,underlying_symbol=excluded.underlying_symbol,asset_type=excluded.asset_type,market_status=excluded.market_status,price=excluded.price,last_updated=excluded.last_updated,payload=excluded.payload', values);
        else this.db.prepare('INSERT OR REPLACE INTO stock_token_markets VALUES(?,?,?,?,?,?,?,?,?)').run(...values);
      }
      for (const state of this.providers.values()) {
        const values = [state.provider, state.endpoint || null, state.status, state.discovered || 0,
          state.lastDiscoveryAt || null, state.lastPriceUpdateAt || null,
          state.error ? JSON.stringify(state.error) : null, state.updatedAt || Date.now()];
        if (this.pool) await this.pool.query('INSERT INTO stock_token_state VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(provider) DO UPDATE SET endpoint=excluded.endpoint,status=excluded.status,discovered=excluded.discovered,last_discovery_at=excluded.last_discovery_at,last_price_update_at=excluded.last_price_update_at,error=excluded.error,updated_at=excluded.updated_at', values);
        else this.db.prepare('INSERT OR REPLACE INTO stock_token_state VALUES(?,?,?,?,?,?,?,?)').run(...values);
      }
      if (this.db) this.db.exec('COMMIT');
    } catch (error) { if (this.db) this.db.exec('ROLLBACK'); throw error; }
  }
  async close() { if (this.pool) await this.pool.end(); else this.db.close(); }
}

