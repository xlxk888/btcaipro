CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  asset TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_detected_at ON events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_asset_type ON events(asset, event_type, detected_at DESC);

CREATE TABLE IF NOT EXISTS source_status (
  source_id TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

-- Reserved production tables. Product behavior is intentionally not implemented in AI-3.6.
CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS subscriptions (subscription_id TEXT PRIMARY KEY, user_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS watchlists (watchlist_id TEXT PRIMARY KEY, user_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS notification_preferences (preference_id TEXT PRIMARY KEY, user_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS ai_analysis (analysis_id TEXT PRIMARY KEY, event_id TEXT, analysis_version TEXT, language TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS usage (usage_id TEXT PRIMARY KEY, user_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL DEFAULT '{}');
