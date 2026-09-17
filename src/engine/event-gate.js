import { createHash } from 'node:crypto';

const ranks = { medium: 1, high: 2, critical: 3 };

export class EventGate {
  constructor({ cache, cooldownMs = 15 * 60_000, releaseRatio = 0.75 } = {}) {
    this.cache = cache;
    this.cooldownMs = cooldownMs;
    this.releaseRatio = releaseRatio;
  }

  key(candidate) { return `${candidate.asset}:${candidate.eventType}:${candidate.direction}:${candidate.timeWindow}`; }

  async admit(candidate, now = Date.now()) {
    const key = this.key(candidate);
    const stateKey = `event-state:${key}`;
    const rawState = await this.cache.get(stateKey);
    const state = rawState ? JSON.parse(rawState) : null;
    const score = this._score(candidate);
    if (score < this.releaseRatio) {
      if (state?.active) await this.cache.set(stateKey, JSON.stringify({ ...state, active: false, releasedAt: now }), this.cooldownMs * 4);
      return null;
    }
    if (score < 1) return null;
    const severityUpgrade = state && ranks[candidate.severity] > ranks[state.severity];
    if (state?.active && now - state.emittedAt < this.cooldownMs && !severityUpgrade) return null;
    const eventId = `evt_${createHash('sha256').update(`${key}:${candidate.snapshotId}:${candidate.severity}`).digest('hex').slice(0, 20)}`;
    const event = { eventId, ...candidate, dedupKey: key, cooldownMs: this.cooldownMs, escalation: Boolean(severityUpgrade) };
    await this.cache.set(stateKey, JSON.stringify({ active: true, severity: candidate.severity, emittedAt: now, score, eventId }), this.cooldownMs * 4);
    return event;
  }

  async release(candidate, score = 0, now = Date.now()) {
    if (score > this.releaseRatio) return false;
    const stateKey = `event-state:${this.key(candidate)}`;
    const rawState = await this.cache.get(stateKey);
    if (!rawState) return false;
    await this.cache.set(stateKey, JSON.stringify({ ...JSON.parse(rawState), active: false, releasedAt: now }), this.cooldownMs * 4);
    return true;
  }

  _score(candidate) {
    const values = [];
    if (candidate.metrics?.changePct !== undefined && candidate.thresholds?.changePct) values.push(Math.abs(candidate.metrics.changePct) / candidate.thresholds.changePct);
    if (candidate.metrics?.ratio !== undefined && candidate.thresholds?.ratio) values.push(candidate.metrics.ratio / candidate.thresholds.ratio);
    if (candidate.metrics?.fundingRate !== undefined && candidate.thresholds?.absolute) values.push(Math.abs(candidate.metrics.fundingRate) / candidate.thresholds.absolute);
    if (candidate.metrics?.change !== undefined && candidate.thresholds?.change) values.push(Math.abs(candidate.metrics.change) / candidate.thresholds.change);
    if (candidate.metrics?.liquidations !== undefined && candidate.thresholds?.usd) values.push(candidate.metrics.liquidations / candidate.thresholds.usd);
    return values.length ? Math.max(...values) : 1;
  }
}
