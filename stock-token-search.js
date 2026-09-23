(function installStockTokenSearch(root) {
  const normalize = value => String(value || '').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '');
  const categoryAliases = new Map([
    ['股票', 'stock_token'], ['股票代币', 'stock_token'], ['代币化股票', 'stock_token'],
    ['stocktoken', 'stock_token'], ['stocktokens', 'stock_token'],
    ['tokenizedstock', 'stock_token'], ['tokenizedstocks', 'stock_token'], ['xstocks', 'stock_token'],
    ['etf', 'etf_token'], ['etftoken', 'etf_token'], ['tokenizedetf', 'etf_token']
  ]);

  const categoryFor = query => categoryAliases.get(normalize(query)) || '';
  const symbolFields = market => [market.displaySymbol, market.symbol, market.exchangeSymbol, market.underlyingSymbol]
    .map(normalize).filter(Boolean);
  const searchable = market => [market.displaySymbol, market.symbol, market.exchangeSymbol,
    market.underlyingSymbol, market.underlyingName, market.venue, market.issuer,
    market.assetType === 'etf_token' ? 'ETF Tokenized ETF' : 'Stock Token Tokenized Stock 股票代币']
    .map(normalize).filter(Boolean);

  const matches = (market, query) => {
    const category = categoryFor(query);
    if (category) return category === 'stock_token' ? market.assetType === 'stock_token' : market.assetType === category;
    const needle = normalize(query);
    if (/^[a-z0-9.]{1,5}$/.test(needle)) return symbolFields(market).some(value => value === needle);
    return !needle || searchable(market).some(value => value.includes(needle));
  };

  const filter = (markets, query) => (Array.isArray(markets) ? markets : []).filter(market => matches(market, query));

  const search = (markets, query, limit = 40) => {
    const category = categoryFor(query);
    if (category) return [{
      candidateType: 'stock_token_category', id: `stock-token-category:${category}`,
      filter: category, name: category === 'etf_token' ? 'Tokenized ETF' : 'Stock Tokens',
      symbol: category === 'etf_token' ? 'ETF' : '股票代币'
    }];
    const needle = normalize(query);
    if (!needle) return [];
    return filter(markets, query)
      .sort((left, right) => {
        const leftExact = symbolFields(left).some(value => value === needle);
        const rightExact = symbolFields(right).some(value => value === needle);
        return Number(rightExact) - Number(leftExact)
          || String(left.underlyingSymbol).localeCompare(String(right.underlyingSymbol))
          || String(left.venue).localeCompare(String(right.venue));
      })
      .slice(0, limit)
      .map(market => ({ ...market, candidateType: 'stock_token_market', id: market.canonicalId }));
  };

  root.CryptoAIStockTokenSearch = { categoryFor, filter, matches, normalize, search };
})(globalThis);
