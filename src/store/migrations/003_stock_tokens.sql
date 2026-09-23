CREATE TABLE IF NOT EXISTS stock_token_markets (
  market_id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  issuer TEXT,
  underlying_symbol TEXT,
  asset_type TEXT NOT NULL,
  market_status TEXT NOT NULL,
  price REAL,
  last_updated INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_token_underlying ON stock_token_markets(underlying_symbol, venue);
CREATE TABLE IF NOT EXISTS stock_token_state (
  provider TEXT PRIMARY KEY,
  endpoint TEXT,
  status TEXT NOT NULL,
  discovered INTEGER NOT NULL,
  last_discovery_at INTEGER,
  last_price_update_at INTEGER,
  error TEXT,
  updated_at INTEGER NOT NULL
);

