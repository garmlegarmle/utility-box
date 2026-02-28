import type { Env } from '../types';

const IMAGE_MIME_RE = /^image\//i;
const VIDEO_MIME_RE = /^video\//i;

export function detectMediaKind(mimeType: string): 'image' | 'video' | 'pdf' | 'file' {
  if (IMAGE_MIME_RE.test(mimeType)) return 'image';
  if (VIDEO_MIME_RE.test(mimeType)) return 'video';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'file';
}

export function extensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf'
  };

  return map[mimeType.toLowerCase()] || 'bin';
}

export function buildR2Key(mimeType: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = extensionFromMime(mimeType);
  return `media/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}

export function buildMediaUrls(params: {
  env: Env;
  request: Request;
  mediaId: number;
  variantNames?: string[];
}): { original: string; [key: string]: string } {
  const { env, request, mediaId, variantNames = [] } = params;

  const apiBase = new URL(request.url).origin;
  const base = `${apiBase}/api/media/${mediaId}/file`;
  const out: { original: string; [key: string]: string } = {
    original: base
  };

  for (const variant of variantNames) {
    out[variant] = `${base}?variant=${encodeURIComponent(variant)}`;
  }

  if (env.MEDIA_PUBLIC_BASE_URL) {
    out.publicBase = env.MEDIA_PUBLIC_BASE_URL;
  }

  return out;
}

export function sanitizeFileName(input: string): string {
  return String(input || 'upload')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);
}
