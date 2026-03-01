import type { Env } from '../types';
import { listDistinctTags } from '../lib/db';
import { debugLog, requestDebugId } from '../lib/debug';
import { normalizeLang, normalizeSection, ok } from '../lib/validators';

export async function handleListTags(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const langRaw = String(url.searchParams.get('lang') || '').trim();
  const sectionRaw = String(url.searchParams.get('section') || '').trim();

  const lang = langRaw ? normalizeLang(langRaw) : undefined;
  const section = sectionRaw ? normalizeSection(sectionRaw) : undefined;

  const items = await listDistinctTags(env, {
    lang,
    section
  });

  debugLog(env, 'tags.list', {
    reqId: requestDebugId(request),
    lang: lang || 'all',
    section: section || 'all',
    count: items.length
  });

  return ok({
    ok: true,
    items
  });
}
