import { jsonResponse } from '../../../_lib/session.js';

export async function onRequestGet(context) {
  const filename = String(context.params.filename || '').trim();
  if (!filename) {
    return jsonResponse({ ok: false, error: 'filename is required' }, 400);
  }

  const match = filename.match(/^(asset_[a-z0-9_]+)-?/i);
  const assetId = match?.[1];
  if (!assetId) {
    return jsonResponse({ ok: false, error: 'Invalid legacy asset path' }, 404);
  }

  const target = new URL(`/posts/assets/${assetId}`, context.request.url).toString();
  return Response.redirect(target, 302);
}
