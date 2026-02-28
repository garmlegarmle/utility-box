import type { Env } from '../types';
import { isAdminRequest } from '../lib/auth';
import { buildMediaUrls, buildR2Key, detectMediaKind } from '../lib/media';
import { error, ok } from '../lib/validators';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = [/^image\//i, /^video\//i, /^application\/pdf$/i];

function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_MIME.some((pattern) => pattern.test(mimeType));
}

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  const isAdmin = await isAdminRequest(request, env);
  if (!isAdmin) return error(401, 'Admin authentication required');

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return error(400, 'Expected multipart/form-data');
  }

  const form = await request.formData();
  const filePart = form.get('file');

  if (!(filePart instanceof File)) {
    return error(400, 'file is required');
  }

  const mimeType = filePart.type || 'application/octet-stream';
  if (!isAllowedMime(mimeType)) {
    return error(415, 'Unsupported file type');
  }

  if (filePart.size > MAX_UPLOAD_BYTES) {
    return error(413, 'File size exceeds 10MB limit');
  }

  const key = buildR2Key(mimeType);
  const bytes = await filePart.arrayBuffer();

  await env.MEDIA_BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: mimeType,
      contentDisposition: `inline; filename="${filePart.name || 'upload'}"`
    }
  });

  const kind = detectMediaKind(mimeType);

  const insert = await env.DB.prepare(
    `INSERT INTO media (r2_key, kind, width, height, alt, mime_type, size_bytes)
     VALUES (?, ?, NULL, NULL, ?, ?, ?)`
  )
    .bind(key, kind, filePart.name || null, mimeType, filePart.size)
    .run();

  const mediaId = Number(insert.meta.last_row_id);

  const variants: Array<{ variant: string; key: string; width: number; format: string }> = [];

  if (kind === 'image') {
    variants.push(
      { variant: 'original_webp', key, width: 1600, format: 'webp' },
      { variant: 'thumb_webp', key, width: 480, format: 'webp' }
    );

    for (const variant of variants) {
      await env.DB.prepare(
        `INSERT INTO media_variants (media_id, variant, r2_key, width, height, format)
         VALUES (?, ?, ?, ?, NULL, ?)`
      )
        .bind(mediaId, variant.variant, variant.key, variant.width, variant.format)
        .run();
    }
  }

  const urls = buildMediaUrls({
    env,
    request,
    mediaId,
    variantNames: variants.map((item) => item.variant)
  });

  return ok({
    ok: true,
    mediaId,
    keys: {
      original: key,
      ...Object.fromEntries(variants.map((item) => [item.variant, item.key]))
    },
    urls,
    variants
  });
}
