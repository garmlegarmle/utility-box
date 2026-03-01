import type { Env } from '../types';
import { isAdminRequest } from '../lib/auth';
import { listDistinctTags, listTagCountsBySection } from '../lib/db';
import { debugLog, requestDebugId } from '../lib/debug';
import { normalizeLang, normalizeSection, ok } from '../lib/validators';

export async function handleListTags(request: Request, env: Env): Promise<Response> {
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
