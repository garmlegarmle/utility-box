import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createSignedValue,
  isAllowedAdmin,
  makeClearCookie,
  makeSetCookie,
  parseCookie
} from '../_lib/session.js';

const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GH_USER_URL = 'https://api.github.com/user';

function renderPopupHtml(ok, message) {
  const payload = JSON.stringify({ type: 'ub-admin-auth-success', ok, message }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Admin Auth</title></head>
  <body>
    <script>
      (function () {
        var payload = ${payload};
        if (window.opener) {
          window.opener.postMessage(payload, window.location.origin);
        }
        setTimeout(function () { window.close(); }, 80);
      })();
    </script>
    <p>${ok ? 'Authentication complete.' : 'Authentication failed.'}</p>
  </body>
</html>`;
}

export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return new Response('Missing GitHub OAuth env vars', { status: 500 });
  }

  if (!env.ADMIN_SESSION_SECRET) {
    return new Response('Missing ADMIN_SESSION_SECRET', { status: 500 });
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/callback`;

  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return new Response(renderPopupHtml(false, oauthError), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const stored = parseCookie(request, OAUTH_STATE_COOKIE);
  const [storedState] = stored.split('|');

  if (!state || !storedState || state !== storedState) {
    return new Response(renderPopupHtml(false, 'Invalid OAuth state'), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!code) {
    return new Response(renderPopupHtml(false, 'Missing code'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

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

  const tokenJson = await tokenResponse.json().catch(() => ({}));
  const accessToken = tokenJson?.access_token;

  if (!tokenResponse.ok || !accessToken) {
    return new Response(renderPopupHtml(false, 'Token exchange failed'), {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const userResponse = await fetch(GH_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'utility-box-admin-ui'
    }
  });

  const userJson = await userResponse.json().catch(() => ({}));
  const username = userJson?.login;

  if (!userResponse.ok || !username) {
    return new Response(renderPopupHtml(false, 'Failed to fetch user profile'), {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!isAllowedAdmin(username, env)) {
    return new Response(renderPopupHtml(false, 'User is not in ADMIN_GITHUB_USERS allowlist'), {
      status: 403,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': makeClearCookie(OAUTH_STATE_COOKIE)
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

  headers.append('Set-Cookie', makeSetCookie(SESSION_COOKIE, sessionValue, 60 * 60 * 12));
  headers.append('Set-Cookie', makeClearCookie(OAUTH_STATE_COOKIE));

  return new Response(renderPopupHtml(true, 'ok'), {
    status: 200,
    headers
  });
}
