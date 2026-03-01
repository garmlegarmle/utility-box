PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mime_type TEXT,
  size_bytes INTEGER
);

CREATE TABLE IF NOT EXISTS media_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL,
  variant TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  format TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_md TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  cover_image_id INTEGER,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ko')),
  section TEXT NOT NULL DEFAULT 'blog' CHECK (section IN ('blog', 'tools', 'games', 'pages')),
  pair_slug TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  card_title TEXT,
  card_category TEXT,
  card_tag TEXT,
  card_rank INTEGER,
  card_image_id INTEGER,
  meta_title TEXT,
  meta_description TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image_url TEXT,
  schema_type TEXT CHECK (schema_type IN ('BlogPosting', 'Service')),
  FOREIGN KEY (cover_image_id) REFERENCES media(id) ON DELETE SET NULL,
  FOREIGN KEY (card_image_id) REFERENCES media(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug_lang_section_active
  ON posts(slug, lang, section)
  WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_posts_status_published_at
  ON posts(status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_lang_section_status_published
  ON posts(lang, section, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_title
  ON posts(title);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug
  ON tags(slug);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag_post
  ON post_tags(tag_id, post_id);

CREATE INDEX IF NOT EXISTS idx_post_tags_post_tag
  ON post_tags(post_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_media_variants_media_variant
  ON media_variants(media_id, variant);
