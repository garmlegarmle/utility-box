const encoder = new TextEncoder();

export const SESSION_COOKIE = 'ub_admin_session';
export const OAUTH_STATE_COOKIE = 'ub_admin_oauth_state';

function toBase64Url(input) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toBase64Url(binary);
}

async function sign(payload, secret) {
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

export async function createSignedValue(data, secret) {
  const payload = toBase64Url(JSON.stringify(data));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySignedValue(value, secret) {
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

export function parseCookie(request, key) {
  const cookieHeader = request.headers.get('cookie') || '';
  const parts = cookieHeader.split(';').map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${key}=`));
  return match ? decodeURIComponent(match.slice(key.length + 1)) : '';
}

export function makeSetCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function makeClearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomState(length = 32) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';

  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }

  return out;
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

export function isAllowedAdmin(username, env) {
  const raw = env.ADMIN_GITHUB_USERS || '';
  const allowlist = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) return true;
  return allowlist.includes(String(username || '').toLowerCase());
}

export async function getAdminSession(request, env) {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) return null;

  const cookie = parseCookie(request, SESSION_COOKIE);
  const payload = await verifySignedValue(cookie, secret);

  if (!payload || typeof payload !== 'object') return null;
  if (!payload.username || !payload.token || !payload.exp) return null;
  if (Date.now() > Number(payload.exp)) return null;
  if (!isAllowedAdmin(payload.username, env)) return null;

  return {
    username: String(payload.username),
    token: String(payload.token),
    exp: Number(payload.exp)
  };
}
