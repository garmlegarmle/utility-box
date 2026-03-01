const UPSTREAM_API_BASE = 'https://api.utility-box.org';

function toPath(value) {
  if (Array.isArray(value)) return value.join('/');
  return String(value || '');
}

export async function onRequest(context) {
  const { request, params } = context;
  const sourceUrl = new URL(request.url);
  const tail = toPath(params.path);
  const upstreamUrl = new URL(`/api/${tail}`, UPSTREAM_API_BASE);
  upstreamUrl.search = sourceUrl.search;

  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', sourceUrl.host);
  headers.set('x-forwarded-proto', sourceUrl.protocol.replace(':', ''));
  headers.delete('host');

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set('Cache-Control', 'no-store');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
}
