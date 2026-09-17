export class Scheduler {
  constructor({ logger } = {}) { this.logger = logger; this.tasks = new Map(); this.stopped = true; }

  add({ name, intervalMs, task, maxBackoffMs = intervalMs * 8, initialDelayMs = 0 }) {
    if (this.tasks.has(name)) throw new Error(`Duplicate task: ${name}`);
    this.tasks.set(name, { name, intervalMs, initialDelayMs, task, maxBackoffMs, failures: 0, running: false, timer: null });
  }

  start() {
    if (!this.stopped) return false;
    this.stopped = false;
    for (const item of this.tasks.values()) this._schedule(item, item.initialDelayMs);
    return true;
  }

  _schedule(item, delay) {
    if (this.stopped) return;
    clearTimeout(item.timer);
    item.timer = setTimeout(() => this._run(item), delay);
  }

  async _run(item) {
    if (this.stopped || item.running) return;
    item.running = true;
    try {
      await item.task();
      item.failures = 0;
    } catch (error) {
      item.failures += 1;
      this.logger?.error('scheduled_task_failure', { task: item.name, failures: item.failures, error: error.message });
    } finally {
      item.running = false;
      const delay = item.failures ? Math.min(item.maxBackoffMs, item.intervalMs * 2 ** Math.min(item.failures, 5)) : item.intervalMs;
      this._schedule(item, delay);
    }
  }

  stop() { this.stopped = true; for (const item of this.tasks.values()) clearTimeout(item.timer); }
  status() { return [...this.tasks.values()].map(({ name, intervalMs, failures, running }) => ({ name, intervalMs, failures, running })); }
}
