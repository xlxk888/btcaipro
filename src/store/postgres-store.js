import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations', 'postgres', '001_init.sql');

export class PostgresEventStore {
  constructor(pool) { this.pool = pool; }

  static async create(connectionString, { PoolClass } = {}) {
    if (!connectionString) throw new TypeError('DATABASE_URL is required for PostgreSQL');
    const Pool = PoolClass || (await import('pg')).Pool;
    const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    await pool.query(fs.readFileSync(migrationPath, 'utf8'));
    return new PostgresEventStore(pool);
  }

  async saveSnapshot(snapshot) {
    await this.pool.query('INSERT INTO snapshots(snapshot_id,created_at,payload) VALUES($1,$2,$3) ON CONFLICT(snapshot_id) DO UPDATE SET created_at=excluded.created_at,payload=excluded.payload', [snapshot.snapshotId, snapshot.createdAt, snapshot]);
    return snapshot;
  }
  async latestSnapshot() { const result = await this.pool.query('SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT 1'); return result.rows[0]?.payload || null; }
  async listSnapshots(limit = 100) { const result = await this.pool.query('SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT $1', [Math.min(Number(limit) || 100, 1000)]); return result.rows.map(row => row.payload); }
  async saveEvent(event) {
    await this.pool.query('INSERT INTO events(event_id,asset,event_type,severity,detected_at,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO NOTHING', [event.eventId, event.asset, event.eventType, event.severity, event.detectedAt, event]);
    return event;
  }
  async listEvents({ limit = 50, asset, type } = {}) {
    const filters = []; const values = [];
    if (asset) { values.push(asset); filters.push(`asset = $${values.length}`); }
    if (type) { values.push(type); filters.push(`event_type = $${values.length}`); }
    values.push(Math.min(Number(limit) || 50, 500));
    const result = await this.pool.query(`SELECT payload FROM events ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY detected_at DESC LIMIT $${values.length}`, values);
    return result.rows.map(row => row.payload);
  }
  async latestEvent() { return (await this.listEvents({ limit: 1 }))[0] || null; }
  async saveSourceStatus(status) {
    const updatedAt = new Date().toISOString(); const payload = { ...status, updatedAt };
    await this.pool.query('INSERT INTO source_status(source_id,updated_at,payload) VALUES($1,$2,$3) ON CONFLICT(source_id) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload', [status.id, updatedAt, payload]);
  }
  async listSourceStatuses() { const result = await this.pool.query('SELECT payload FROM source_status ORDER BY source_id'); return result.rows.map(row => row.payload); }
  async prune({ snapshotDays = 7, eventDays = 90 } = {}) {
    const snapshots = await this.pool.query("DELETE FROM snapshots WHERE created_at < NOW() - ($1 * INTERVAL '1 day')", [snapshotDays]);
    const events = await this.pool.query("DELETE FROM events WHERE detected_at < NOW() - ($1 * INTERVAL '1 day')", [eventDays]);
    return { snapshots: snapshots.rowCount, events: events.rowCount };
  }
  async close() { await this.pool.end(); }
}
