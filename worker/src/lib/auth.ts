import type { Env, SessionUser } from '../types';

const encoder = new TextEncoder();

export const SESSION_COOKIE = 'ub_admin_session';
export const OAUTH_STATE_COOKIE = 'ub_admin_oauth_state';

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toBase64Url(binary);
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSignedValue(data: unknown, secret: string): Promise<string> {
  const payload = toBase64Url(JSON.stringify(data));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySignedValue(value: string, secret: string): Promise<unknown | null> {
  if (!value || !secret || !value.includes('.')) return null;
  const [payload, signature] = value.split('.', 2);

  if (!payload || !signature) return null;

  const expected = await sign(payload, secret);
  if (expected !== signature) return null;

  try {
    return JSON.parse(fromBase64Url(payload));
  } catch {
    return null;
  }
}

export function parseCookie(request: Request, key: string): string {
  const cookieHeader = request.headers.get('cookie') || '';
  const parts = cookieHeader.split(';').map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${key}=`));
  return match ? decodeURIComponent(match.slice(key.length + 1)) : '';
}

export function makeSetCookie(name: string, value: string, maxAge: number, _env: Env): string {
  // Use host-only cookies to avoid domain mismatch across www/apex/api hosts.
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function makeClearCookie(name: string, _env: Env): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomState(length = 32): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';

  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }

  return out;
}

export function isAllowedAdmin(username: string, env: Env): boolean {
  const single = String(env.ADMIN_GITHUB_USER || '')
    .trim()
    .toLowerCase();
  if (single) return username.toLowerCase() === single;

  const allowlist = String(env.ADMIN_GITHUB_USERS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length > 0) {
    return allowlist.includes(username.toLowerCase());
  }

  return false;
}

export function safeRedirectPath(input: string | null): string {
  if (!input || typeof input !== 'string') return '/en/';
  if (!input.startsWith('/')) return '/en/';
  if (input.startsWith('//')) return '/en/';
  return input;
}

export async function getAdminSession(request: Request, env: Env): Promise<SessionUser | null> {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) return null;

  const cookie = parseCookie(request, SESSION_COOKIE);
  const payload = (await verifySignedValue(cookie, secret)) as Record<string, unknown> | null;

  if (!payload || typeof payload !== 'object') return null;
  if (!payload.username || !payload.token || !payload.exp) return null;
  if (Date.now() > Number(payload.exp)) return null;

  const username = String(payload.username);
  if (!isAllowedAdmin(username, env)) return null;

  return {
    username,
    token: String(payload.token),
    exp: Number(payload.exp)
  };
}

export function hasAdminBearer(request: Request, env: Env): boolean {
  const token = String(env.ADMIN_TOKEN || '').trim();
  if (!token) return false;

  const auth = request.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const incoming = auth.slice(7).trim();
  return incoming === token;
}

export async function isAdminRequest(request: Request, env: Env): Promise<boolean> {
  if (hasAdminBearer(request, env)) return true;
  const session = await getAdminSession(request, env);
  return Boolean(session);
}

export function createPopupHtml(params: {
  ok: boolean;
  message: string;
  redirectPath?: string;
  targetOrigin?: string;
}): string {
  const payload = JSON.stringify({
    type: 'ub-admin-auth-success',
    ok: params.ok,
    message: params.message,
    redirectPath: params.redirectPath || '/en/',
    targetOrigin: params.targetOrigin || '*'
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Admin Auth</title></head>
  <body>
    <script>
      (function () {
        var payload = ${payload};
        if (window.opener) {
          try {
            window.opener.postMessage(payload, payload.targetOrigin || '*');
          } catch (_) {
            window.opener.postMessage(payload, '*');
          }
        }
        setTimeout(function () { window.close(); }, 120);
      })();
    </script>
    <p>${params.ok ? 'Authentication complete.' : 'Authentication failed.'}</p>
  </body>
</html>`;
}
