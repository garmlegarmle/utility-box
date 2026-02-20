const GH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

const cookieName = 'decap_oauth_state';

function randomState(length = 32) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
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

  const state = randomState();
  const scope = env.GITHUB_OAUTH_SCOPE || 'repo';

  const authUrl = new URL(GH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  const headers = new Headers({
    Location: authUrl.toString(),
    'Cache-Control': 'no-store'
  });

  headers.append(
    'Set-Cookie',
    `${cookieName}=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  return new Response(null, {
    status: 302,
    headers
  });
}
