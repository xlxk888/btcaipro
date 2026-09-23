CREATE TABLE IF NOT EXISTS stock_token_markets (
  market_id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  issuer TEXT,
  underlying_symbol TEXT,
  asset_type TEXT NOT NULL,
  market_status TEXT NOT NULL,
  price DOUBLE PRECISION,
  last_updated BIGINT NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_token_underlying ON stock_token_markets(underlying_symbol, venue);
CREATE TABLE IF NOT EXISTS stock_token_state (
  provider TEXT PRIMARY KEY,
  endpoint TEXT,
  status TEXT NOT NULL,
  discovered INTEGER NOT NULL,
  last_discovery_at BIGINT,
  last_price_update_at BIGINT,
  error JSONB,
  updated_at BIGINT NOT NULL
);

