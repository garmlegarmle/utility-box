export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = String(url.hostname || '').toLowerCase();
  const path = url.pathname;

  if (host === 'utility-box.org' || host === 'utility-box.pages.dev') {
    url.protocol = 'https:';
    url.hostname = 'www.utility-box.org';
    return Response.redirect(url.toString(), 301);
  }

  // Force SPA entrypoint for language routes on hard refresh.
  // This prevents stale path-specific HTML from older deployments from being served.
  const isSpaLangRoute = /^\/(en|ko)(\/.*)?$/.test(path);
  const isApi = path.startsWith('/api/');
  const isStaticAsset =
    path.startsWith('/assets/') ||
    path.startsWith('/uploads/') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.webp') ||
    path.endsWith('.gif') ||
    path.endsWith('.ico') ||
    path.endsWith('.txt') ||
    path.endsWith('.xml');

  if (context.request.method === 'GET' && isSpaLangRoute && !isApi && !isStaticAsset) {
    return context.next('/index.html');
  }

  return context.next();
}
