import { jsonResponse } from '../../../../_lib/session.js';

export async function onRequestGet(context) {
  const postId = String(context.params.post_id || '').trim();
  const filename = String(context.params.filename || '').trim();

  if (!postId || !filename) {
    return jsonResponse({ ok: false, error: 'post_id and filename are required' }, 400);
  }

  const match = filename.match(/^(img_[a-z0-9_]+)-?/i);
  const imageId = match?.[1];
  if (!imageId) {
    return jsonResponse({ ok: false, error: 'Invalid legacy image path' }, 404);
  }

  const target = new URL(`/posts/${postId}/images/${imageId}`, context.request.url).toString();
  return Response.redirect(target, 302);
}
