function pickLangFromRequest(request) {
  const country = String(request.headers.get('CF-IPCountry') || '').toUpperCase();
  if (country === 'KR') return 'ko';

  const acceptLanguage = String(request.headers.get('Accept-Language') || '').toLowerCase();
  if (acceptLanguage.includes('ko')) return 'ko';

  return 'en';
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.pathname !== '/') {
    return context.next();
  }

  if (url.searchParams.get('manual') === '1') {
    return context.next();
  }

  const lang = pickLangFromRequest(context.request);
  url.pathname = `/${lang}/`;
  return Response.redirect(url.toString(), 302);
}
