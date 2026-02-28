import type { Env } from '../types';

const DEFAULT_HEADERS = 'Content-Type, Authorization';
const DEFAULT_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

function normalizeOrigins(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveCorsOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return '';

  const allowlist = normalizeOrigins(env.ALLOWED_ORIGINS);
  if (allowlist.length === 0) return origin;

  return allowlist.includes(origin) ? origin : '';
}

export function withCors(request: Request, env: Env, response: Response): Response {
  const allowedOrigin = resolveCorsOrigin(request, env);

  const headers = new Headers(response.headers);
  headers.set('Vary', 'Origin');

  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Headers', DEFAULT_HEADERS);
    headers.set('Access-Control-Allow-Methods', DEFAULT_METHODS);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function handlePreflight(request: Request, env: Env): Response {
  const allowedOrigin = resolveCorsOrigin(request, env);

  if (!allowedOrigin) {
    return new Response('Origin not allowed', { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': DEFAULT_HEADERS,
      'Access-Control-Allow-Methods': DEFAULT_METHODS,
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    }
  });
}
