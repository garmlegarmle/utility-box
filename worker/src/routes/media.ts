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
  const raw = url.searchParams.get('raw') === '1';

  let key = media.r2_key;
  let variantWidth: number | null = null;
  let variantFormat: string | null = null;
  if (requestedVariant) {
    const variant = await env.DB.prepare(
      'SELECT r2_key, width, format FROM media_variants WHERE media_id = ? AND variant = ? LIMIT 1'
    )
      .bind(mediaId, requestedVariant)
      .first<{ r2_key: string; width: number | null; format: string | null }>();

    if (variant?.r2_key) {
      key = variant.r2_key;
      variantWidth = variant.width ?? null;
      variantFormat = variant.format ?? null;
    }
  }

  // Delivery-time image transform fallback.
  // We transform only when explicitly asking for a variant and not in raw mode.
  if (!raw && requestedVariant && media.kind === 'image') {
    const rawUrl = new URL(request.url);
    rawUrl.searchParams.delete('variant');
    rawUrl.searchParams.set('raw', '1');

    const transformed = await fetch(rawUrl.toString(), {
      cf: {
        image: {
          fit: 'scale-down',
          width: variantWidth || undefined,
          format: variantFormat === 'webp' ? 'webp' : undefined
        }
      }
    } as RequestInit);

    if (transformed.ok) {
      const headers = new Headers(transformed.headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-UB-Image-Transform', 'applied');
      return new Response(transformed.body, {
        status: transformed.status,
        headers
      });
    }
  }

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return error(404, 'Media object not found in R2');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (requestedVariant && media.kind === 'image') {
    headers.set('X-UB-Image-Transform', 'fallback-original');
  }

  return new Response(object.body, {
    status: 200,
    headers
  });
}
