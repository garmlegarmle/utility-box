import type { Env } from '../types';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createPopupHtml,
  createSignedValue,
  verifySignedValue,
  getAdminSession,
  isAllowedAdmin,
  makeClearCookie,
  makeSetCookie,
  randomState,
  safeRedirectPath
} from '../lib/auth';
import { debugLog, requestDebugId } from '../lib/debug';
import { ok } from '../lib/validators';

const GH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GH_USER_URL = 'https://api.github.com/user';

interface OAuthStatePayload {
  state: string;
  redirectPath: string;
  targetOrigin: string;
  issuedAt: number;
}

function sanitizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '*';
  }
}

async function createOAuthState(payload: Omit<OAuthStatePayload, 'issuedAt'>, env: Env): Promise<string> {
  if (!env.ADMIN_SESSION_SECRET) {
    throw new Error('Missing ADMIN_SESSION_SECRET');
  }

  return createSignedValue(
    {
      ...payload,
      issuedAt: Date.now()
    },
    env.ADMIN_SESSION_SECRET
  );
}

async function decodeOAuthState(value: string, env: Env): Promise<OAuthStatePayload | null> {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!value || !secret) return null;

  const parsed = (await verifySignedValue(value, secret)) as Partial<OAuthStatePayload> | null;
  if (!parsed || typeof parsed !== 'object') return null;

  if (!parsed.state || !parsed.redirectPath || !parsed.issuedAt) return null;
  const issuedAt = Number(parsed.issuedAt);
  if (!Number.isFinite(issuedAt)) return null;

  // 10 minutes
  if (Date.now() - issuedAt > 10 * 60 * 1000) return null;

  return {
    state: String(parsed.state),
    redirectPath: safeRedirectPath(String(parsed.redirectPath)),
    targetOrigin: String(parsed.targetOrigin || '*'),
    issuedAt
  };
}

export async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  const reqId = requestDebugId(request);
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    debugLog(env, 'auth.start.error', { reqId, reason: 'missing_github_client_id' });
    return new Response('Missing GITHUB_CLIENT_ID', { status: 500 });
  }
  if (!env.ADMIN_SESSION_SECRET) {
    debugLog(env, 'auth.start.error', { reqId, reason: 'missing_admin_session_secret' });
    return new Response('Missing ADMIN_SESSION_SECRET', { status: 500 });
  }

  const url = new URL(request.url);
  const redirectPath = safeRedirectPath(url.searchParams.get('redirect'));

  const targetOriginParam = url.searchParams.get('origin') || request.headers.get('origin') || '*';
  const targetOrigin = targetOriginParam === '*' ? '*' : sanitizeOrigin(targetOriginParam);

  const state = randomState();
  const signedState = await createOAuthState({ state, redirectPath, targetOrigin }, env);

  const redirectOrigin = targetOrigin !== '*' ? targetOrigin : `${url.protocol}//${url.host}`;
  const redirectUri = `${redirectOrigin}/api/callback`;
  const authUrl = new URL(GH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', env.GITHUB_OAUTH_SCOPE || 'read:user');
  authUrl.searchParams.set('state', signedState);

  debugLog(env, 'auth.start', {
    reqId,
    redirectPath,
    targetOrigin,
    redirectOrigin,
    host: url.host
  });

  const headers = new Headers({
    Location: authUrl.toString(),
    'Cache-Control': 'no-store'
  });

  return new Response(null, {
    status: 302,
    headers
  });
}

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const reqId = requestDebugId(request);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    debugLog(env, 'auth.callback.error', { reqId, reason: 'missing_github_oauth_env' });
    return new Response('Missing GitHub OAuth env vars', { status: 500 });
  }

  if (!env.ADMIN_SESSION_SECRET) {
    debugLog(env, 'auth.callback.error', { reqId, reason: 'missing_admin_session_secret' });
    return new Response('Missing ADMIN_SESSION_SECRET', { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthError = url.searchParams.get('error') || '';

  const statePayload = await decodeOAuthState(state, env);

  const targetOrigin = statePayload?.targetOrigin || '*';
  const redirectPath = statePayload?.redirectPath || '/en/';

  if (oauthError) {
    debugLog(env, 'auth.callback.error', { reqId, reason: 'oauth_error', oauthError, targetOrigin, redirectPath });
    return new Response(createPopupHtml({ ok: false, message: oauthError, targetOrigin, redirectPath }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!statePayload) {
    debugLog(env, 'auth.callback.error', { reqId, reason: 'invalid_state', targetOrigin, redirectPath });
    return new Response(createPopupHtml({ ok: false, message: 'Invalid OAuth state', targetOrigin, redirectPath }), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!code) {
    debugLog(env, 'auth.callback.error', { reqId, reason: 'missing_code', targetOrigin, redirectPath });
    return new Response(createPopupHtml({ ok: false, message: 'Missing OAuth code', targetOrigin, redirectPath }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const callbackOrigin =
    statePayload.targetOrigin && statePayload.targetOrigin !== '*' ? statePayload.targetOrigin : `${url.protocol}//${url.host}`;
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
    debugLog(env, 'auth.callback.error', {
      reqId,
      reason: 'token_exchange_failed',
      tokenStatus: tokenResponse.status,
      targetOrigin,
      redirectPath
    });
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
    debugLog(env, 'auth.callback.error', {
      reqId,
      reason: 'github_user_load_failed',
      userStatus: userResponse.status,
      targetOrigin,
      redirectPath
    });
    return new Response(createPopupHtml({ ok: false, message: 'Failed to load user profile', targetOrigin, redirectPath }), {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!isAllowedAdmin(username, env)) {
    debugLog(env, 'auth.callback.denied', {
      reqId,
      username,
      hasAdminGithubUser: Boolean(String(env.ADMIN_GITHUB_USER || '').trim())
    });
    return new Response(
      createPopupHtml({
        ok: false,
        message: `User is not allowed (${username}). Set ADMIN_GITHUB_USER to this username.`,
        targetOrigin,
        redirectPath
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': makeClearCookie(OAUTH_STATE_COOKIE, env)
        }
      }
    );
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
  // Cleanup legacy cookie format if still present in browsers.
  headers.append('Set-Cookie', makeClearCookie(OAUTH_STATE_COOKIE, env));

  debugLog(env, 'auth.callback.success', { reqId, username, redirectPath, targetOrigin });

  return new Response(createPopupHtml({ ok: true, message: 'ok', targetOrigin, redirectPath }), {
    status: 200,
    headers
  });
}

export async function handleAuthSession(request: Request, env: Env): Promise<Response> {
  const session = await getAdminSession(request, env);
  debugLog(env, 'auth.session', {
    reqId: requestDebugId(request),
    authenticated: Boolean(session),
    username: session?.username || null
  });
  return ok({
    ok: true,
    authenticated: Boolean(session),
    isAdmin: Boolean(session),
    username: session?.username || null
  });
}

export async function handleAuthLogout(request: Request, env: Env): Promise<Response> {
  debugLog(env, 'auth.logout', { reqId: requestDebugId(request) });
  return ok(
    { ok: true },
    200,
    {
      'Set-Cookie': makeClearCookie(SESSION_COOKIE, env)
    }
  );
}
