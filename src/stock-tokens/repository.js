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
    await this.persist({ venue });
  }
  async saveProviderState(provider, state) { this.providers.set(provider, { provider, ...state }); await this.persist({ provider }); }
  async withRefreshLock(task) { await task(this); return true; }
  async list({ underlying, venue, active = true, now = Date.now() } = {}) {
    return [...this.markets.values()].filter(market => (!underlying || market.underlyingSymbol === underlying.toUpperCase())
      && (!venue || market.venue.toLowerCase() === venue.toLowerCase()) && (!active || market.marketStatus === 'active'))
      .map(market => ({ ...market, stale: !(market.lastUpdated > 0) || now - market.lastUpdated > this.staleAfterMs }))
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
  async withRefreshLock(task) {
    if (!this.pool) return super.withRefreshLock(task);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT pg_try_advisory_xact_lock(78324, 1) AS acquired');
      if (!result.rows[0].acquired) { await client.query('ROLLBACK'); return false; }
      const locked = await new SharedStockTokenRepository({ pool: client, staleAfterMs: this.staleAfterMs }).load();
      await task(locked);
      await client.query('COMMIT');
      this.markets = locked.markets; this.providers = locked.providers;
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async persist({ venue, provider } = {}) {
    // A provider refresh must never write an old snapshot of another provider.
    const marketValues = provider ? [] : [...this.markets.values()].filter(market => !venue || market.venue === venue);
    const stateValues = venue ? [] : [...this.providers.values()].filter(state => !provider || state.provider === provider);
    if (this.pool) {
      const markets = marketValues.map(market => ({
        market_id: market.canonicalId, venue: market.venue, issuer: market.issuer,
        underlying_symbol: market.underlyingSymbol, asset_type: market.assetType,
        market_status: market.marketStatus, price: market.price, last_updated: market.lastUpdated,
        payload: market
      }));
      const states = stateValues.map(state => ({
        provider: state.provider, endpoint: state.endpoint || null, status: state.status,
        discovered: state.discovered || 0, last_discovery_at: state.lastDiscoveryAt || null,
        last_price_update_at: state.lastPriceUpdateAt || null, error: state.error || null,
        updated_at: state.updatedAt || Date.now()
      }));
      if (markets.length) await this.pool.query(`
        INSERT INTO stock_token_markets
          (market_id, venue, issuer, underlying_symbol, asset_type, market_status, price, last_updated, payload)
        SELECT market_id, venue, issuer, underlying_symbol, asset_type, market_status, price, last_updated, payload
        FROM jsonb_to_recordset($1::jsonb) AS row(
          market_id TEXT, venue TEXT, issuer TEXT, underlying_symbol TEXT, asset_type TEXT,
          market_status TEXT, price DOUBLE PRECISION, last_updated BIGINT, payload JSONB)
        ON CONFLICT(market_id) DO UPDATE SET venue=excluded.venue, issuer=excluded.issuer,
          underlying_symbol=excluded.underlying_symbol, asset_type=excluded.asset_type,
          market_status=excluded.market_status, price=excluded.price,
          last_updated=excluded.last_updated, payload=excluded.payload`, [JSON.stringify(markets)]);
      if (states.length) await this.pool.query(`
        INSERT INTO stock_token_state
          (provider, endpoint, status, discovered, last_discovery_at, last_price_update_at, error, updated_at)
        SELECT provider, endpoint, status, discovered, last_discovery_at, last_price_update_at, error, updated_at
        FROM jsonb_to_recordset($1::jsonb) AS row(
          provider TEXT, endpoint TEXT, status TEXT, discovered INTEGER, last_discovery_at BIGINT,
          last_price_update_at BIGINT, error JSONB, updated_at BIGINT)
        ON CONFLICT(provider) DO UPDATE SET endpoint=excluded.endpoint, status=excluded.status,
          discovered=excluded.discovered, last_discovery_at=excluded.last_discovery_at,
          last_price_update_at=excluded.last_price_update_at, error=excluded.error,
          updated_at=excluded.updated_at`, [JSON.stringify(states)]);
      return;
    }
    if (this.db) this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const market of marketValues) {
        const values = [market.canonicalId, market.venue, market.issuer, market.underlyingSymbol,
          market.assetType, market.marketStatus, market.price, market.lastUpdated, JSON.stringify(market)];
        this.db.prepare('INSERT OR REPLACE INTO stock_token_markets VALUES(?,?,?,?,?,?,?,?,?)').run(...values);
      }
      for (const state of stateValues) {
        const values = [state.provider, state.endpoint || null, state.status, state.discovered || 0,
          state.lastDiscoveryAt || null, state.lastPriceUpdateAt || null,
          state.error ? JSON.stringify(state.error) : null, state.updatedAt || Date.now()];
        this.db.prepare('INSERT OR REPLACE INTO stock_token_state VALUES(?,?,?,?,?,?,?,?)').run(...values);
      }
      if (this.db) this.db.exec('COMMIT');
    } catch (error) { if (this.db) this.db.exec('ROLLBACK'); throw error; }
  }
  async close() { if (this.pool) await this.pool.end(); else this.db.close(); }
}
