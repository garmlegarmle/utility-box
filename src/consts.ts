export const SITE_NAME = 'Utility Box';
export const SITE_DESCRIPTION = 'Practical tools, games, and guides.';
export const SITE_URL = 'https://www.utility-box.org';

export const LANGS = ['en', 'ko'] as const;
export type SiteLang = (typeof LANGS)[number];

export const NAV_SECTIONS = ['tools', 'blog', 'games'] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

export const SECTION_LABELS: Record<NavSection | 'pages', { en: string; ko: string }> = {
  blog: { en: 'Blog', ko: '블로그' },
  tools: { en: 'Tools', ko: '도구' },
  games: { en: 'Games', ko: '게임' },
  pages: { en: 'Pages', ko: '페이지' }
};
