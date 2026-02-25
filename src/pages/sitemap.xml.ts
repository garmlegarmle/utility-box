import { getCollection } from 'astro:content';
import { LANGS, SITE_URL } from '../consts';
import { buildCollectionPath } from '../lib/content';

const absolute = (path: string) => new URL(path, SITE_URL).toString();

export async function GET() {
  const now = new Date().toISOString();
  const urls: { loc: string; lastmod?: string }[] = [];

  urls.push({ loc: absolute('/'), lastmod: now });
  urls.push({ loc: absolute('/rss.xml'), lastmod: now });

  for (const lang of LANGS) {
    urls.push({ loc: absolute(`/${lang}/`), lastmod: now });
    urls.push({ loc: absolute(`/${lang}/blog/`), lastmod: now });
    urls.push({ loc: absolute(`/${lang}/tools/`), lastmod: now });
    urls.push({ loc: absolute(`/${lang}/games/`), lastmod: now });
    urls.push({ loc: absolute(`/${lang}/pages/`), lastmod: now });
  }

  const collections = ['blog', 'tools', 'games', 'pages'] as const;

  for (const collection of collections) {
    const entries = await getCollection(collection);
    entries.forEach((entry) => {
      urls.push({
        loc: absolute(buildCollectionPath(entry.data.lang, collection, entry.data.slug)),
        lastmod: entry.data.date ? entry.data.date.toISOString() : now
      });
    });
  }

  const uniqueUrls = [...new Map(urls.map((url) => [url.loc, url])).values()];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueUrls
    .map(
      (url) =>
        `  <url>\n    <loc>${url.loc}</loc>${url.lastmod ? `\n    <lastmod>${url.lastmod}</lastmod>` : ''}\n  </url>`
    )
    .join('\n')}\n</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
}
