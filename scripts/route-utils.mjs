import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

export const LANGS = ['en', 'ko'];

export const isExternalHref = (value = '') => /^(https?:)?\/\//i.test(value) || String(value).startsWith('mailto:');

export const normalizeInternalHref = (value = '') => {
  const raw = String(value).trim();
  if (!raw) return '';
  if (isExternalHref(raw)) return raw;

  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
};

export async function findContentFiles(dir) {
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
        continue;
      }

      if (!/\.(md|mdx)$/i.test(entry.name)) continue;
      out.push(full);
    }
  }

  await walk(dir);
  return out;
}

export async function readFrontmatter(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = matter(raw);
  return parsed.data ?? {};
}

export function routeLabel(type, title) {
  const prefix =
    type === 'blog'
      ? 'Blog'
      : type === 'tools'
        ? 'Tool'
        : type === 'games'
          ? 'Game'
          : type === 'pages'
            ? 'Page'
            : 'Route';

  return `${prefix}: ${title}`;
}

export function relativeFromCwd(filePath) {
  return path.relative(process.cwd(), filePath);
}
