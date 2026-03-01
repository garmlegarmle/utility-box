import type { Env } from '../types';
import { isAdminRequest } from '../lib/auth';
import { listDistinctTags, listTagCountsBySection } from '../lib/db';
import { debugLog, requestDebugId } from '../lib/debug';
import { error, normalizeLang, normalizeSection, ok, slugify } from '../lib/validators';

async function handleListTags(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const langRaw = String(url.searchParams.get('lang') || '').trim();
  const sectionRaw = String(url.searchParams.get('section') || '').trim();
  const includeCounts = String(url.searchParams.get('counts') || '').trim() === '1';

  const lang = langRaw ? normalizeLang(langRaw) : normalizeLang('en');
  const section = sectionRaw ? normalizeSection(sectionRaw) : undefined;
  const isAdmin = await isAdminRequest(request, env);
  const publishedOnly = !isAdmin;

  if (includeCounts && section) {
    const items = await listTagCountsBySection(env, {
      lang,
      section,
      publishedOnly
    });

    debugLog(env, 'tags.list.counts', {
      reqId: requestDebugId(request),
      lang,
      section,
      publishedOnly,
      count: items.length
    });

    return ok({
      ok: true,
      items
    });
  }

  const items = await listDistinctTags(env, {
    lang,
    publishedOnly
  });

  debugLog(env, 'tags.list', {
    reqId: requestDebugId(request),
    lang,
    section: section || 'all',
    publishedOnly,
    count: items.length
  });

  return ok({
    ok: true,
    items
  });
}

async function handleDeleteTag(request: Request, env: Env, tagParam: string): Promise<Response> {
  const isAdmin = await isAdminRequest(request, env);
  if (!isAdmin) return error(401, 'Admin authentication required');

  const raw = decodeURIComponent(tagParam || '');
  const targetSlug = slugify(raw);
  if (!targetSlug) return error(400, 'Invalid tag');
  const url = new URL(request.url);
  const lang = normalizeLang(url.searchParams.get('lang') || 'en');

  const tag = await env.DB.prepare('SELECT id, name, slug FROM tags WHERE slug = ? LIMIT 1').bind(targetSlug).first<{
    id: number;
    name: string;
    slug: string;
  }>();

  if (!tag) return error(404, 'Tag not found');

  await env.DB.prepare(
    `DELETE FROM post_tags
     WHERE tag_id = ?
       AND post_id IN (
         SELECT id FROM posts WHERE lang = ? AND is_deleted = 0
       )`
  )
    .bind(tag.id, lang)
    .run();

  const remains = await env.DB.prepare('SELECT COUNT(*) as count FROM post_tags WHERE tag_id = ?').bind(tag.id).first<{ count: number }>();
  if (!Number(remains?.count || 0)) {
    await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tag.id).run();
  }

  debugLog(env, 'tags.delete', {
    reqId: requestDebugId(request),
    lang,
    tag: tag.name,
    slug: tag.slug
  });

  return ok({
    ok: true,
    deleted: {
      id: tag.id,
      name: tag.name,
      slug: tag.slug
    }
  });
}

export async function handleTagsRequest(request: Request, env: Env, segments: string[]): Promise<Response> {
  const method = request.method.toUpperCase();

  if (segments.length === 0) {
    if (method === 'GET') return handleListTags(request, env);
    return error(405, 'Method not allowed');
  }

  if (segments.length === 1) {
    if (method === 'DELETE') return handleDeleteTag(request, env, segments[0]);
    return error(405, 'Method not allowed');
  }

  return error(404, 'Not found');
}
