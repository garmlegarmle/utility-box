import crypto from 'node:crypto';
import { parse as parseCookieHeader, serialize as serializeCookie } from 'cookie';

export const SESSION_COOKIE = 'ub_admin_session';
export const OAUTH_STATE_COOKIE = 'ub_admin_oauth_state';

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSignedValue(data, secret) {
  const payload = toBase64Url(JSON.stringify(data));
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySignedValue(value, secret) {
  if (!value || !secret || !value.includes('.')) return null;
  const [payload, signature] = value.split('.', 2);
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }
  try {
    return JSON.parse(fromBase64Url(payload));
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  return parseCookieHeader(req.headers.cookie || '');
}

export function makeSetCookie(name, value, maxAge, config) {
  return serializeCookie(name, value, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge,
    domain: config.cookieDomain || undefined
  });
}

export function makeClearCookie(name, config) {
  return serializeCookie(name, '', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 0,
    domain: config.cookieDomain || undefined
  });
}

export function randomState(length = 32) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function safeEqualText(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

export function isAllowedAdmin(username, config) {
  return Boolean(config.adminLoginUser) && String(username || '').toLowerCase() === config.adminLoginUser;
}

export function verifyAdminPassword(password, config) {
  if (!config.adminLoginPassword) return false;
  return safeEqualText(password, config.adminLoginPassword);
}

export function safeRedirectPath(input) {
  if (!input || typeof input !== 'string') return '/en/';
  if (!input.startsWith('/')) return '/en/';
  if (input.startsWith('//')) return '/en/';
  return input;
}

export function hasAdminBearer(req, config) {
  const token = String(config.adminToken || '').trim();
  if (!token) return false;
  const auth = req.headers.authorization || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  return auth.slice(7).trim() === token;
}

export function getAdminSession(req, config) {
  const cookies = parseCookies(req);
  const value = cookies[SESSION_COOKIE] || '';
  const payload = verifySignedValue(value, config.adminSessionSecret);
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.username || !payload.exp) return null;
  if (Date.now() > Number(payload.exp)) return null;
  if (!isAllowedAdmin(String(payload.username), config)) return null;
  return {
    username: String(payload.username),
    token: payload.token ? String(payload.token) : '',
    exp: Number(payload.exp)
  };
}

export function isAdminRequest(req, config) {
  return hasAdminBearer(req, config) || Boolean(getAdminSession(req, config));
}

export function createPopupHtml({ ok, message, redirectPath = '/en/', targetOrigin = '*' }) {
  const payload = JSON.stringify({
    type: 'ub-admin-auth-success',
    ok,
    message,
    redirectPath,
    targetOrigin
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
    <p>${ok ? 'Authentication complete.' : 'Authentication failed.'}</p>
  </body>
</html>`;
}
