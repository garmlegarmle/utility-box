-- One-time cleanup for legacy imported sample posts.
-- Scope: blog/tools/games only. pages are excluded intentionally.

PRAGMA foreign_keys = ON;

-- 1) Pre-check: how many candidate rows exist.
WITH targets(section, lang, slug) AS (
  VALUES
    ('blog',  'en', 'a'),
    ('blog',  'en', 'dsfasfda'),
    ('blog',  'en', 'test'),
    ('blog',  'en', 'hanvaunboja'),
    ('blog',  'en', 'editorial-grid-cms-workflow'),
    ('blog',  'en', 'rebuilding-with-astro-mdx-decap'),
    ('blog',  'ko', 'editorial-grid-cms-workflow'),
    ('blog',  'ko', 'rebuilding-with-astro-mdx-decap'),
    ('tools', 'en', 'a'),
    ('tools', 'en', 'hello'),
    ('tools', 'en', 'regex-playground'),
    ('tools', 'en', 'compound-interest-calculator'),
    ('tools', 'ko', 'regex-playground'),
    ('games', 'en', 'reaction-timer'),
    ('games', 'en', 'word-grid'),
    ('games', 'ko', 'reaction-timer'),
    ('games', 'ko', 'word-grid')
)
SELECT p.id, p.section, p.lang, p.slug, p.title, p.created_at
FROM posts p
JOIN targets t
  ON t.section = p.section
 AND t.lang = p.lang
 AND t.slug = p.slug
WHERE p.is_deleted = 0
ORDER BY p.section, p.lang, p.slug, p.id;

-- 2) Hard delete legacy targets.
WITH targets(section, lang, slug) AS (
  VALUES
    ('blog',  'en', 'a'),
    ('blog',  'en', 'dsfasfda'),
    ('blog',  'en', 'test'),
    ('blog',  'en', 'hanvaunboja'),
    ('blog',  'en', 'editorial-grid-cms-workflow'),
    ('blog',  'en', 'rebuilding-with-astro-mdx-decap'),
    ('blog',  'ko', 'editorial-grid-cms-workflow'),
    ('blog',  'ko', 'rebuilding-with-astro-mdx-decap'),
    ('tools', 'en', 'a'),
    ('tools', 'en', 'hello'),
    ('tools', 'en', 'regex-playground'),
    ('tools', 'en', 'compound-interest-calculator'),
    ('tools', 'ko', 'regex-playground'),
    ('games', 'en', 'reaction-timer'),
    ('games', 'en', 'word-grid'),
    ('games', 'ko', 'reaction-timer'),
    ('games', 'ko', 'word-grid')
)
DELETE FROM posts
WHERE id IN (
  SELECT p.id
  FROM posts p
  JOIN targets t
    ON t.section = p.section
   AND t.lang = p.lang
   AND t.slug = p.slug
);

-- 3) Post-check: target rows must be zero.
WITH targets(section, lang, slug) AS (
  VALUES
    ('blog',  'en', 'a'),
    ('blog',  'en', 'dsfasfda'),
    ('blog',  'en', 'test'),
    ('blog',  'en', 'hanvaunboja'),
    ('blog',  'en', 'editorial-grid-cms-workflow'),
    ('blog',  'en', 'rebuilding-with-astro-mdx-decap'),
    ('blog',  'ko', 'editorial-grid-cms-workflow'),
    ('blog',  'ko', 'rebuilding-with-astro-mdx-decap'),
    ('tools', 'en', 'a'),
    ('tools', 'en', 'hello'),
    ('tools', 'en', 'regex-playground'),
    ('tools', 'en', 'compound-interest-calculator'),
    ('tools', 'ko', 'regex-playground'),
    ('games', 'en', 'reaction-timer'),
    ('games', 'en', 'word-grid'),
    ('games', 'ko', 'reaction-timer'),
    ('games', 'ko', 'word-grid')
)
SELECT COUNT(*) AS remaining_legacy_rows
FROM posts p
JOIN targets t
  ON t.section = p.section
 AND t.lang = p.lang
 AND t.slug = p.slug;

