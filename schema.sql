CREATE TABLE IF NOT EXISTS vanity_cache (
  vanity TEXT PRIMARY KEY,
  steam_id TEXT NOT NULL,
  create_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playtime_cache (
  steam_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playtime_metrics (
  steam_id TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  game_count INTEGER NOT NULL,
  total_minutes INTEGER NOT NULL,
  average_minutes REAL NOT NULL,
  top_game_appid INTEGER,
  top_game_name TEXT,
  top_game_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS game_playtime_totals (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  total_minutes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playtime_refresh_locks (
  steam_id TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playtime_metrics_game_count
  ON playtime_metrics(game_count DESC, total_minutes DESC);
CREATE INDEX IF NOT EXISTS idx_playtime_metrics_total_minutes
  ON playtime_metrics(total_minutes DESC, game_count DESC);
CREATE INDEX IF NOT EXISTS idx_playtime_metrics_average_minutes
  ON playtime_metrics(average_minutes DESC, total_minutes DESC);
CREATE INDEX IF NOT EXISTS idx_game_playtime_totals_minutes
  ON game_playtime_totals(total_minutes DESC);
