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

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug_lang_section_active
  ON posts(slug, lang, section)
  WHERE is_deleted = FALSE;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_before_md TEXT;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_after_md TEXT;

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
