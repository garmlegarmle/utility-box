import fs from 'node:fs/promises';
import path from 'node:path';
import { LANGS, findContentFiles, normalizeInternalHref, readFrontmatter, routeLabel } from './route-utils.mjs';

const cwd = process.cwd();
const publicDir = path.join(cwd, 'public');

const baseRoutes = (lang) => [
  { label: lang === 'ko' ? '홈' : 'Home', href: `/${lang}/`, type: 'system' },
  { label: lang === 'ko' ? '블로그 목록' : 'Blog Index', href: `/${lang}/blog/`, type: 'system' },
  { label: lang === 'ko' ? '도구 목록' : 'Tools Index', href: `/${lang}/tools/`, type: 'system' },
  { label: lang === 'ko' ? '게임 목록' : 'Games Index', href: `/${lang}/games/`, type: 'system' },
  { label: lang === 'ko' ? '페이지 목록' : 'Pages Index', href: `/${lang}/pages/`, type: 'system' }
];

async function collectRoutesForLang(lang) {
  const sources = [
    { type: 'pages', dir: path.join(cwd, 'src', 'content', 'pages', lang), prefix: 'pages' },
    { type: 'tools', dir: path.join(cwd, 'src', 'content', lang, 'tools'), prefix: 'tools' },
    { type: 'games', dir: path.join(cwd, 'src', 'content', lang, 'games'), prefix: 'games' },
    { type: 'blog', dir: path.join(cwd, 'src', 'content', lang, 'blog'), prefix: 'blog' }
  ];

  const routes = [...baseRoutes(lang)];

  for (const source of sources) {
    const files = await findContentFiles(source.dir);

    for (const file of files) {
      const data = await readFrontmatter(file);
      const slug = String(data.slug ?? '').trim();
      if (!slug) continue;

      const title = String(data.title ?? slug).trim();
      const href = normalizeInternalHref(`/${lang}/${source.prefix}/${slug}`);

      routes.push({
        label: routeLabel(source.type, title),
        href,
        type: source.type
      });
    }
  }

  const unique = [...new Map(routes.map((route) => [route.href, route])).values()];
  unique.sort((a, b) => {
    if (a.type === b.type) return a.label.localeCompare(b.label);
    return a.type.localeCompare(b.type);
  });

  return unique;
}

await fs.mkdir(publicDir, { recursive: true });

for (const lang of LANGS) {
  const routes = await collectRoutesForLang(lang);
  const target = path.join(publicDir, `internal-routes.${lang}.json`);
  await fs.writeFile(target, `${JSON.stringify(routes, null, 2)}\n`, 'utf8');
  console.log(`Generated ${path.relative(cwd, target)} (${routes.length} routes)`);
}
