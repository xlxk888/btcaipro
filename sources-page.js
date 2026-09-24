(function initSourcesPage() {
  const i18n = window.CryptoAIi18n;
  const table = document.querySelector('table');
  const headings = [...table.querySelectorAll('thead th')];
  const cells = [...table.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')]);
  const cards = [...document.querySelectorAll('section.card')];
  const legend = [...cards[0].querySelectorAll('.tag')];
  const zh = {
    headings: headings.map(node => node.textContent),
    cells: cells.map(row => row.map(node => node.textContent)),
    cards: cards.map(card => ({ title: card.querySelector('h2').textContent, note: card.querySelector('.note')?.textContent || '' })),
    legend: legend.map(node => node.textContent)
  };
  const en = {
    title: 'Data & Information Sources',
    subtitle: 'Primary sources, backups, freshness, confidence, and local calculations used by Crypto AI.',
    back: 'Back to Dashboard',
    description: 'Data sources, calculation methods, freshness, and confidence rules for the Crypto AI dashboard.',
    headings: ['Metric', 'Primary Source', 'Backup Source', 'Refresh', 'Live', 'Estimated', 'Method', 'Stale Threshold', 'Confidence Rule'],
    cards: [
      { title: 'Source Status Rules', note: 'The red error count includes only sources whose failures prevent users from obtaining trusted data. Confidence is an explainable rule level, not a statistical probability.' },
      { title: 'Metric Catalog', note: '' },
      { title: 'Supported Chains', note: 'Ethereum, BNB Smart Chain, Arbitrum One, Base, Polygon, Avalanche C-Chain, Robinhood Chain, Hyperliquid / HyperEVM, Solana, Tron, and Bitcoin are supported. Robinhood Chain uses its public official RPC (chainId 4663), which may rate limit. HyperEVM uses its official mainnet RPC (chainId 999). When DEX Screener has no pool or has not indexed one, price and market cap are unavailable. DEX Screener FDV is never treated as circulating market cap.' },
      { title: 'Calculation Limits', note: 'Data time (dataTime) and receipt time (receivedAt) are tracked separately. A backup source does not necessarily mean failure: usable backup data is marked as degraded rather than a red error. Miner profit excludes pool fees, operations, downtime, taxes, and depreciation. This is not investment advice.' }
    ],
    legend: ['HEALTHY Primary source working', 'FALLBACK Usable backup data; no red error', 'STALE Beyond metric threshold', 'DISABLED Explicitly off; no error', 'ERROR / UNAVAILABLE Primary and backup unavailable'],
    cells: [
      ['BTC / ETH quotes, 24h change, volume', 'Binance WS / REST', 'OKX → CoinGecko', 'Push / 30s', 'Yes', 'No', 'Raw exchange values; backup source remains identified', '45s / 2m / 5m', 'Fresh primary: high; backup: medium; stale: low'],
      ['Circulating market cap', 'CoinGecko supply / market data', 'CoinPaprika → CoinLore with verified asset IDs; latest successful value within 30 minutes', 'Low frequency', 'No', 'Sometimes', 'Provider circulating cap, or price × known circulating supply; FDV excluded', '30m', 'Complete provider data: medium/high; estimate: medium'],
      ['Watchlist identity and logos', 'Built-in canonical ID map; CoinGecko image for the matching ID', 'Symbol initials if image is unavailable', 'On add / cap polling', 'No', 'No', 'Symbols are search inputs only. HYPE maps specifically to Hyperliquid; unknown tickers are never guessed.', 'Follows source', 'Known mapping: high; unknown symbol is never added automatically'],
      ['Multichain token identity and quotes', 'Selected chain RPC / Solana Mint; DEX Screener', 'No quote shown without a reliable pool', 'On add / 10s', 'Depends on pool', 'No', 'Chain ID plus contract/Mint address is the identity. EVM reads name, symbol, decimals; Solana verifies Mint; Tron validates address only; Bitcoin supports native BTC only.', 'Quote polling', 'On-chain verification and market source details are marked separately'],
      ['Fear & Greed', 'Alternative.me', 'None; no fabricated default', '1h', 'No, daily index', 'No', 'Provider index', '36h', 'Fresh: high; expired: low'],
      ['AHR999', 'Binance daily candles + BTC quote', 'None', '1h', 'No', 'Yes', 'ahr999_geom200_power_fit_v1', '36h', 'Complete, fresh inputs: medium; always marked as a local estimate'],
      ['U.S. stocks', 'Tencent Market Data public quotes', 'Last successful value', '60s', 'Near live during market hours', 'No', 'Provider quote', '3m; market closure follows trading calendar meaning', 'Valid quote: medium; stale: low'],
      ['Global markets / FX', 'Tencent Market Data / public markets', 'Last successful value', '30s', 'Varies by metric', 'Some', 'Proxy instruments are labeled explicitly', '2m–24h', 'Direct quote: medium/high; proxy/estimate: medium'],
      ['DXY', 'Public market proxy', 'None', 'Low frequency', 'No', 'Yes', 'Proxy instrument; never represented as the official ICE index', '24h', 'Estimate: medium or low'],
      ['US10Y', 'U.S. Treasury / market quotes', 'Last successful value', '10m', 'No', 'No', 'Public yield', '24h', 'Government source: high; market backup: medium'],
      ['VIX', 'Cboe / market quotes', 'Last successful value', '10m', 'Depends on market hours', 'No', 'Provider index', '24h', 'Official: high; backup: medium'],
      ['BTC block height / difficulty / hashrate / reward', 'mempool.space', 'Halving height: Blockstream Esplora → last successful cache', '10m', 'Near live', 'Hashrate is a window estimate', 'Public network data; halving time estimated locally', '60m', 'Fresh: high; backup/cache: medium/low'],
      ['Miner specifications', 'Official Bitmain / MicroBT / Canaan / Bitdeer materials', 'Unverified catalog records', 'Versioned updates', 'N/A', 'No', 'Crypto AI Miner Catalog', '365d review', 'Verified: high; unverified: low and visibly marked'],
      ['Miner profit / shutdown price', 'Local calculation', 'None', 'With quote/difficulty', 'Derived', 'Yes', 'difficulty_probability_v1; expected BTC/day × BTC price − electricity', 'Oldest input', 'Lowest confidence among inputs'],
      ['BTC holdings', 'On-chain addresses / company disclosures / ETF disclosures', 'Latest verified snapshot', 'By category', 'On-chain category near live', 'Category D only', 'A/B/C/D definitions kept separate; overlapping holdings cannot be added together', 'Disclosure cycle', 'A on-chain: high; B/C disclosure: medium/high; D estimate: low'],
      ['Derivatives OI / funding', 'Binance Futures', 'Future extension', '60s', 'Near live', 'No', 'Raw exchange values', '3m', 'Fresh: high; expired: low'],
      ['Liquidations', 'Disabled', 'None', '—', 'No', 'No', 'No synthesized or fabricated values', '—', 'Disabled; excluded from red error count']
    ]
  };
  if (en.cells.length !== cells.length || en.cells.some((row, index) => row.length !== cells[index].length)) throw new Error('Sources locale table mismatch');

  function render() {
    const english = i18n.getLocale() === 'en-US';
    const content = english ? en : zh;
    document.documentElement.lang = english ? 'en' : 'zh-CN';
    document.title = english ? 'Sources & Methodology | Crypto AI' : '数据与计算说明 · Crypto AI';
    document.querySelector('meta[name="description"]').content = english ? en.description : 'Crypto AI 数据来源、计算方法与可信度说明。';
    for (const key of ['title', 'subtitle', 'back']) {
      const node = document.querySelector(`[data-source-text="${key}"]`);
      node.textContent = english ? en[key] : { title: '数据与信息来源', subtitle: 'Crypto AI 的主源、fallback、新鲜度、置信度与本地计算口径。', back: '返回仪表盘' }[key];
    }
    document.querySelector('.back').href = i18n.localePath(i18n.getLocale(), '/');
    document.querySelector('.language-switch').setAttribute('aria-label', english ? 'Switch language' : '切换语言');
    for (const button of document.querySelectorAll('[data-locale]')) button.setAttribute('aria-pressed', String(button.dataset.locale === i18n.getLocale()));
    headings.forEach((node, index) => { node.textContent = content.headings[index]; });
    cells.forEach((row, rowIndex) => row.forEach((node, cellIndex) => { node.textContent = content.cells[rowIndex][cellIndex]; }));
    cards.forEach((card, index) => {
      card.querySelector('h2').textContent = content.cards[index].title;
      const note = card.querySelector('.note');
      if (note) note.textContent = content.cards[index].note;
    });
    legend.forEach((node, index) => { node.textContent = content.legend[index]; });
  }
  i18n.initRoute();
  i18n.onChange(render);
  for (const button of document.querySelectorAll('[data-locale]')) button.addEventListener('click', () => i18n.setLocale(button.dataset.locale));
  render();
})();
