import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const cwd = process.cwd();
const LANGS = ['en', 'ko'];
const COLLECTIONS = ['blog', 'tools', 'games', 'pages'];

const routeSet = new Set(['/', '/rss.xml/', '/sitemap.xml/']);
const errors = [];
const strictMode = process.env.STRICT_INTERNAL_LINKS === '1';

function normalizePath(href) {
  if (!href || typeof href !== 'string') return '';
  if (!href.startsWith('/')) return '';
  if (href.startsWith('//')) return '';

  const clean = href.split('#')[0]?.split('?')[0] ?? '';
  if (!clean) return '';

  if (/\.[a-z0-9]{2,5}$/i.test(clean)) return '';
  if (clean.startsWith('/uploads/')) return '';

  return clean.endsWith('/') ? clean : `${clean}/`;
}

async function findContentFiles(dir) {
  const out = [];

  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(md|mdx)$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }

  await walk(dir);
  return out;
}

function collectLinks(body) {
  const links = [];

  const markdownPattern = /\[[^\]]+\]\((\/[^)\s]+)\)/g;
  const htmlPattern = /href=["'](\/[^"']+)["']/g;

  let match;
  while ((match = markdownPattern.exec(body)) !== null) {
    links.push(match[1]);
  }

  while ((match = htmlPattern.exec(body)) !== null) {
    links.push(match[1]);
  }

  return links;
}

for (const lang of LANGS) {
  routeSet.add(`/${lang}/`);
  routeSet.add(`/${lang}/blog/`);
  routeSet.add(`/${lang}/tools/`);
  routeSet.add(`/${lang}/games/`);
  routeSet.add(`/${lang}/pages/`);
}

const allFiles = [];

for (const collection of COLLECTIONS) {
  for (const lang of LANGS) {
    const dir = path.join(cwd, 'src', 'content', collection, lang);
    const files = await findContentFiles(dir);
    allFiles.push(...files);

    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = matter(raw);
      const slug = String(parsed.data.slug ?? path.basename(file).replace(/\.[^.]+$/u, '')).trim();
      routeSet.add(`/${lang}/${collection}/${slug}/`);
    }
  }
}

for (const file of allFiles) {
  const raw = await fs.readFile(file, 'utf8');
  const parsed = matter(raw);
  const links = collectLinks(parsed.content);

  for (const href of links) {
    const normalized = normalizePath(href);
    if (!normalized) continue;
    if (!routeSet.has(normalized)) {
      errors.push(`${path.relative(cwd, file)}: broken internal link ${href}`);
    }
  }
}

if (errors.length > 0) {
  if (strictMode) {
    console.error('\nInternal link validation failed:\n');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.warn('\nInternal link warnings (non-blocking):\n');
  errors.forEach((error) => console.warn(`- ${error}`));
  console.warn('\nSet STRICT_INTERNAL_LINKS=1 to fail builds on broken internal links.\n');
  process.exit(0);
}

console.log('Internal link validation passed.');
