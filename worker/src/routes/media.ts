import type { Env } from '../types';
import { buildMediaUrls } from '../lib/media';
import { getMediaById, getMediaVariants } from '../lib/db';
import { error, parseIntSafe, ok } from '../lib/validators';

export async function handleGetMedia(request: Request, env: Env, mediaIdRaw: string): Promise<Response> {
  const mediaId = parseIntSafe(mediaIdRaw);
  if (!mediaId) return error(400, 'Invalid media id');

  const media = await getMediaById(env, mediaId);
  if (!media) return error(404, 'Media not found');

  const variants = await getMediaVariants(env, mediaId);
  const urls = buildMediaUrls({
    env,
    request,
    mediaId,
    variantNames: variants.map((variant) => variant.variant)
  });

  return ok({
    ok: true,
    media,
    variants,
    urls
  });
}

export async function handleGetMediaFile(request: Request, env: Env, mediaIdRaw: string): Promise<Response> {
  const mediaId = parseIntSafe(mediaIdRaw);
  if (!mediaId) return error(400, 'Invalid media id');

  const media = await getMediaById(env, mediaId);
  if (!media) return error(404, 'Media not found');

  const url = new URL(request.url);
  const requestedVariant = url.searchParams.get('variant') || '';

  let key = media.r2_key;
  if (requestedVariant) {
    const variant = await env.DB.prepare(
      'SELECT r2_key FROM media_variants WHERE media_id = ? AND variant = ? LIMIT 1'
    )
      .bind(mediaId, requestedVariant)
      .first<{ r2_key: string }>();

    if (variant?.r2_key) key = variant.r2_key;
  }

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return error(404, 'Media object not found in R2');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, {
    status: 200,
    headers
  });
}
