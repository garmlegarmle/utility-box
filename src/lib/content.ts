import { getCollection, type CollectionEntry } from 'astro:content';
import type { SiteLang } from '../consts';

export const COLLECTIONS = ['blog', 'pages', 'tools', 'games'] as const;
export const SECTION_COLLECTIONS = ['blog', 'tools', 'games'] as const;

export type CollectionKey = (typeof COLLECTIONS)[number];
export type SectionKey = (typeof SECTION_COLLECTIONS)[number];

export const isCollectionKey = (value: string): value is CollectionKey =>
  COLLECTIONS.includes(value as CollectionKey);

export const isSectionKey = (value: string): value is SectionKey =>
  SECTION_COLLECTIONS.includes(value as SectionKey);

export const slugifyTerm = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

export const formatDate = (date?: Date, locale = 'en-US'): string => {
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

export const buildCollectionPath = (lang: SiteLang, collection: CollectionKey, slug: string): string =>
  `/${lang}/${collection}/${slug}/`;

export const buildSectionPath = (lang: SiteLang, section: SectionKey): string => `/${lang}/${section}/`;

export const buildLangHomePath = (lang: SiteLang): string => `/${lang}/`;

const sortByDateDesc = <T extends CollectionEntry<CollectionKey>>(entries: T[]): T[] =>
  entries.sort((a, b) => {
    const left = a.data.date ? a.data.date.getTime() : 0;
    const right = b.data.date ? b.data.date.getTime() : 0;
    return right - left;
  });

export async function getLocalizedCollection<T extends CollectionKey>(
  collection: T,
  lang: SiteLang
): Promise<CollectionEntry<T>[]> {
  const entries = await getCollection(collection, ({ data }) => data.lang === lang);
  return sortByDateDesc(entries as CollectionEntry<T>[]);
}

export async function getEntryBySlug<T extends CollectionKey>(
  collection: T,
  lang: SiteLang,
  slug: string
): Promise<CollectionEntry<T> | undefined> {
  const entries = await getCollection(collection, ({ data }) => data.lang === lang && data.slug === slug);
  return entries[0] as CollectionEntry<T> | undefined;
}

export async function getPairedEntry<T extends CollectionKey>(
  collection: T,
  entry: CollectionEntry<T>
): Promise<CollectionEntry<T> | undefined> {
  if (!entry.data.pairSlug) return undefined;

  const items = await getCollection(
    collection,
    ({ data }) => data.lang !== entry.data.lang && data.pairSlug === entry.data.pairSlug
  );

  return items[0] as CollectionEntry<T> | undefined;
}

export function getTaxonomy(entries: CollectionEntry<CollectionKey>[]) {
  const categoryMap = new Map<string, string>();
  const tagMap = new Map<string, string>();

  entries.forEach((entry) => {
    const category = entry.data.category;
    const categorySlug = category ? slugifyTerm(category) : '';
    if (category && categorySlug && !categoryMap.has(categorySlug)) {
      categoryMap.set(categorySlug, category);
    }

    (entry.data.tags ?? []).forEach((tag) => {
      const tagSlug = slugifyTerm(tag);
      if (tagSlug && !tagMap.has(tagSlug)) {
        tagMap.set(tagSlug, tag);
      }
    });
  });

  return {
    categories: [...categoryMap.entries()].map(([slug, label]) => ({ slug, label })),
    tags: [...tagMap.entries()].map(([slug, label]) => ({ slug, label }))
  };
}

export function byCategory(entries: CollectionEntry<CollectionKey>[], categorySlug: string) {
  return entries.filter((entry) => {
    if (!entry.data.category) return false;
    return slugifyTerm(entry.data.category) === categorySlug;
  });
}

export function byTag(entries: CollectionEntry<CollectionKey>[], tagSlug: string) {
  return entries.filter((entry) => (entry.data.tags ?? []).some((tag) => slugifyTerm(tag) === tagSlug));
}
