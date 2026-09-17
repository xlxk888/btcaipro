export const FRESHNESS_POLICIES = Object.freeze({
  spot: { freshMs: 20_000, delayedMs: 60_000, staleMs: 180_000 },
  derivatives: { freshMs: 90_000, delayedMs: 240_000, staleMs: 600_000 },
  sentiment: { freshMs: 2 * 60 * 60_000, delayedMs: 6 * 60 * 60_000, staleMs: 24 * 60 * 60_000 },
  valuation: { freshMs: 10 * 60_000, delayedMs: 30 * 60_000, staleMs: 2 * 60 * 60_000 },
  macroDaily: { freshMs: 12 * 60 * 60_000, delayedMs: 36 * 60 * 60_000, staleMs: 72 * 60 * 60_000 },
  miner: { freshMs: 20 * 60_000, delayedMs: 60 * 60_000, staleMs: 6 * 60 * 60_000 }
});

export function evaluateFreshness(dataTime, policy = FRESHNESS_POLICIES.spot, now = Date.now()) {
  const timestamp = new Date(dataTime).getTime();
  if (!Number.isFinite(timestamp)) return { status: 'unavailable', stale: true, ageMs: null, reason: 'invalid_data_time' };
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs <= policy.freshMs) return { status: 'fresh', stale: false, ageMs, reason: 'within_fresh_window' };
  if (ageMs <= policy.delayedMs) return { status: 'delayed', stale: false, ageMs, reason: 'outside_fresh_window' };
  if (ageMs <= policy.staleMs) return { status: 'stale', stale: true, ageMs, reason: 'outside_delayed_window' };
  return { status: 'unavailable', stale: true, ageMs, reason: 'expired' };
}

export function policyFor(kind) {
  return FRESHNESS_POLICIES[kind] || FRESHNESS_POLICIES.spot;
}
