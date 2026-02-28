import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LEGACY_DIR = path.join(ROOT, 'legacy', 'astro-20260228', 'src', 'content');
const OUT_FILE = path.join(ROOT, 'scripts', 'legacy-posts-export.json');

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: raw };

  const yaml = match[1];
  const body = raw.slice(match[0].length);
  const data = {};

  for (const line of yaml.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!key) continue;
    data[key] = value;
  }

  return { data, body };
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
      continue;
    }
    if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      files.push(full);
    }
  }

  return files;
}

async function main() {
  const sections = ['blog', 'tools', 'games', 'pages'];
  const rows = [];

  for (const section of sections) {
    for (const lang of ['en', 'ko']) {
      const sectionDir = path.join(LEGACY_DIR, section, lang);
      try {
        const files = await walk(sectionDir);
        for (const file of files) {
          const raw = await fs.readFile(file, 'utf8');
          const parsed = parseFrontmatter(raw);
          rows.push({
            source: path.relative(ROOT, file),
            section,
            lang,
            slug: parsed.data.slug || path.basename(file).replace(/\.(md|mdx)$/i, ''),
            title: parsed.data.title || 'Untitled',
            description: parsed.data.description || '',
            date: parsed.data.date || null,
            tags: parsed.data.tags || '',
            body: parsed.body
          });
        }
      } catch {
        // ignore missing section/lang folders
      }
    }
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Exported ${rows.length} legacy entries to ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
