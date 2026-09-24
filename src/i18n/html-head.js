const SITE = 'https://www.btcaipro.com';

const COPY = Object.freeze({
  dashboard: {
    zh: {
      title: 'Crypto AI｜加密市场智能仪表盘',
      description: '查看加密市场行情、市场雷达、自选列表、股票代币、宏观数据与 BTC 工具。'
    },
    en: {
      title: 'Crypto AI | Crypto Market Intelligence Dashboard',
      description: 'Crypto market data, market radar, watchlists, stock tokens, macro markets, and BTC tools.'
    }
  },
  sources: {
    zh: {
      title: '数据与计算说明 · Crypto AI',
      description: 'Crypto AI 数据来源、计算方法与可信度说明。'
    },
    en: {
      title: 'Sources & Methodology | Crypto AI',
      description: 'Data sources, calculation methods, freshness, and confidence rules for the Crypto AI dashboard.'
    }
  }
});

export function localizeHtmlHead(html, { locale, page = 'dashboard' }) {
  if (!['zh', 'en'].includes(locale) || !COPY[page]) return html;
  const { title, description } = COPY[page][locale];
  const suffix = page === 'sources' ? '/sources' : '';
  const canonical = `${SITE}/${locale}${suffix}`;
  const content = (source, marker, value) => source.replace(
    new RegExp(`(<meta\\s+${marker}\\s+content=")[^"]*(")`, 'i'),
    (_, before, after) => `${before}${value}${after}`
  );
  let output = html.replace(/<html lang="[^"]*">/i, `<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/i, (_, before, after) => `${before}${canonical}${after}`);
  output = content(output, 'name="description"', description);
  output = content(output, 'property="og:title"', title);
  output = content(output, 'property="og:description"', description);
  output = content(output, 'property="og:url"', canonical);
  output = content(output, 'name="twitter:title"', title);
  output = content(output, 'name="twitter:description"', description);
  return output;
}
