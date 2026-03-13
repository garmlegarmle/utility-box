import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const IMAGE_MIME_RE = /^image\//i;
const VIDEO_MIME_RE = /^video\//i;

export function detectMediaKind(mimeType) {
  if (IMAGE_MIME_RE.test(mimeType)) return 'image';
  if (VIDEO_MIME_RE.test(mimeType)) return 'video';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'file';
}

export function extensionFromMime(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf'
  };
  return map[String(mimeType || '').toLowerCase()] || 'bin';
}

export function variantMimeType(format, fallbackMime = 'application/octet-stream') {
  if (format === 'webp') return 'image/webp';
  return fallbackMime;
}

export function buildStorageKey(mimeType, suffix = '') {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = suffix ? suffix : extensionFromMime(mimeType);
  return `media/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}

export function resolveStoragePath(config, key) {
  return path.join(config.uploadRoot, key);
}

function requestOrigin(request) {
  const forwardedProto = String(request.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(request.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || request.protocol;
  const host = forwardedHost || request.get('host');
  return `${protocol}://${host}`;
}

export function buildMediaUrls({ request, mediaId, variantNames = [] }) {
  const base = `${requestOrigin(request)}/api/media/${mediaId}/file`;
  const out = { original: base };
  for (const variant of variantNames) {
    out[variant] = `${base}?variant=${encodeURIComponent(variant)}`;
  }
  return out;
}

export async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function saveBufferToKey(config, key, buffer) {
  const filePath = resolveStoragePath(config, key);
  await ensureDirForFile(filePath);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function writeImageVariants(config, keyBaseNoExt, buffer) {
  const image = sharp(buffer, { failOn: 'none' });
  const metadata = await image.metadata();
  const variants = [];

  for (const size of [1600, 480]) {
    const variant = size === 1600 ? 'original_webp' : 'thumb_webp';
    const key = `${keyBaseNoExt}-${size}.webp`;
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: size, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 82 })
      .toBuffer();
    await saveBufferToKey(config, key, out);
    const resizedMeta = await sharp(out).metadata();
    variants.push({
      variant,
      key,
      width: resizedMeta.width || null,
      height: resizedMeta.height || null,
      format: 'webp'
    });
  }

  return {
    width: metadata.width || null,
    height: metadata.height || null,
    variants
  };
}
