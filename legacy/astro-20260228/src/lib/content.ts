import { getCollection, type CollectionEntry } from 'astro:content';
import { LANGS, NAV_SECTIONS, type SiteLang } from '../consts';

export const COLLECTIONS = ['blog', 'tools', 'games', 'pages'] as const;

export type CollectionKey = (typeof COLLECTIONS)[number];
export type SectionKey = (typeof NAV_SECTIONS)[number];

type EntryData = CollectionEntry<CollectionKey>['data'];

export const isCollectionKey = (value: string): value is CollectionKey =>
  COLLECTIONS.includes(value as CollectionKey);

export const isSectionKey = (value: string): value is SectionKey => NAV_SECTIONS.includes(value as SectionKey);

export const buildLangHomePath = (lang: SiteLang): string => `/${lang}/`;

export const buildSectionPath = (lang: SiteLang, section: SectionKey): string => `/${lang}/${section}/`;

export const buildCollectionPath = (lang: SiteLang, collection: CollectionKey, slug: string): string =>
  `/${lang}/${collection}/${slug}/`;

export const formatDate = (date?: Date, locale = 'en-US'): string => {
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

const sortEntries = <T extends CollectionEntry<CollectionKey>>(entries: T[]): T[] =>
  [...entries].sort((a, b) => {
    const left = a.data.date ? a.data.date.getTime() : 0;
    const right = b.data.date ? b.data.date.getTime() : 0;

    if (right !== left) return right - left;
    return a.data.title.localeCompare(b.data.title);
  });

export async function getLocalizedCollection<T extends CollectionKey>(
  collection: T,
  lang: SiteLang
): Promise<CollectionEntry<T>[]> {
  const entries = await getCollection(collection, ({ data }) => data.lang === lang);
  return sortEntries(entries as CollectionEntry<T>[]);
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
  const otherLang: SiteLang = entry.data.lang === 'en' ? 'ko' : 'en';

  if (entry.data.pairSlug) {
    const byPair = await getCollection(
      collection,
      ({ data }) => data.lang === otherLang && data.pairSlug === entry.data.pairSlug
    );
    if (byPair[0]) return byPair[0] as CollectionEntry<T>;
  }

  const bySlug = await getCollection(collection, ({ data }) => data.lang === otherLang && data.slug === entry.data.slug);
  return bySlug[0] as CollectionEntry<T> | undefined;
}

export function getCardImage(data: EntryData): string | undefined {
  return data.cardImage ?? data.image ?? data.heroImage;
}

export function getHeroImage(data: EntryData): string | undefined {
  return data.heroImage ?? data.image ?? data.cardImage;
}

export function getOtherLang(lang: SiteLang): SiteLang {
  return lang === 'en' ? 'ko' : 'en';
}

export function normalizeInternalPath(path: string): string {
  if (!path.trim()) return '';
  if (!path.startsWith('/')) return '';

  const [cleanPath] = path.split('#');
  const [withoutQuery] = cleanPath.split('?');
  if (!withoutQuery) return '';

  return withoutQuery.endsWith('/') ? withoutQuery : `${withoutQuery}/`;
}

export function isSupportedLang(lang: string): lang is SiteLang {
  return LANGS.includes(lang as SiteLang);
}
