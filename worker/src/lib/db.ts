import type { Env } from '../types';
import { slugify } from './validators';

export interface MediaRecord {
  id: number;
  r2_key: string;
  kind: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  created_at: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface VariantRecord {
  id: number;
  media_id: number;
  variant: string;
  r2_key: string;
  width: number | null;
  height: number | null;
  format: string | null;
  created_at: string;
}

export async function upsertTags(env: Env, tags: string[]): Promise<number[]> {
  const out: number[] = [];

  for (const tag of tags) {
    const name = tag.trim();
    if (!name) continue;
    const slug = slugify(name);
    if (!slug) continue;

    await env.DB.prepare(
      `INSERT INTO tags (name, slug)
       VALUES (?, ?)
       ON CONFLICT(slug) DO UPDATE SET name = excluded.name`
    )
      .bind(name, slug)
      .run();

    const found = await env.DB.prepare('SELECT id FROM tags WHERE slug = ? LIMIT 1').bind(slug).first<{ id: number }>();
    if (found?.id) out.push(found.id);
  }

  return out;
}

export async function replacePostTags(env: Env, postId: number, tags: string[]): Promise<void> {
  const tagIds = await upsertTags(env, tags);

  await env.DB.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(postId).run();

  for (const tagId of tagIds) {
    await env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(postId, tagId).run();
  }
}

export async function getPostTags(env: Env, postId: number): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT t.name
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = ?
     ORDER BY t.name ASC`
  )
    .bind(postId)
    .all<{ name: string }>();

  return (rows.results || []).map((row) => row.name);
}

export async function listDistinctTags(
  env: Env,
  options?: { lang?: 'en' | 'ko'; publishedOnly?: boolean }
): Promise<string[]> {
  const where: string[] = ['p.is_deleted = 0'];
  const binds: unknown[] = [];

  if (options?.lang) {
    where.push('p.lang = ?');
    binds.push(options.lang);
  }

  if (options?.publishedOnly) {
    where.push("p.status = 'published'");
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await env.DB.prepare(
    `SELECT DISTINCT t.name AS name
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     INNER JOIN posts p ON p.id = pt.post_id
     ${whereSql}
     ORDER BY LOWER(t.name) ASC`
  )
    .bind(...binds)
    .all<{ name: string }>();

  return (rows.results || []).map((row) => String(row.name || '').trim()).filter(Boolean);
}

export async function listTagCountsBySection(
  env: Env,
  options: {
    lang: 'en' | 'ko';
    section: 'blog' | 'tools' | 'games' | 'pages';
    publishedOnly?: boolean;
  }
): Promise<Array<{ name: string; count: number }>> {
  const where: string[] = ['p.is_deleted = 0', 'p.lang = ?'];
  const binds: unknown[] = [options.section, options.lang];

  if (options.publishedOnly) {
    where.push("p.status = 'published'");
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const rows = await env.DB.prepare(
    `SELECT
       t.name AS name,
       SUM(CASE WHEN p.section = ? THEN 1 ELSE 0 END) AS count
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     INNER JOIN posts p ON p.id = pt.post_id
     ${whereSql}
     GROUP BY t.id, t.name
     ORDER BY LOWER(t.name) ASC`
  )
    .bind(...binds)
    .all<{ name: string; count: number | string | null }>();

  return (rows.results || [])
    .map((row) => ({
      name: String(row.name || '').trim(),
      count: Number(row.count || 0)
    }))
    .filter((row) => Boolean(row.name));
}

export async function getMediaById(env: Env, mediaId: number): Promise<MediaRecord | null> {
  const media = await env.DB.prepare('SELECT * FROM media WHERE id = ? LIMIT 1').bind(mediaId).first<MediaRecord>();
  return media || null;
}

export async function getMediaVariants(env: Env, mediaId: number): Promise<VariantRecord[]> {
  const rows = await env.DB.prepare('SELECT * FROM media_variants WHERE media_id = ? ORDER BY id ASC')
    .bind(mediaId)
    .all<VariantRecord>();
  return rows.results || [];
}
