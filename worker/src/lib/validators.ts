export type Section = 'blog' | 'tools' | 'games' | 'pages';
export type Status = 'draft' | 'published';
export type Lang = 'en' | 'ko';

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeLang(value: unknown, fallback: Lang = 'en'): Lang {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === 'ko' || raw === 'kr') return 'ko';
  return 'en';
}

export function normalizeSection(value: unknown, fallback: Section = 'blog'): Section {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === 'blog') return 'blog';
  if (raw === 'tool' || raw === 'tools') return 'tools';
  if (raw === 'game' || raw === 'games') return 'games';
  if (raw === 'page' || raw === 'pages') return 'pages';
  return fallback;
}

export function normalizeStatus(value: unknown, fallback: Status = 'draft'): Status {
  const raw = String(value || fallback).trim().toLowerCase();
  return raw === 'published' ? 'published' : 'draft';
}

export function parseIntSafe(value: unknown, fallback: number | null = null): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function dedupeTags(tags: unknown): string[] {
  const list = Array.isArray(tags)
    ? tags
    : String(tags || '')
        .split(',')
        .map((item) => item.trim());

  const map = new Map<string, string>();
  for (const tag of list) {
    const clean = String(tag || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!map.has(key)) map.set(key, clean);
  }

  return [...map.values()];
}

export function clamp(input: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, input));
}

export function toExcerpt(value: string, maxLength = 180): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

export function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function ok(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(headers || {})
    }
  });
}
