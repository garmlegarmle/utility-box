export const SITE_NAME = 'Utility Box';
export const SITE_DESCRIPTION = 'A multilingual editorial platform for practical tools, games, and guides.';
export const SITE_URL = 'https://utility-box.org';
export const LANGS = ['en', 'ko'] as const;
export type SiteLang = (typeof LANGS)[number];

export const SECTION_LABELS: Record<string, { en: string; ko: string }> = {
  blog: { en: 'Blog', ko: '블로그' },
  tools: { en: 'Tools', ko: '도구' },
  games: { en: 'Games', ko: '게임' },
  pages: { en: 'Pages', ko: '페이지' }
};
