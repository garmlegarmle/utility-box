import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { nowIso, slugifyTag } from './validators.js';

const { Pool } = pg;

export function createPool(config) {
  return new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000
  });
}

export async function ensureSchema(pool) {
  const sqlPath = path.resolve(process.cwd(), 'sql/schema.pg.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

export async function ensureSeedPages(pool) {
  const pages = [
    ['about', 'About', 'About GA-ML.', '# About\n\nGA-ML provides practical tools and guides.', 'en'],
    ['contact', 'Contact', 'Contact GA-ML.', '# Contact\n\nFor inquiries, use the official contact channel.', 'en'],
    ['privacy-policy', 'Privacy Policy', 'Privacy policy details.', '# Privacy Policy\n\nWe only store data required for operating the service.', 'en'],
    ['about', '소개', 'GA-ML 소개', '# 소개\n\nGA-ML은 실용적인 도구와 가이드를 제공합니다.', 'ko'],
    ['contact', '문의하기', '문의 안내', '# 문의하기\n\n문의는 공식 채널로 보내주세요.', 'ko'],
    ['privacy-policy', '개인정보 처리방침', '개인정보 처리방침 안내', '# 개인정보 처리방침\n\n서비스 운영에 필요한 최소한의 정보만 처리합니다.', 'ko']
  ];

  for (const [slug, title, excerpt, content, lang] of pages) {
    await pool.query(
      `INSERT INTO posts (slug, title, excerpt, content_md, status, published_at, lang, section)
       VALUES ($1, $2, $3, $4, 'published', NOW(), $5, 'pages')
       ON CONFLICT DO NOTHING`,
      [slug, title, excerpt, content, lang]
    );
  }
}

async function getPublishedContentCardCount(pool, lang) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM posts
     WHERE is_deleted = FALSE
       AND status = 'published'
       AND lang = $1
       AND section IN ('blog', 'tools', 'games')`,
    [lang]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function getNextPublishedContentCardRank(pool, lang) {
  return (await getPublishedContentCardCount(pool, lang)) + 1;
}

export async function ensureSeedProgramPosts(pool) {
  const posts = [
    {
      slug: 'trend-analyzer',
      title: 'Trend Analyzer',
      excerpt: 'Upload a local OHLCV CSV and review a 200-session trend analysis with chart overlays.',
      content:
        '# Trend Analyzer\n\nUse the built-in analyzer below to upload a CSV from the data downloader and review the chart, score ranges, and interpretation.',
      lang: 'en',
      tags: ['analysis', 'trend']
    },
    {
      slug: 'trend-analyzer',
      title: '추세 분석기',
      excerpt: '로컬 OHLCV CSV를 업로드해 최근 200세션 기준 추세 분석과 차트 오버레이를 확인하세요.',
      content:
        '# 추세 분석기\n\n아래 내장 분석기에 데이터 다운로더가 만든 CSV를 업로드하면 차트, 범위형 점수, 해석 결과를 확인할 수 있습니다.',
      lang: 'ko',
      tags: ['분석', '추세']
    }
  ];

  for (const item of posts) {
    const nextRank = await getNextPublishedContentCardRank(pool, item.lang);
    const inserted = await pool.query(
      `INSERT INTO posts (
         slug, title, excerpt, content_md, status, published_at, lang, section,
         card_title, card_category, card_rank, schema_type
       )
       VALUES ($1, $2, $3, $4, 'published', NOW(), $5, 'tools', $2, 'tools', $6, 'Service')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [item.slug, item.title, item.excerpt, item.content, item.lang, nextRank]
    );

    const postId = inserted.rows[0]?.id ? Number(inserted.rows[0].id) : 0;
    if (postId > 0 && item.tags.length > 0) {
      await replacePostTags(pool, postId, item.tags);
      continue;
    }

    const existing = await pool.query(
      `SELECT id, card_rank
       FROM posts
       WHERE slug = $1 AND lang = $2 AND section = 'tools' AND is_deleted = FALSE
       LIMIT 1`,
      [item.slug, item.lang]
    );
    const existingPost = existing.rows[0];
    if (existingPost?.id && Number(existingPost.card_rank || 0) === 1) {
      const total = await getPublishedContentCardCount(pool, item.lang);
      if (total > 1) {
        await pool.query('UPDATE posts SET card_rank = $1, updated_at = NOW() WHERE id = $2', [total, Number(existingPost.id)]);
      }
    }
  }
}

export async function normalizeDerivedPostCardFields(pool) {
  await pool.query(
    `WITH tag_lists AS (
      SELECT p.id AS post_id, NULLIF(string_agg(t.name, ', ' ORDER BY LOWER(t.name)), '') AS card_tag
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.is_deleted = FALSE
      GROUP BY p.id
    )
    UPDATE posts p
    SET
      card_title = p.title,
      card_tag = tag_lists.card_tag,
      updated_at = CASE
        WHEN p.card_title IS DISTINCT FROM p.title OR p.card_tag IS DISTINCT FROM tag_lists.card_tag THEN NOW()
        ELSE p.updated_at
      END
    FROM tag_lists
    WHERE p.id = tag_lists.post_id
      AND (p.card_title IS DISTINCT FROM p.title OR p.card_tag IS DISTINCT FROM tag_lists.card_tag)`
  );
}

export async function getAppSetting(pool, key) {
  const result = await pool.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [key]);
  return result.rows[0]?.value || null;
}

export async function setAppSetting(pool, key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

export async function upsertTags(pool, tags) {
  const out = [];
  for (const tag of tags) {
    const name = String(tag || '').trim();
    if (!name) continue;
    const slug = slugifyTag(name);
    if (!slug) continue;
    await pool.query(
      `INSERT INTO tags (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      [name, slug]
    );
    const found = await pool.query('SELECT id FROM tags WHERE slug = $1 LIMIT 1', [slug]);
    if (found.rows[0]?.id) out.push(Number(found.rows[0].id));
  }
  return out;
}

export async function replacePostTags(pool, postId, tags) {
  const tagIds = await upsertTags(pool, tags);
  await pool.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);
  for (const tagId of tagIds) {
    await pool.query(
      'INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [postId, tagId]
    );
  }
}

export async function getPostTags(pool, postId) {
  const rows = await pool.query(
    `SELECT t.name
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = $1
     ORDER BY LOWER(t.name) ASC`,
    [postId]
  );
  return rows.rows.map((row) => row.name);
}

export async function getPostTagsMap(pool, postIds) {
  const ids = postIds.filter((id) => Number.isFinite(id) && id > 0);
  const out = new Map();
  if (!ids.length) return out;
  const rows = await pool.query(
    `SELECT pt.post_id AS post_id, t.name AS name
     FROM post_tags pt
     INNER JOIN tags t ON t.id = pt.tag_id
     WHERE pt.post_id = ANY($1::bigint[])
     ORDER BY LOWER(t.name) ASC`,
    [ids]
  );
  for (const row of rows.rows) {
    const key = Number(row.post_id);
    const list = out.get(key) || [];
    list.push(String(row.name || '').trim());
    out.set(key, list);
  }
  return out;
}

export async function listDistinctTags(pool, { lang, publishedOnly = false }) {
  const binds = [];
  const where = ['p.is_deleted = FALSE'];
  if (lang) {
    binds.push(lang);
    where.push(`p.lang = $${binds.length}`);
  }
  if (publishedOnly) {
    where.push(`p.status = 'published'`);
  }
  const rows = await pool.query(
    `SELECT name
     FROM (
       SELECT DISTINCT t.name AS name
       FROM tags t
       INNER JOIN post_tags pt ON pt.tag_id = t.id
       INNER JOIN posts p ON p.id = pt.post_id
       WHERE ${where.join(' AND ')}
     ) tag_names
     ORDER BY LOWER(name) ASC`,
    binds
  );
  return rows.rows.map((row) => String(row.name || '').trim()).filter(Boolean);
}

export async function listTagCountsBySection(pool, { lang, section, publishedOnly = false }) {
  const binds = [lang, section];
  const where = ['p.is_deleted = FALSE', 'p.lang = $1', 'p.section = $2'];
  if (publishedOnly) where.push(`p.status = 'published'`);
  const rows = await pool.query(
    `SELECT t.name AS name, COUNT(*)::int AS count
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     INNER JOIN posts p ON p.id = pt.post_id
     WHERE ${where.join(' AND ')}
     GROUP BY t.id, t.name
     ORDER BY LOWER(t.name) ASC`,
    binds
  );
  return rows.rows.map((row) => ({ name: row.name, count: Number(row.count || 0) }));
}

export async function getMediaById(pool, mediaId) {
  const rows = await pool.query('SELECT * FROM media WHERE id = $1 LIMIT 1', [mediaId]);
  return rows.rows[0] || null;
}

export async function getMediaVariants(pool, mediaId) {
  const rows = await pool.query('SELECT * FROM media_variants WHERE media_id = $1 ORDER BY id ASC', [mediaId]);
  return rows.rows;
}

function requestOrigin(request, publicOrigin = '') {
  if (publicOrigin) {
    return { origin: publicOrigin };
  }
  const forwardedProto = String(request.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(request.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || request.protocol;
  const host = forwardedHost || request.get('host');
  return { origin: `${protocol}://${host}` };
}

export function mapPostRow(row, tags, request, publicOrigin = '') {
  const { origin } = requestOrigin(request, publicOrigin);
  const coverUrl = row.cover_image_id ? `${origin}/api/media/${row.cover_image_id}/file` : null;
  const cardImageUrl = row.card_image_id ? `${origin}/api/media/${row.card_image_id}/file` : null;
  const rankValue = row.card_rank ? `#${row.card_rank}` : null;
  const resolvedOgImageUrl = row.og_image_url || cardImageUrl || coverUrl || null;
  const joinedTags = tags.map((tag) => String(tag || '').trim()).filter(Boolean).join(', ');
  const storedCardTag = String(row.card_tag || '').trim();
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content_md: row.content_md,
    content_before_md: row.content_before_md || null,
    content_after_md: row.content_after_md || null,
    status: row.status,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    lang: row.lang,
    section: row.section,
    pair_slug: row.pair_slug,
    view_count: Number(row.view_count || 0),
    tags,
    meta: {
      title: row.meta_title || null,
      description: row.meta_description || null
    },
    og: {
      title: row.og_title || row.meta_title || row.title || null,
      description: row.og_description || row.meta_description || row.excerpt || null,
      imageUrl: resolvedOgImageUrl
    },
    schemaType: row.schema_type || null,
    cover: row.cover_image_id ? { id: Number(row.cover_image_id), url: coverUrl } : null,
    card: {
      title: row.card_title || row.title,
      category: row.card_category || row.section,
      tag: storedCardTag && storedCardTag.toLowerCase() !== 'tag' ? storedCardTag : joinedTags || 'Tag',
      rank: rankValue,
      rankNumber: row.card_rank ? Number(row.card_rank) : null,
      imageId: row.card_image_id ? Number(row.card_image_id) : null,
      imageUrl: cardImageUrl
    }
  };
}

export async function touchViewCount(pool, postId) {
  await pool.query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [postId]);
}

export async function softDeletePost(pool, postId) {
  return pool.query(
    'UPDATE posts SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND is_deleted = FALSE',
    [postId]
  );
}

export async function cleanupUnusedTag(pool, tagId) {
  const remains = await pool.query('SELECT COUNT(*)::int AS count FROM post_tags WHERE tag_id = $1', [tagId]);
  if (!Number(remains.rows[0]?.count || 0)) {
    await pool.query('DELETE FROM tags WHERE id = $1', [tagId]);
  }
}

export function nowDb() {
  return nowIso();
}
