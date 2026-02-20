const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const cookieName = 'decap_oauth_state';

function getCookieValue(cookieHeader, key) {
  if (!cookieHeader) return '';
  const all = cookieHeader.split(';').map((item) => item.trim());
  const match = all.find((item) => item.startsWith(`${key}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : '';
}

function renderHtml(message, origin = '*') {
  const payload = JSON.stringify(message).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
  <head><meta charset=\"utf-8\"><title>Decap Auth</title></head>
  <body>
    <script>
      (function () {
        const data = ${payload};
        const serialized = 'authorization:github:success:' + JSON.stringify(data);
        const defaultOrigin = ${JSON.stringify(origin)};

        const send = (targetOrigin) => {
          if (!window.opener) return;
          try {
            window.opener.postMessage(serialized, targetOrigin);
          } catch (_) {}
        };

        if (!window.opener) {
          document.body.textContent = 'Authentication complete. You can close this window.';
          return;
        }

        // Decap versions differ in handshake behavior; send both proactively and on handshake.
        send(window.location.origin);
        send(defaultOrigin);
        send('*');

        const onMessage = (event) => {
          if (event.data === 'authorizing:github') {
            send(event.origin || window.location.origin);
            setTimeout(() => window.close(), 50);
          }
        };

        window.addEventListener('message', onMessage, false);

        // Trigger handshake for clients that expect it.
        try {
          window.opener.postMessage('authorizing:github', '*');
        } catch (_) {}

        setTimeout(() => window.close(), 400);
      })();
    </script>
  </body>
</html>`;
}

export async function onRequestGet(context) {
  const { env, request } = context;

  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response('Missing GitHub OAuth env vars', { status: 500 });
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/callback`;
  const oauthError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = getCookieValue(request.headers.get('cookie'), cookieName);

  if (oauthError) {
    return new Response(`GitHub OAuth error: ${oauthError}`, { status: 400 });
  }

  if (!code) {
    return new Response('Missing code', { status: 400 });
  }

  if (!state || !cookieState || state !== cookieState) {
    return new Response('Invalid OAuth state', { status: 403 });
  }

  const tokenRes = await fetch(GH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });

  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    return new Response(`GitHub token exchange failed: ${JSON.stringify(tokenJson)}`, { status: 502 });
  }

  const body = renderHtml({
    token: tokenJson.access_token,
    provider: 'github'
  });

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  headers.append('Set-Cookie', `${cookieName}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);

  return new Response(body, {
    status: 200,
    headers
  });
}
