(function attachMarketRadar(root, factory) {
  root.CryptoAIMarketRadar = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMarketRadar() {
  const CLASSIFICATIONS = Object.freeze({
    'extreme fear': { key: 'extreme_fear', label: '极度恐慌', color: '#ef4444', riskScore: 85 },
    fear: { key: 'fear', label: '恐慌', color: '#fb923c', riskScore: 65 },
    neutral: { key: 'neutral', label: '中性', color: '#94a3b8', riskScore: 30 },
    greed: { key: 'greed', label: '贪婪', color: '#4ade80', riskScore: 50 },
    'extreme greed': { key: 'extreme_greed', label: '极度贪婪', color: '#22c55e', riskScore: 80 }
  });

  const CLASSIFICATION_ALIASES = Object.freeze({
    极度恐慌: 'extreme fear', 恐慌: 'fear', 中性: 'neutral', 中立: 'neutral', 贪婪: 'greed', 极度贪婪: 'extreme greed'
  });

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function fallbackClassification(value) {
    if (value <= 24) return 'extreme fear';
    if (value <= 44) return 'fear';
    if (value <= 55) return 'neutral';
    if (value <= 74) return 'greed';
    return 'extreme greed';
  }

  function classifyFearGreed(value, officialClassification) {
    const number = finite(value);
    if (number === null || number < 0 || number > 100) return null;
    const normalizedOfficial = String(officialClassification || '').trim().toLowerCase();
    const alias = CLASSIFICATION_ALIASES[String(officialClassification || '').trim()];
    const classification = CLASSIFICATIONS[normalizedOfficial] ? normalizedOfficial
      : CLASSIFICATIONS[alias] ? alias : fallbackClassification(number);
    return { value: number, official: Boolean(CLASSIFICATIONS[normalizedOfficial] || CLASSIFICATIONS[alias]), ...CLASSIFICATIONS[classification] };
  }

  function classifyMomentum(values) {
    const changes = values.map(finite).filter(value => value !== null);
    if (!changes.length) return null;
    const average = changes.reduce((sum, value) => sum + value, 0) / changes.length;
    if (average <= -8) return { label: '显著偏弱', key: 'very_weak', average, riskScore: 90, className: 'down' };
    if (average <= -2) return { label: '偏弱', key: 'weak', average, riskScore: 55, className: 'down' };
    if (average < 2) return { label: '震荡', key: 'neutral', average, riskScore: 30, className: 'neutral-text' };
    if (average < 5) return { label: '偏强', key: 'strong', average, riskScore: 45, className: 'up' };
    if (average < 8) return { label: '明显偏强', key: 'very_strong', average, riskScore: 65, className: 'up' };
    return { label: '短期过热', key: 'overheated', average, riskScore: 80, className: 'warn-text' };
  }

  function classifyValuation(value) {
    const number = finite(value);
    if (number === null || number <= 0) return null;
    if (number < 0.45) return { value: number, label: '抄底区间', key: 'bottom', riskScore: 30 };
    if (number <= 1.2) return { value: number, label: '定投区间', key: 'dca', riskScore: 25 };
    if (number <= 5) return { value: number, label: '观望区间', key: 'watch', riskScore: 50 };
    return { value: number, label: '估值过热', key: 'overheated', riskScore: 85 };
  }

  function classifyRisk(score, dimensions) {
    if (dimensions.length < 2) return { label: '数据不足', key: 'unavailable', score: null, badge: 'warn', className: '' };
    const highConfirmations = dimensions.filter(item => item.riskScore >= 75).length;
    const boundedScore = score >= 80 && highConfirmations < 2 ? 79 : score;
    if (boundedScore < 35) return { label: '低风险', key: 'low', score: boundedScore, badge: 'ok', className: 'up' };
    if (boundedScore < 60) return { label: '中等风险', key: 'medium', score: boundedScore, badge: 'warn', className: 'warn-text' };
    if (boundedScore < 80) return { label: '风险偏高', key: 'elevated', score: boundedScore, badge: 'warn', className: 'warn-text' };
    return { label: '高风险', key: 'high', score: boundedScore, badge: 'bad', className: 'down' };
  }

  function evaluate(input = {}) {
    const fearGreed = input.fearGreed || {};
    const btc = input.btc || {};
    const eth = input.eth || {};
    const ahr999 = input.ahr999 || {};
    const sentiment = fearGreed.fresh === true ? classifyFearGreed(fearGreed.value, fearGreed.classification) : null;
    const momentumValues = [btc, eth].filter(item => item.fresh === true).map(item => item.change24h);
    const momentum = classifyMomentum(momentumValues);
    const valuation = ahr999.fresh === true ? classifyValuation(ahr999.value) : null;
    const dimensions = [
      sentiment && { name: 'sentiment', weight: 0.4, riskScore: sentiment.riskScore },
      momentum && { name: 'momentum', weight: 0.4, riskScore: momentum.riskScore },
      valuation && { name: 'valuation', weight: 0.2, riskScore: valuation.riskScore }
    ].filter(Boolean);
    const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0);
    const score = totalWeight ? dimensions.reduce((sum, item) => sum + item.riskScore * item.weight, 0) / totalWeight : 0;
    return {
      sentiment,
      momentum,
      valuation,
      risk: classifyRisk(score, dimensions),
      usedIndicators: dimensions.map(item => item.name)
    };
  }

  return { classifyFearGreed, classifyMomentum, classifyValuation, evaluate };
});
