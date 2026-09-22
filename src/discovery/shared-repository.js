import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { DiscoveryRepository } from './repository.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'store', 'migrations');
const poolKey = pool => `${pool.chain}:${pool.chain === 'solana' ? pool.poolAddress : pool.poolAddress.toLowerCase()}`;
export const DISCOVERY_WORKER_STATE_KEY = '__discovery_worker__';

export class SharedDiscoveryRepository extends DiscoveryRepository {
  constructor({ db, pool } = {}) {
    super(); this.db = db; this.pool = pool;
    this.savedAssets = new Map(); this.savedPools = new Map(); this.savedCursors = new Map();
  }
  static async create({ databaseUrl = '', databasePath = path.resolve('data/crypto-ai.sqlite'), PoolClass, migrate = true } = {}) {
    if (databaseUrl) {
      const Pool = PoolClass || (await import('pg')).Pool;
      const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
      try { if (migrate) await pool.query(fs.readFileSync(path.join(root, 'postgres', '002_discovery.sql'), 'utf8')); }
      catch (error) { await pool.end(); throw error; }
      return new SharedDiscoveryRepository({ pool });
    }
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
    db.exec(fs.readFileSync(path.join(root, '002_discovery.sql'), 'utf8'));
    return new SharedDiscoveryRepository({ db });
  }
  async rows(sql, params = []) {
    return this.pool ? (await this.pool.query(sql, params)).rows : this.db.prepare(sql).all(...params);
  }
  async health({ now = Date.now(), heartbeatMs = 180_000 } = {}) {
    const [assetRows, poolRows, stateRows, checkpointRows] = await Promise.all([
      this.rows('SELECT COUNT(*) AS count FROM discovered_assets'),
      this.rows('SELECT COUNT(*) AS count FROM discovered_pools'),
      this.rows(this.pool ? 'SELECT checkpoint FROM discovery_state WHERE state_key=$1' : 'SELECT checkpoint FROM discovery_state WHERE state_key=?', [DISCOVERY_WORKER_STATE_KEY]),
      this.rows(`SELECT state_key, checkpoint, updated_at FROM discovery_state WHERE state_key <> '${DISCOVERY_WORKER_STATE_KEY}' AND state_key NOT LIKE '%:pending' ORDER BY updated_at DESC LIMIT 1`)
    ]);
    const raw = stateRows[0]?.checkpoint;
    const state = raw ? typeof raw === 'string' ? JSON.parse(raw) : raw : {};
    const last = checkpointRows[0];
    const checkpoint = last ? { key: last.state_key, value: typeof last.checkpoint === 'string' ? JSON.parse(last.checkpoint) : last.checkpoint, updatedAt: Number(last.updated_at) } : null;
    const workerRunning = state.running === true && Number.isFinite(state.heartbeatAt) && now >= state.heartbeatAt && now - state.heartbeatAt < heartbeatMs;
    return { database: 'connected', workerRunning, lastCheckpoint: checkpoint,
      lastSuccessfulScan: state.lastSuccessfulScan || null, indexedAssetCount: Number(assetRows[0]?.count || 0),
      indexedPoolCount: Number(poolRows[0]?.count || 0), lastError: state.lastError || null,
      status: workerRunning ? state.lastError ? 'degraded' : 'ok' : 'degraded' };
  }
  async load() {
    this.assets = new Map((await this.rows('SELECT asset_id, payload FROM discovered_assets')).map(row => [row.asset_id, typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload]));
    this.pools = new Map((await this.rows('SELECT pool_id, payload FROM discovered_pools')).map(row => [row.pool_id, typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload]));
    this.cursors = new Map((await this.rows('SELECT state_key, checkpoint FROM discovery_state')).map(row => [row.state_key,
      typeof row.checkpoint === 'string' ? JSON.parse(row.checkpoint) : row.checkpoint]));
    this.savedAssets = new Map([...this.assets].map(([key, value]) => [key, JSON.stringify(value)]));
    this.savedPools = new Map([...this.pools].map(([key, value]) => [key, JSON.stringify(value)]));
    this.savedCursors = new Map([...this.cursors].map(([key, value]) => [key, JSON.stringify(value)]));
    return this;
  }
  async readIndex(q, chain = 'auto') {
    const term = `%${String(q).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    const pg = Boolean(this.pool);
    const assets = await this.rows(pg
      ? `SELECT asset_id, payload FROM discovered_assets WHERE ($1='auto' OR chain=$1) AND (LOWER(name) LIKE $2 OR LOWER(symbol) LIKE $2 OR LOWER(contract_address) LIKE $2 OR LOWER(mint_address) LIKE $2) LIMIT 200`
      : `SELECT asset_id, payload FROM discovered_assets WHERE (?='auto' OR chain=?) AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(symbol) LIKE ? ESCAPE '\\' OR LOWER(contract_address) LIKE ? ESCAPE '\\' OR LOWER(mint_address) LIKE ? ESCAPE '\\') LIMIT 200`,
      pg ? [chain, term] : [chain, chain, term, term, term, term]);
    const result = new DiscoveryRepository();
    for (const row of assets) result.assets.set(row.asset_id, typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
    for (const asset of result.assets.values()) {
      const token = asset.mintAddress || asset.contractAddress?.toLowerCase();
      if (!token) continue;
      const pools = await this.rows(pg
        ? 'SELECT pool_id,payload FROM discovered_pools WHERE chain=$1 AND (token0=$2 OR token1=$2) LIMIT 100'
        : 'SELECT pool_id,payload FROM discovered_pools WHERE chain=? AND (token0=? OR token1=?) LIMIT 100',
      pg ? [asset.chain, token] : [asset.chain, token, token]);
      for (const row of pools) result.pools.set(row.pool_id, typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
    }
    return result;
  }
  async persist() {
    const now = Date.now();
    const writtenAssets = [], writtenPools = [], writtenCursors = [];
    if (this.db) this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [id, asset] of this.assets) {
        const payload = JSON.stringify(asset);
        if (this.savedAssets.get(id) === payload) continue;
        const values = [id, asset.chain, String(asset.chainId ?? ''), asset.contractAddress || null, asset.mintAddress || null, asset.name || null, asset.symbol || null, asset.decimals ?? null, asset.discoveredAt ?? now, Boolean(asset.verifiedOnChain), asset.source || asset.metadataSource || 'onchain', now, payload];
        if (this.pool) await this.pool.query('INSERT INTO discovered_assets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(asset_id) DO UPDATE SET chain=excluded.chain,chain_id=excluded.chain_id,contract_address=excluded.contract_address,mint_address=excluded.mint_address,name=excluded.name,symbol=excluded.symbol,decimals=excluded.decimals,verified_on_chain=excluded.verified_on_chain,source=excluded.source,updated_at=excluded.updated_at,payload=excluded.payload', values);
        else this.db.prepare('INSERT OR REPLACE INTO discovered_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values.map(value => typeof value === 'boolean' ? Number(value) : value));
        writtenAssets.push([id, payload]);
      }
      for (const pool of this.pools.values()) {
        const id = poolKey(pool), payload = JSON.stringify(pool);
        if (this.savedPools.get(id) === payload) continue;
        const values = [id, pool.chain, pool.poolAddress, pool.dexName || pool.dex || null, pool.token0, pool.token1, pool.createdBlock ?? null, pool.liquidityUsd ?? null, pool.volume24h ?? null, pool.firstSwapAt ?? null, pool.lastSwapAt ?? null, now, payload];
        if (this.pool) await this.pool.query('INSERT INTO discovered_pools VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(pool_id) DO UPDATE SET dex=excluded.dex,liquidity=excluded.liquidity,volume=excluded.volume,first_swap_at=excluded.first_swap_at,last_swap_at=excluded.last_swap_at,updated_at=excluded.updated_at,payload=excluded.payload', values);
        else this.db.prepare('INSERT OR REPLACE INTO discovered_pools VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values);
        writtenPools.push([id, payload]);
      }
      for (const [key, checkpoint] of this.cursors) {
        const serialized = JSON.stringify(checkpoint);
        if (this.savedCursors.get(key) === serialized) continue;
        const values = [key, serialized, now];
        if (this.pool) await this.pool.query('INSERT INTO discovery_state VALUES($1,$2,$3) ON CONFLICT(state_key) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at', values);
        else this.db.prepare('INSERT OR REPLACE INTO discovery_state VALUES(?,?,?)').run(...values);
        writtenCursors.push([key, serialized]);
      }
      if (this.db) this.db.exec('COMMIT');
      for (const [key, value] of writtenAssets) this.savedAssets.set(key, value);
      for (const [key, value] of writtenPools) this.savedPools.set(key, value);
      for (const [key, value] of writtenCursors) this.savedCursors.set(key, value);
    } catch (error) { if (this.db) this.db.exec('ROLLBACK'); throw error; }
  }
  async close() { if (this.pool) await this.pool.end(); else this.db.close(); }
}
