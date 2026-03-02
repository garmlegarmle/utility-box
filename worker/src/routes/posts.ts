import type { Env, PostRecord } from '../types';
import { isAdminRequest } from '../lib/auth';
import { getPostTags, replacePostTags } from '../lib/db';
import { debugLog, requestDebugId } from '../lib/debug';
import { buildMediaUrls } from '../lib/media';
import {
  clamp,
  dedupeTags,
  error,
  normalizeLang,
  normalizeSection,
  normalizeStatus,
  nowIso,
  ok,
  parseIntSafe,
  slugify,
  toExcerpt
} from '../lib/validators';

interface PostWritePayload {
  slug?: string;
  title?: string;
  excerpt?: string;
  content_md?: string;
  status?: 'draft' | 'published' | string;
  published_at?: string | null;
  lang?: 'en' | 'ko' | string;
  section?: 'blog' | 'tools' | 'games' | 'pages' | 'tool' | 'game' | string;
  pair_slug?: string | null;
  tags?: string[] | string;
  card?: {
    title?: string;
    category?: string;
    tag?: string;
    rank?: number | string;
    image_id?: number | null;
  };
  meta?: {
    title?: string;
    description?: string;
  };
  og?: {
    title?: string;
    description?: string;
    image_url?: string;
  };
  schema_type?: 'BlogPosting' | 'Service' | string | null;
}

function resolveStatusFilter(requested: string | null, isAdmin: boolean): 'published' | 'draft' | 'all' {
  const normalized = String(requested || '').trim().toLowerCase();
  if (isAdmin && normalized === 'all') return 'all';
  if (isAdmin && normalized === 'draft') return 'draft';
  return 'published';
}

function parseDateOrNull(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseCardRank(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const asString = String(value).trim();
  const match = asString.match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapPostRow(row: PostRecord, tags: string[], env: Env, request: Request) {
  const coverUrl = row.cover_image_id
    ? buildMediaUrls({ env, request, mediaId: row.cover_image_id }).original
    : null;

  const cardImageUrl = row.card_image_id
    ? buildMediaUrls({ env, request, mediaId: row.card_image_id }).original
    : null;

  const rankValue = row.card_rank ? `#${row.card_rank}` : null;
  const resolvedOgImageUrl = row.og_image_url || cardImageUrl || coverUrl || null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content_md: row.content_md,
    status: row.status,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lang: row.lang,
    section: row.section,
    pair_slug: row.pair_slug,
    view_count: row.view_count || 0,
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
    cover: row.cover_image_id
      ? {
          id: row.cover_image_id,
          url: coverUrl
        }
      : null,
    card: {
      title: row.card_title || row.title,
      category: row.card_category || row.section,
      tag: row.card_tag || tags[0] || 'Tag',
      rank: rankValue,
      rankNumber: row.card_rank,
      imageId: row.card_image_id,
      imageUrl: cardImageUrl
    }
  };
}

async function listPosts(request: Request, env: Env): Promise<Response> {
  const reqId = requestDebugId(request);
  const isAdmin = await isAdminRequest(request, env);
  const url = new URL(request.url);

  const statusFilter = resolveStatusFilter(url.searchParams.get('status'), isAdmin);
  const lang = normalizeLang(url.searchParams.get('lang') || 'en');

  const sectionRaw = url.searchParams.get('section');
  const section = sectionRaw ? normalizeSection(sectionRaw) : null;

  const tagFilter = String(url.searchParams.get('tag') || '').trim().toLowerCase();
  const q = String(url.searchParams.get('q') || '').trim();

  const page = clamp(parseIntSafe(url.searchParams.get('page'), 1) || 1, 1, 10000);
  const limit = clamp(parseIntSafe(url.searchParams.get('limit'), 12) || 12, 1, 50);
  const offset = (page - 1) * limit;

  const where: string[] = ['p.is_deleted = 0', 'p.lang = ?'];
  const binds: unknown[] = [lang];

  if (section) {
    where.push('p.section = ?');
    binds.push(section);
  }

  if (statusFilter !== 'all') {
    where.push('p.status = ?');
    binds.push(statusFilter);
  }

  if (q) {
    where.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content_md LIKE ?)');
    const pattern = `%${q}%`;
    binds.push(pattern, pattern, pattern);
  }

  if (tagFilter) {
    where.push(
      `EXISTS (
        SELECT 1 FROM post_tags fpt
        JOIN tags ft ON ft.id = fpt.tag_id
        WHERE fpt.post_id = p.id
          AND (LOWER(ft.slug) = ? OR LOWER(ft.name) = ?)
      )`
    );
    binds.push(tagFilter, tagFilter);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = await env.DB.prepare(`SELECT COUNT(*) as total FROM posts p ${whereSql}`)
    .bind(...binds)
    .first<{ total: number }>();

  const rows = await env.DB.prepare(
    `SELECT p.*
     FROM posts p
     ${whereSql}
     ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all<PostRecord>();

  const items = [];
  for (const row of rows.results || []) {
    const tags = await getPostTags(env, row.id);
    items.push(mapPostRow(row, tags, env, request));
  }

  debugLog(env, 'posts.list', {
    reqId,
    isAdmin,
    lang,
    section: section || 'all',
    statusFilter,
    page,
    limit,
    q: Boolean(q),
    tag: tagFilter || null,
    count: items.length,
    total: Number(countRow?.total || 0)
  });

  return ok({
    ok: true,
    items,
    page,
    limit,
    total: Number(countRow?.total || 0)
  });
}

async function getPostBySlug(request: Request, env: Env, slugRaw: string): Promise<Response> {
  const reqId = requestDebugId(request);
  const isAdmin = await isAdminRequest(request, env);
  const url = new URL(request.url);

  const slug = slugify(decodeURIComponent(slugRaw));
  if (!slug) return error(400, 'Invalid slug');

  const lang = normalizeLang(url.searchParams.get('lang') || 'en');
  const sectionRaw = url.searchParams.get('section');
  const section = sectionRaw ? normalizeSection(sectionRaw) : null;

  const where: string[] = ['slug = ?', 'lang = ?', 'is_deleted = 0'];
  const binds: unknown[] = [slug, lang];

  if (section) {
    where.push('section = ?');
    binds.push(section);
  }

  if (!isAdmin) {
    where.push("status = 'published'");
  }

  const row = await env.DB.prepare(
    `SELECT *
     FROM posts
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC
     LIMIT 1`
  )
    .bind(...binds)
    .first<PostRecord>();

  if (!row) {
    debugLog(env, 'posts.detail.not_found', {
      reqId,
      isAdmin,
      slug,
      lang,
      section: section || 'all'
    });
    return error(404, 'Post not found');
  }

  const tags = await getPostTags(env, row.id);

  let updatedViewCount = row.view_count || 0;
  const responseHeaders = new Headers();

  if (!isAdmin && row.status === 'published') {
    const viewCookieName = `ub_post_view_${row.id}`;
    const cookieHeader = request.headers.get('cookie') || '';
    const alreadyViewed = cookieHeader.includes(`${viewCookieName}=1`);

    if (!alreadyViewed) {
      await env.DB.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').bind(row.id).run();
      updatedViewCount += 1;
      responseHeaders.append(
        'Set-Cookie',
        `${viewCookieName}=1; Path=/; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`
      );
    }
  }

  const media = row.cover_image_id
    ? await env.DB.prepare('SELECT * FROM media WHERE id = ? LIMIT 1').bind(row.cover_image_id).first()
    : null;

  const post = mapPostRow({ ...row, view_count: updatedViewCount }, tags, env, request);

  debugLog(env, 'posts.detail', {
    reqId,
    isAdmin,
    id: row.id,
    slug: row.slug,
    lang: row.lang,
    section: row.section,
    status: row.status,
    viewCount: updatedViewCount
  });

  return ok(
    {
      ok: true,
      post,
      tags,
      cover: post.cover,
      media: media ? [media] : []
    },
    200,
    responseHeaders
  );
}

async function parsePayload(request: Request): Promise<PostWritePayload> {
  const data = (await request.json().catch(() => null)) as PostWritePayload | null;
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid JSON payload');
  }
  return data;
}

async function createPost(request: Request, env: Env): Promise<Response> {
  const reqId = requestDebugId(request);
  const isAdmin = await isAdminRequest(request, env);
  if (!isAdmin) {
    debugLog(env, 'posts.create.denied', { reqId });
    return error(401, 'Admin authentication required');
  }

  let payload: PostWritePayload;
  try {
    payload = await parsePayload(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid payload';
    debugLog(env, 'posts.create.error', { reqId, reason: message });
    return error(400, message);
  }

  const title = String(payload.title || '').trim();
  if (!title) return error(400, 'title is required');

  const content = String(payload.content_md || '').trim();
  if (!content) return error(400, 'content_md is required');

  const lang = normalizeLang(payload.lang || 'en');
  const section = normalizeSection(payload.section || 'blog');

  const slug = slugify(String(payload.slug || title));
  if (!slug) return error(400, 'slug is invalid');

  const status = normalizeStatus(payload.status || 'draft');
  const excerpt = String(payload.excerpt || '').trim() || toExcerpt(content.replace(/[#*_`>\-\n]/g, ' '));
  const publishedAt = status === 'published' ? parseDateOrNull(payload.published_at) || nowIso() : null;

  const pairSlug = payload.pair_slug ? slugify(String(payload.pair_slug)) : null;

  const cardTitle = String(payload.card?.title || title).trim() || title;
  const cardCategory = String(payload.card?.category || section).trim() || section;
  const cardTag = String(payload.card?.tag || '').trim();
  const cardRank = parseCardRank(payload.card?.rank);
  const cardImageId = parseIntSafe(payload.card?.image_id, null);
  const metaTitle = String(payload.meta?.title || '').trim() || null;
  const metaDescription = String(payload.meta?.description || '').trim() || null;
  const ogTitle = metaTitle || title;
  const ogDescription = metaDescription || excerpt || null;
  const ogImageUrl = null;
  const schemaTypeRaw = String(payload.schema_type || '').trim();
  const schemaType = schemaTypeRaw === 'Service' || schemaTypeRaw === 'BlogPosting' ? schemaTypeRaw : null;

  const existing = await env.DB.prepare(
    'SELECT id FROM posts WHERE slug = ? AND lang = ? AND section = ? AND is_deleted = 0 LIMIT 1'
  )
    .bind(slug, lang, section)
    .first();

  if (existing) {
    debugLog(env, 'posts.create.conflict', { reqId, slug, lang, section });
    return error(409, 'Post with same slug/lang/section already exists');
  }

  const insert = await env.DB.prepare(
    `INSERT INTO posts (
      slug, title, excerpt, content_md, status, cover_image_id, published_at,
      lang, section, pair_slug, created_at, updated_at,
      card_title, card_category, card_tag, card_rank, card_image_id,
      meta_title, meta_description, og_title, og_description, og_image_url, schema_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      slug,
      title,
      excerpt,
      content,
      status,
      null,
      publishedAt,
      lang,
      section,
      pairSlug,
      nowIso(),
      nowIso(),
      cardTitle,
      cardCategory,
      cardTag || null,
      cardRank,
      cardImageId,
      metaTitle,
      metaDescription,
      ogTitle,
      ogDescription,
      ogImageUrl,
      schemaType
    )
    .run();

  const postId = Number(insert.meta.last_row_id);

  const tags = dedupeTags(payload.tags || []);
  if (tags.length > 0) {
    await replacePostTags(env, postId, tags);
  }

  debugLog(env, 'posts.create.success', {
    reqId,
    id: postId,
    slug,
    lang,
    section,
    status,
    tagsCount: tags.length
  });

  return ok({
    ok: true,
    id: postId,
    slug
  });
}

async function updatePost(request: Request, env: Env, idRaw: string): Promise<Response> {
  const reqId = requestDebugId(request);
  const isAdmin = await isAdminRequest(request, env);
  if (!isAdmin) {
    debugLog(env, 'posts.update.denied', { reqId, idRaw });
    return error(401, 'Admin authentication required');
  }

  const postId = parseIntSafe(idRaw);
  if (!postId) return error(400, 'Invalid post id');

  const current = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND is_deleted = 0 LIMIT 1')
    .bind(postId)
    .first<PostRecord>();

  if (!current) return error(404, 'Post not found');

  let payload: PostWritePayload;
  try {
    payload = await parsePayload(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid payload';
    debugLog(env, 'posts.update.error', { reqId, id: postId, reason: message });
    return error(400, message);
  }

  const title = payload.title !== undefined ? String(payload.title || '').trim() : current.title;
  if (!title) return error(400, 'title is required');

  const content = payload.content_md !== undefined ? String(payload.content_md || '').trim() : current.content_md;
  if (!content) return error(400, 'content_md is required');

  const lang = payload.lang !== undefined ? normalizeLang(payload.lang) : current.lang;
  const section = payload.section !== undefined ? normalizeSection(payload.section) : current.section;

  const slug = payload.slug !== undefined ? slugify(String(payload.slug || title)) : current.slug;
  if (!slug) return error(400, 'slug is invalid');

  const status = payload.status !== undefined ? normalizeStatus(payload.status) : current.status;
  const excerpt =
    payload.excerpt !== undefined
      ? String(payload.excerpt || '').trim() || toExcerpt(content.replace(/[#*_`>\-\n]/g, ' '))
      : current.excerpt;

  const publishedAt =
    payload.published_at !== undefined
      ? parseDateOrNull(payload.published_at)
      : status === 'published'
        ? current.published_at || nowIso()
        : null;

  const pairSlug = payload.pair_slug !== undefined ? (payload.pair_slug ? slugify(String(payload.pair_slug)) : null) : current.pair_slug;

  const cardTitle = payload.card?.title !== undefined ? String(payload.card.title || '').trim() || title : current.card_title || title;
  const cardCategory =
    payload.card?.category !== undefined
      ? String(payload.card.category || '').trim() || section
      : current.card_category || section;
  const cardTag = payload.card?.tag !== undefined ? String(payload.card.tag || '').trim() || null : current.card_tag;
  const cardRank = payload.card?.rank !== undefined ? parseCardRank(payload.card.rank) : current.card_rank;
  const cardImageId =
    payload.card?.image_id !== undefined ? parseIntSafe(payload.card.image_id, null) : current.card_image_id;
  const metaTitle = payload.meta?.title !== undefined ? String(payload.meta.title || '').trim() || null : current.meta_title;
  const metaDescription =
    payload.meta?.description !== undefined ? String(payload.meta.description || '').trim() || null : current.meta_description;
  const ogTitle = metaTitle || title;
  const ogDescription = metaDescription || excerpt || null;
  const ogImageUrl = null;
  const schemaTypeRaw = payload.schema_type !== undefined ? String(payload.schema_type || '').trim() : current.schema_type || '';
  const schemaType = schemaTypeRaw === 'Service' || schemaTypeRaw === 'BlogPosting' ? schemaTypeRaw : null;

  const existing = await env.DB.prepare(
    'SELECT id FROM posts WHERE slug = ? AND lang = ? AND section = ? AND is_deleted = 0 AND id != ? LIMIT 1'
  )
    .bind(slug, lang, section, postId)
    .first();

  if (existing) {
    debugLog(env, 'posts.update.conflict', { reqId, id: postId, slug, lang, section });
    return error(409, 'Another post with same slug/lang/section exists');
  }

  await env.DB.prepare(
    `UPDATE posts
     SET slug = ?,
         title = ?,
         excerpt = ?,
         content_md = ?,
         status = ?,
         cover_image_id = ?,
         published_at = ?,
         lang = ?,
         section = ?,
         pair_slug = ?,
         updated_at = ?,
         card_title = ?,
         card_category = ?,
         card_tag = ?,
         card_rank = ?,
         card_image_id = ?,
         meta_title = ?,
         meta_description = ?,
         og_title = ?,
         og_description = ?,
         og_image_url = ?,
         schema_type = ?
     WHERE id = ?`
  )
    .bind(
      slug,
      title,
      excerpt,
      content,
      status,
      current.cover_image_id,
      publishedAt,
      lang,
      section,
      pairSlug,
      nowIso(),
      cardTitle,
      cardCategory,
      cardTag,
      cardRank,
      cardImageId,
      metaTitle,
      metaDescription,
      ogTitle,
      ogDescription,
      ogImageUrl,
      schemaType,
      postId
    )
    .run();

  if (payload.tags !== undefined) {
    const tags = dedupeTags(payload.tags || []);
    await replacePostTags(env, postId, tags);
  }

  debugLog(env, 'posts.update.success', {
    reqId,
    id: postId,
    slug,
    lang,
    section,
    status
  });

  return ok({
    ok: true,
    id: postId,
    slug,
    section,
    lang,
    updated_at: nowIso()
  });
}

async function deletePost(request: Request, env: Env, idRaw: string): Promise<Response> {
  const reqId = requestDebugId(request);
  const isAdmin = await isAdminRequest(request, env);
  if (!isAdmin) {
    debugLog(env, 'posts.delete.denied', { reqId, idRaw });
    return error(401, 'Admin authentication required');
  }

  const postId = parseIntSafe(idRaw);
  if (!postId) return error(400, 'Invalid post id');

  const result = await env.DB.prepare(
    'UPDATE posts SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND is_deleted = 0'
  )
    .bind(nowIso(), nowIso(), postId)
    .run();

  const changed = Number(result.meta.changes || 0);
  if (!changed) {
    debugLog(env, 'posts.delete.not_found', { reqId, id: postId });
    return error(404, 'Post not found');
  }

  debugLog(env, 'posts.delete.success', { reqId, id: postId });

  return ok({ ok: true });
}

export async function handlePostsRequest(request: Request, env: Env, segments: string[]): Promise<Response> {
  const method = request.method.toUpperCase();

  if (segments.length === 0) {
    if (method === 'GET') return listPosts(request, env);
    if (method === 'POST') return createPost(request, env);
    return error(405, 'Method not allowed');
  }

  if (segments.length === 1) {
    const param = segments[0];

    if (method === 'GET') return getPostBySlug(request, env, param);
    if (method === 'PUT') return updatePost(request, env, param);
    if (method === 'DELETE') return deletePost(request, env, param);

    return error(405, 'Method not allowed');
  }

  return error(404, 'Not found');
}
