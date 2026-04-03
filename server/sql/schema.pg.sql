CREATE TABLE IF NOT EXISTS media (
  id BIGSERIAL PRIMARY KEY,
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mime_type TEXT,
  size_bytes BIGINT
);

CREATE TABLE IF NOT EXISTS media_variants (
  id BIGSERIAL PRIMARY KEY,
  media_id BIGINT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  format TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_md TEXT NOT NULL,
  content_before_md TEXT,
  content_after_md TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  cover_image_id BIGINT REFERENCES media(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ko')),
  section TEXT NOT NULL DEFAULT 'blog' CHECK (section IN ('blog', 'tools', 'games', 'pages')),
  pair_slug TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  card_title TEXT,
  card_category TEXT,
  card_tag TEXT,
  card_rank INTEGER,
  card_image_id BIGINT REFERENCES media(id) ON DELETE SET NULL,
  card_title_size TEXT DEFAULT 'auto' CHECK (card_title_size IN ('auto', 'default', 'compact', 'tight', 'ultra-tight')),
  meta_title TEXT,
  meta_description TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image_url TEXT,
  schema_type TEXT CHECK (schema_type IN ('BlogPosting', 'Service'))
);

CREATE TABLE IF NOT EXISTS tags (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_play_counts (
  game_slug TEXT NOT NULL,
  player_name TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_slug, player_name)
);

CREATE TABLE IF NOT EXISTS game_leaderboard_entries (
  id BIGSERIAL PRIMARY KEY,
  game_slug TEXT NOT NULL,
  player_name TEXT NOT NULL,
  final_place INTEGER NOT NULL CHECK (final_place >= 1),
  level_reached INTEGER NOT NULL CHECK (level_reached >= 1),
  hand_number INTEGER NOT NULL CHECK (hand_number >= 0),
  player_won BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_run_sessions (
  run_token TEXT PRIMARY KEY,
  game_slug TEXT NOT NULL,
  player_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS us_equity_daily (
  ticker TEXT NOT NULL,
  trade_date DATE NOT NULL,
  open NUMERIC(20, 6) NOT NULL,
  high NUMERIC(20, 6) NOT NULL,
  low NUMERIC(20, 6) NOT NULL,
  close NUMERIC(20, 6) NOT NULL,
  volume BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, trade_date),
  CHECK (volume >= 0)
);

CREATE TABLE IF NOT EXISTS kr_equity_daily (
  ticker TEXT NOT NULL,
  trade_date DATE NOT NULL,
  open NUMERIC(20, 6) NOT NULL,
  high NUMERIC(20, 6) NOT NULL,
  low NUMERIC(20, 6) NOT NULL,
  close NUMERIC(20, 6) NOT NULL,
  volume BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, trade_date),
  CHECK (volume >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug_lang_section_active
  ON posts(slug, lang, section)
  WHERE is_deleted = FALSE;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_before_md TEXT;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_after_md TEXT;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS card_title_size TEXT;

ALTER TABLE posts
  ALTER COLUMN card_title_size SET DEFAULT 'auto';

UPDATE posts
SET card_title_size = 'auto'
WHERE card_title_size IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_status_published_at
  ON posts(status, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_posts_lang_section_status_published
  ON posts(lang, section, status, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_posts_title
  ON posts(title);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag_post
  ON post_tags(tag_id, post_id);

CREATE INDEX IF NOT EXISTS idx_post_tags_post_tag
  ON post_tags(post_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_media_variants_media_variant
  ON media_variants(media_id, variant);

CREATE INDEX IF NOT EXISTS idx_game_leaderboard_slug_created
  ON game_leaderboard_entries(game_slug, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_game_run_sessions_slug_expires
  ON game_run_sessions(game_slug, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_run_sessions_slug_player
  ON game_run_sessions(game_slug, player_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_us_equity_daily_trade_date
  ON us_equity_daily(trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_kr_equity_daily_trade_date
  ON kr_equity_daily(trade_date DESC);
