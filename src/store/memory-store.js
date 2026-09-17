export class MemoryEventStore {
  constructor() { this.snapshots = []; this.events = []; this.sources = new Map(); }
  saveSnapshot(value) { this.snapshots.unshift(value); return value; }
  latestSnapshot() { return this.snapshots[0] || null; }
  listSnapshots(limit = 100) { return this.snapshots.slice(0, limit); }
  saveEvent(value) { if (!this.events.some(item => item.eventId === value.eventId)) this.events.unshift(value); return value; }
  listEvents({ limit = 50, asset, type } = {}) { return this.events.filter(item => (!asset || item.asset === asset) && (!type || item.eventType === type)).slice(0, limit); }
  latestEvent() { return this.events[0] || null; }
  saveSourceStatus(value) { this.sources.set(value.id, { ...value, updatedAt: new Date().toISOString() }); }
  listSourceStatuses() { return [...this.sources.values()]; }
  prune() { return { snapshots: 0, events: 0 }; }
  close() {}
}
