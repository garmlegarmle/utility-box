export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = String(url.hostname || '').toLowerCase();

  if (host === 'utility-box.org' || host === 'utility-box.pages.dev') {
    url.protocol = 'https:';
    url.hostname = 'www.utility-box.org';
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
