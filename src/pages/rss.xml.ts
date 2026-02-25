import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE_NAME, SITE_URL } from '../consts';
import { buildCollectionPath } from '../lib/content';

export async function GET(context: { site?: URL }) {
  const blogEntries = await getCollection('blog');
  const sorted = [...blogEntries].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: `${SITE_NAME} Blog`,
    description: 'Blog feed for Utility Box.',
    site: context.site ?? SITE_URL,
    items: sorted.map((entry) => ({
      title: entry.data.title,
      description: entry.data.description,
      pubDate: entry.data.date,
      link: buildCollectionPath(entry.data.lang, 'blog', entry.data.slug)
    }))
  });
}
