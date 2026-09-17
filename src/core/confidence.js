const SOURCE_BASE = { primary: 92, secondary: 82, fallback: 68, local: 72, disabled: 0 };

export function evaluateConfidence({ sourcePriority = 'secondary', freshness, missingFields = [], consensusDeltaPct = null }) {
  let score = SOURCE_BASE[sourcePriority] ?? SOURCE_BASE.secondary;
  const reasons = [`source:${sourcePriority}`];
  if (!freshness || freshness.status === 'unavailable') {
    score -= 55;
    reasons.push('unavailable');
  } else if (freshness.status === 'stale') {
    score -= 35;
    reasons.push('stale');
  } else if (freshness.status === 'delayed') {
    score -= 15;
    reasons.push('delayed');
  } else {
    reasons.push('fresh');
  }
  if (missingFields.length) {
    score -= Math.min(30, missingFields.length * 10);
    reasons.push(`missing:${missingFields.join(',')}`);
  }
  if (Number.isFinite(consensusDeltaPct)) {
    if (consensusDeltaPct <= 0.5) { score += 5; reasons.push('multi_source_aligned'); }
    else if (consensusDeltaPct > 2) { score -= 20; reasons.push('multi_source_divergence'); }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { level: score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low', score, reasons };
}
