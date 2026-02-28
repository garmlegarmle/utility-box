import type { SiteLang, SiteSection } from '../types';

export const SITE_NAME = 'Utility Box';

export function normalizeLang(input: string | undefined): SiteLang {
  return input === 'ko' ? 'ko' : 'en';
}

export function normalizeSection(input: string | undefined): SiteSection | null {
  if (!input) return null;
  const v = input.toLowerCase();
  if (v === 'blog') return 'blog';
  if (v === 'tools' || v === 'tool') return 'tools';
  if (v === 'games' || v === 'game') return 'games';
  if (v === 'pages' || v === 'page') return 'pages';
  return null;
}

export function sectionLabel(section: SiteSection, lang: SiteLang): string {
  const map: Record<SiteSection, { en: string; ko: string }> = {
    blog: { en: 'Blog', ko: 'Blog' },
    tools: { en: 'Tool', ko: 'Tool' },
    games: { en: 'Game', ko: 'Game' },
    pages: { en: 'Page', ko: 'Page' }
  };
  return map[section][lang];
}

export function sectionNavLabel(section: SiteSection): string {
  if (section === 'tools') return 'TOOL';
  if (section === 'games') return 'GAME';
  if (section === 'blog') return 'BLOG';
  return 'PAGE';
}

export function getLanguageTogglePath(pathname: string, currentLang: SiteLang): string {
  const targetLang = currentLang === 'en' ? 'ko' : 'en';
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return `/${targetLang}/`;
  if (segments[0] !== 'en' && segments[0] !== 'ko') return `/${targetLang}/`;

  segments[0] = targetLang;
  return `/${segments.join('/')}${pathname.endsWith('/') ? '/' : ''}`;
}

export function detectBrowserLang(): SiteLang {
  const first = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return first.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
