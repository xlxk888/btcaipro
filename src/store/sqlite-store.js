import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations', '001_init.sql');

export class SQLiteEventStore {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
    this.db.exec(fs.readFileSync(migrationPath, 'utf8'));
  }

  saveSnapshot(snapshot) {
    this.db.prepare('INSERT OR REPLACE INTO snapshots VALUES (?, ?, ?)').run(snapshot.snapshotId, snapshot.createdAt, JSON.stringify(snapshot));
    return snapshot;
  }
  latestSnapshot() {
    const row = this.db.prepare('SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT 1').get();
    return row ? JSON.parse(row.payload) : null;
  }
  listSnapshots(limit = 100) {
    return this.db.prepare('SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT ?').all(Math.min(Number(limit) || 100, 1000)).map(row => JSON.parse(row.payload));
  }
  saveEvent(event) {
    this.db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?)').run(event.eventId, event.asset, event.eventType, event.severity, event.detectedAt, JSON.stringify(event));
    return event;
  }
  listEvents({ limit = 50, asset, type } = {}) {
    const filters = []; const values = [];
    if (asset) { filters.push('asset = ?'); values.push(asset); }
    if (type) { filters.push('event_type = ?'); values.push(type); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    values.push(Math.min(Number(limit) || 50, 500));
    return this.db.prepare(`SELECT payload FROM events ${where} ORDER BY detected_at DESC LIMIT ?`).all(...values).map(row => JSON.parse(row.payload));
  }
  latestEvent() { return this.listEvents({ limit: 1 })[0] || null; }
  saveSourceStatus(status) {
    const updatedAt = new Date().toISOString();
    this.db.prepare('INSERT OR REPLACE INTO source_status VALUES (?, ?, ?)').run(status.id, updatedAt, JSON.stringify({ ...status, updatedAt }));
  }
  listSourceStatuses() { return this.db.prepare('SELECT payload FROM source_status ORDER BY source_id').all().map(row => JSON.parse(row.payload)); }
  prune({ snapshotDays = 7, eventDays = 90 } = {}) {
    const snapshotBefore = new Date(Date.now() - snapshotDays * 86_400_000).toISOString();
    const eventBefore = new Date(Date.now() - eventDays * 86_400_000).toISOString();
    return {
      snapshots: Number(this.db.prepare('DELETE FROM snapshots WHERE created_at < ?').run(snapshotBefore).changes),
      events: Number(this.db.prepare('DELETE FROM events WHERE detected_at < ?').run(eventBefore).changes)
    };
  }
  close() { this.db.close(); }
}
