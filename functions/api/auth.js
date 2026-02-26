import { OAUTH_STATE_COOKIE, makeSetCookie, randomState } from '../_lib/session.js';

const GH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

function safeRedirectPath(input) {
  if (!input || typeof input !== 'string') return '/';
  if (!input.startsWith('/')) return '/';
  if (input.startsWith('//')) return '/';
  return input;
}

export async function onRequestGet(context) {
  const { env, request } = context;

  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response('Missing GITHUB_CLIENT_ID', { status: 500 });
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/callback`;
  const redirectPath = safeRedirectPath(url.searchParams.get('redirect') || '/');

  const state = randomState();
  const cookiePayload = `${state}|${encodeURIComponent(redirectPath)}`;

  const authUrl = new URL(GH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', env.GITHUB_OAUTH_SCOPE || 'repo');
  authUrl.searchParams.set('state', state);

  const headers = new Headers({
    Location: authUrl.toString(),
    'Cache-Control': 'no-store'
  });

  headers.append('Set-Cookie', makeSetCookie(OAUTH_STATE_COOKIE, cookiePayload, 600));

  return new Response(null, {
    status: 302,
    headers
  });
}
