import type { Env } from '../types';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createPopupHtml,
  createSignedValue,
  getAdminSession,
  isAllowedAdmin,
  makeClearCookie,
  makeSetCookie,
  parseCookie,
  randomState,
  safeRedirectPath
} from '../lib/auth';
import { ok } from '../lib/validators';

const GH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GH_USER_URL = 'https://api.github.com/user';

interface OAuthStatePayload {
  state: string;
  redirectPath: string;
  targetOrigin: string;
}

function encodeStateCookie(payload: OAuthStatePayload): string {
  return btoa(JSON.stringify(payload));
}

function decodeStateCookie(value: string): OAuthStatePayload | null {
  try {
    const parsed = JSON.parse(atob(value));
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.state || !parsed.redirectPath) return null;

    return {
      state: String(parsed.state),
      redirectPath: safeRedirectPath(String(parsed.redirectPath)),
      targetOrigin: String(parsed.targetOrigin || '*')
    };
  } catch {
    return null;
  }
}

function sanitizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '*';
  }
}

export async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response('Missing GITHUB_CLIENT_ID', { status: 500 });
  }

  const url = new URL(request.url);
  const redirectPath = safeRedirectPath(url.searchParams.get('redirect'));

  const targetOriginParam = url.searchParams.get('origin') || request.headers.get('origin') || '*';
  const targetOrigin = targetOriginParam === '*' ? '*' : sanitizeOrigin(targetOriginParam);

  const state = randomState();
  const statePayload = encodeStateCookie({ state, redirectPath, targetOrigin });

  const redirectOrigin = targetOrigin !== '*' ? targetOrigin : `${url.protocol}//${url.host}`;
  const redirectUri = `${redirectOrigin}/api/callback`;
  const authUrl = new URL(GH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', env.GITHUB_OAUTH_SCOPE || 'read:user');
  authUrl.searchParams.set('state', state);

  const headers = new Headers({
    Location: authUrl.toString(),
    'Cache-Control': 'no-store'
  });
  headers.append('Set-Cookie', makeSetCookie(OAUTH_STATE_COOKIE, statePayload, 600, env));

  return new Response(null, {
    status: 302,
    headers
  });
}

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return new Response('Missing GitHub OAuth env vars', { status: 500 });
  }

  if (!env.ADMIN_SESSION_SECRET) {
    return new Response('Missing ADMIN_SESSION_SECRET', { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthError = url.searchParams.get('error') || '';

  const stateCookieRaw = parseCookie(request, OAUTH_STATE_COOKIE);
  const stateCookie = decodeStateCookie(stateCookieRaw);

  const targetOrigin = stateCookie?.targetOrigin || '*';
  const redirectPath = stateCookie?.redirectPath || '/en/';

  if (oauthError) {
    return new Response(createPopupHtml({ ok: false, message: oauthError, targetOrigin, redirectPath }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!stateCookie || stateCookie.state !== state) {
    return new Response(createPopupHtml({ ok: false, message: 'Invalid OAuth state', targetOrigin, redirectPath }), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!code) {
    return new Response(createPopupHtml({ ok: false, message: 'Missing OAuth code', targetOrigin, redirectPath }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const callbackOrigin = stateCookie?.targetOrigin && stateCookie.targetOrigin !== '*' ? stateCookie.targetOrigin : `${url.protocol}//${url.host}`;
  const redirectUri = `${callbackOrigin}/api/callback`;

  const tokenResponse = await fetch(GH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    })
  });

  const tokenJson = (await tokenResponse.json().catch(() => null)) as { access_token?: string } | null;
  const accessToken = tokenJson?.access_token;

  if (!tokenResponse.ok || !accessToken) {
    return new Response(createPopupHtml({ ok: false, message: 'Token exchange failed', targetOrigin, redirectPath }), {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const userResponse = await fetch(GH_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'utility-box-worker'
    }
  });

  const userJson = (await userResponse.json().catch(() => null)) as { login?: string } | null;
  const username = String(userJson?.login || '');

  if (!userResponse.ok || !username) {
    return new Response(createPopupHtml({ ok: false, message: 'Failed to load user profile', targetOrigin, redirectPath }), {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!isAllowedAdmin(username, env)) {
    return new Response(createPopupHtml({ ok: false, message: 'User is not allowed', targetOrigin, redirectPath }), {
      status: 403,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': makeClearCookie(OAUTH_STATE_COOKIE, env)
      }
    });
  }

  const sessionValue = await createSignedValue(
    {
      username,
      token: accessToken,
      exp: Date.now() + 1000 * 60 * 60 * 12
    },
    env.ADMIN_SESSION_SECRET
  );

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  headers.append('Set-Cookie', makeSetCookie(SESSION_COOKIE, sessionValue, 60 * 60 * 12, env));
  headers.append('Set-Cookie', makeClearCookie(OAUTH_STATE_COOKIE, env));

  return new Response(createPopupHtml({ ok: true, message: 'ok', targetOrigin, redirectPath }), {
    status: 200,
    headers
  });
}

export async function handleAuthSession(request: Request, env: Env): Promise<Response> {
  const session = await getAdminSession(request, env);
  return ok({
    ok: true,
    authenticated: Boolean(session),
    isAdmin: Boolean(session),
    username: session?.username || null
  });
}

export async function handleAuthLogout(_request: Request, env: Env): Promise<Response> {
  return ok(
    { ok: true },
    200,
    {
      'Set-Cookie': makeClearCookie(SESSION_COOKIE, env)
    }
  );
}
