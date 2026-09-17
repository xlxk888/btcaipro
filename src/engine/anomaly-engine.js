const DEFAULTS = Object.freeze({
  pricePct: { '1m': 0.8, '5m': 1.8, '15m': 3, '1h': 5 },
  volumeSpikeRatio: 2.5,
  openInterestPct: 4,
  fundingAbsolute: 0.001,
  fundingChange: 0.0005,
  liquidationUsd: 25_000_000
});

const WINDOWS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 };
const metricValue = (snapshot, asset, metric) => snapshot?.assets?.[asset]?.[metric]?.value;
const finite = value => Number.isFinite(Number(value));
const percentChange = (current, previous) => (Number(current) / Number(previous) - 1) * 100;
const severityFor = ratio => ratio >= 2 ? 'critical' : ratio >= 1.4 ? 'high' : 'medium';

function closestSnapshot(history, targetTime, toleranceMs) {
  return history.reduce((best, snapshot) => {
    const distance = Math.abs(new Date(snapshot.createdAt).getTime() - targetTime);
    return distance <= toleranceMs && (!best || distance < best.distance) ? { snapshot, distance } : best;
  }, null)?.snapshot || null;
}

function median(values) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class AnomalyEngine {
  constructor(thresholds = {}) {
    this.thresholds = { ...DEFAULTS, ...thresholds, pricePct: { ...DEFAULTS.pricePct, ...(thresholds.pricePct || {}) } };
  }

  detect(snapshot, history = [], { includeSignals = false } = {}) {
    const candidates = [];
    const now = new Date(snapshot.createdAt).getTime();
    for (const asset of Object.keys(snapshot.assets || {})) {
      const price = metricValue(snapshot, asset, 'price');
      if (!finite(price)) continue;
      const priceChanges = {};
      for (const [window, duration] of Object.entries(WINDOWS)) {
        const previousSnapshot = closestSnapshot(history, now - duration, Math.max(duration * 0.35, 40_000));
        const previousPrice = metricValue(previousSnapshot, asset, 'price');
        if (!finite(previousPrice) || Number(previousPrice) === 0) continue;
        const change = percentChange(price, previousPrice);
        priceChanges[window] = change;
        const threshold = this.thresholds.pricePct[window];
        const strength = Math.abs(change) / threshold;
        if (includeSignals || strength >= 1) candidates.push(this._candidate(snapshot, asset, 'price_move', change > 0 ? 'up' : 'down', window, severityFor(strength), { price, previousPrice, changePct: change }, { changePct: threshold }, strength >= 1));
      }

      const volume = metricValue(snapshot, asset, 'volume24h');
      const volumeBaseline = median(history.slice(0, 24).map(item => metricValue(item, asset, 'volume24h')));
      if (finite(volume) && finite(volumeBaseline) && volumeBaseline > 0) {
        const ratio = Number(volume) / volumeBaseline;
        const strength = ratio / this.thresholds.volumeSpikeRatio;
        if (includeSignals || strength >= 1) candidates.push(this._candidate(snapshot, asset, 'volume_spike', 'up', '24h', severityFor(strength), { volume, baseline: volumeBaseline, ratio }, { ratio: this.thresholds.volumeSpikeRatio }, strength >= 1));
      }

      const currentOi = metricValue(snapshot, asset, 'openInterest');
      const previousOi = metricValue(history[0], asset, 'openInterest');
      let oiChange = null;
      if (finite(currentOi) && finite(previousOi) && previousOi > 0) {
        oiChange = percentChange(currentOi, previousOi);
        const strength = Math.abs(oiChange) / this.thresholds.openInterestPct;
        if (includeSignals || strength >= 1) candidates.push(this._candidate(snapshot, asset, 'open_interest_move', oiChange > 0 ? 'up' : 'down', 'snapshot', severityFor(strength), { openInterest: currentOi, previousOpenInterest: previousOi, changePct: oiChange }, { changePct: this.thresholds.openInterestPct }, strength >= 1));
      }

      const funding = metricValue(snapshot, asset, 'fundingRate');
      const previousFunding = metricValue(history[0], asset, 'fundingRate');
      if (finite(funding)) {
        const delta = finite(previousFunding) ? Number(funding) - Number(previousFunding) : null;
        const strength = Math.max(Math.abs(funding) / this.thresholds.fundingAbsolute, finite(delta) ? Math.abs(delta) / this.thresholds.fundingChange : 0);
        if (includeSignals || strength >= 1) candidates.push(this._candidate(snapshot, asset, 'funding_extreme', funding > 0 ? 'positive' : 'negative', '8h', severityFor(strength), { fundingRate: funding, previousFundingRate: previousFunding, change: delta }, { absolute: this.thresholds.fundingAbsolute, change: this.thresholds.fundingChange }, strength >= 1));
      }

      const liquidations = metricValue(snapshot, asset, 'liquidations');
      if (finite(liquidations)) {
        const strength = liquidations / this.thresholds.liquidationUsd;
        if (includeSignals || strength >= 1) candidates.push(this._candidate(snapshot, asset, 'liquidation_spike', 'risk', '1h', severityFor(strength), { liquidations }, { usd: this.thresholds.liquidationUsd }, strength >= 1));
      }

      const volumeCandidate = candidates.find(item => item.asset === asset && item.eventType === 'volume_spike' && item.triggered);
      if ((priceChanges['5m'] || priceChanges['15m']) && volumeCandidate && finite(oiChange)) {
        const change = priceChanges['5m'] || priceChanges['15m'];
        if (Math.sign(change) === Math.sign(oiChange)) candidates.push(this._candidate(snapshot, asset, 'momentum_confluence', change > 0 ? 'up' : 'down', priceChanges['5m'] ? '5m' : '15m', 'high', { priceChangePct: change, volumeRatio: volumeCandidate.metrics.ratio, openInterestChangePct: oiChange }, { pricePct: this.thresholds.pricePct['5m'], volumeRatio: this.thresholds.volumeSpikeRatio, openInterestPct: this.thresholds.openInterestPct }));
      }
      if ((priceChanges['5m'] || priceChanges['15m']) < 0 && finite(oiChange) && oiChange < 0 && finite(liquidations) && liquidations >= this.thresholds.liquidationUsd) candidates.push(this._candidate(snapshot, asset, 'deleveraging_risk', 'down', '15m', 'critical', { priceChangePct: priceChanges['5m'] || priceChanges['15m'], openInterestChangePct: oiChange, liquidations }, { openInterestPct: this.thresholds.openInterestPct, liquidationUsd: this.thresholds.liquidationUsd }));
    }
    return candidates;
  }

  _candidate(snapshot, asset, eventType, direction, timeWindow, severity, metrics, thresholds, triggered = true) {
    return { asset, eventType, direction, severity, timeWindow, detectedAt: snapshot.createdAt, snapshotId: snapshot.snapshotId, metrics, thresholds, triggered, evidence: Object.entries(metrics).filter(([, value]) => value !== null).map(([name, value]) => ({ name, value })) };
  }
}

export { DEFAULTS as DEFAULT_ANOMALY_THRESHOLDS };
