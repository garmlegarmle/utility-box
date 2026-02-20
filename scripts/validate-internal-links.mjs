import fs from 'node:fs/promises';
import path from 'node:path';
import { LANGS, findContentFiles, isExternalHref, normalizeInternalHref, readFrontmatter, relativeFromCwd } from './route-utils.mjs';

const cwd = process.cwd();

const errors = [];

function addError(message) {
  errors.push(message);
}

function validateInternalRoute(route, routeSet, context) {
  const normalized = normalizeInternalHref(route);
  if (!normalized) {
    addError(`${context}: missing internal route`);
    return;
  }

  if (isExternalHref(normalized)) {
    addError(`${context}: expected internal route but got external URL (${normalized})`);
    return;
  }

  if (!routeSet.has(normalized)) {
    addError(`${context}: broken internal route ${normalized}`);
  }
}

function validateLink(link, routeSet, context) {
  if (!link || typeof link !== 'object') {
    addError(`${context}: link item is invalid`);
    return;
  }

  const kind = link.kind ?? (link.externalUrl ? 'external' : 'internal');

  if (kind === 'external') {
    const externalUrl = String(link.externalUrl ?? link.href ?? '').trim();
    if (!externalUrl) {
      addError(`${context}: external link missing externalUrl`);
      return;
    }

    if (!isExternalHref(externalUrl)) {
      addError(`${context}: external link must be absolute URL/mailto (${externalUrl})`);
    }

    return;
  }

  const internalRoute = String(link.internalRoute ?? link.href ?? '').trim();
  validateInternalRoute(internalRoute, routeSet, context);
}

async function validateLang(lang) {
  const routeIndexPath = path.join(cwd, 'public', `internal-routes.${lang}.json`);
  const routeIndexRaw = await fs.readFile(routeIndexPath, 'utf8').catch(() => '');

  if (!routeIndexRaw) {
    addError(`missing route index file: ${path.relative(cwd, routeIndexPath)} (run generate-internal-routes)`);
    return;
  }

  let routeIndex = [];
  try {
    routeIndex = JSON.parse(routeIndexRaw);
  } catch (error) {
    addError(`invalid JSON in ${path.relative(cwd, routeIndexPath)}: ${error.message}`);
    return;
  }

  const routeSet = new Set(routeIndex.map((item) => normalizeInternalHref(item.href)));
  const pageDir = path.join(cwd, 'src', 'content', 'pages', lang);
  const pageFiles = await findContentFiles(pageDir);

  for (const file of pageFiles) {
    const data = await readFrontmatter(file);
    const sections = data.sections ?? [];
    const fileLabel = relativeFromCwd(file);

    if (!Array.isArray(sections)) {
      addError(`${fileLabel}: sections must be an array`);
      continue;
    }

    sections.forEach((section, index) => {
      const sectionType = section?.type ?? 'Unknown';
      const sectionId = section?.id ?? `index-${index}`;
      const contextBase = `${fileLabel} [${sectionType}:${sectionId}]`;

      if (!section || typeof section !== 'object') {
        addError(`${contextBase}: section is not an object`);
        return;
      }

      if (sectionType === 'Hero') {
        const links = Array.isArray(section.links) ? section.links : [];
        links.forEach((link, linkIndex) => {
          validateLink(link, routeSet, `${contextBase} Hero.links[${linkIndex}]`);
        });
      }

      if (sectionType === 'ToolEmbed' || sectionType === 'GameEmbed') {
        validateInternalRoute(String(section.route ?? '').trim(), routeSet, `${contextBase} ${sectionType}.route`);
      }

      if (sectionType === 'LinkList') {
        const items = Array.isArray(section.items) ? section.items : [];
        items.forEach((link, linkIndex) => {
          validateLink(link, routeSet, `${contextBase} LinkList.items[${linkIndex}]`);
        });
      }

      if (sectionType === 'CardGrid') {
        const items = Array.isArray(section.items) ? section.items : [];
        items.forEach((item, itemIndex) => {
          validateLink(item, routeSet, `${contextBase} CardGrid.items[${itemIndex}]`);
        });
      }
    });
  }
}

for (const lang of LANGS) {
  await validateLang(lang);
}

if (errors.length > 0) {
  console.error('\nInternal link validation failed:\n');
  errors.forEach((line) => console.error(`- ${line}`));
  process.exit(1);
}

console.log('Internal link validation passed.');
