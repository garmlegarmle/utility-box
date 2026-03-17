import type { SiteLang, SiteSection } from '../types';

export const SITE_NAME = 'GA-ML';

export type UiTextKey =
  | 'nav.home'
  | 'nav.about'
  | 'nav.tool'
  | 'nav.game'
  | 'nav.blog'
  | 'nav.langToggle'
  | 'footer.contact'
  | 'footer.privacy'
  | 'home.category'
  | 'home.tagList'
  | 'common.all'
  | 'common.loading'
  | 'common.noPosts'
  | 'card.placeholder'
  | 'card.tagFallback'
  | 'card.draft'
  | 'detail.prev'
  | 'detail.next'
  | 'detail.created'
  | 'detail.updated'
  | 'detail.related'
  | 'detail.tagFallback'
  | 'admin.menu'
  | 'admin.actions'
  | 'admin.login'
  | 'admin.loginTitle'
  | 'admin.username'
  | 'admin.password'
  | 'admin.cancel'
  | 'admin.submit'
  | 'admin.editCurrent'
  | 'admin.write'
  | 'admin.pageManager'
  | 'admin.logout';

const UI_TEXT: Record<SiteLang, Record<UiTextKey, string>> = {
  en: {
    'nav.home': 'HOME',
    'nav.about': 'ABOUT',
    'nav.tool': 'TOOL',
    'nav.game': 'GAME',
    'nav.blog': 'BLOG',
    'nav.langToggle': 'EN / KR',
    'footer.contact': 'Contact',
    'footer.privacy': 'Privacy Policy',
    'home.category': 'Category',
    'home.tagList': 'Tag list',
    'common.all': 'All',
    'common.loading': 'Loading...',
    'common.noPosts': 'No posts yet.',
    'card.placeholder': 'Image or number',
    'card.tagFallback': 'Tag',
    'card.draft': 'draft',
    'detail.prev': '< Previous',
    'detail.next': 'Next >',
    'detail.created': 'Created',
    'detail.updated': 'Updated',
    'detail.related': 'Related posts',
    'detail.tagFallback': 'tag',
    'admin.menu': 'Admin menu',
    'admin.actions': 'Admin actions',
    'admin.login': 'admin login',
    'admin.loginTitle': 'Admin login',
    'admin.username': 'Username',
    'admin.password': 'Password',
    'admin.cancel': 'Cancel',
    'admin.submit': 'Login',
    'admin.editCurrent': 'edit current post',
    'admin.write': 'write post',
    'admin.pageManager': 'page manager',
    'admin.logout': 'logout'
  },
  ko: {
    'nav.home': '홈',
    'nav.about': '소개',
    'nav.tool': '도구',
    'nav.game': '게임',
    'nav.blog': '블로그',
    'nav.langToggle': 'KR / EN',
    'footer.contact': '문의',
    'footer.privacy': '개인정보 처리방침',
    'home.category': '카테고리',
    'home.tagList': '태그 목록',
    'common.all': '전체',
    'common.loading': '불러오는 중...',
    'common.noPosts': '게시글이 없습니다.',
    'card.placeholder': '이미지 혹은 숫자',
    'card.tagFallback': '태그',
    'card.draft': '임시저장',
    'detail.prev': '< 이전글',
    'detail.next': '다음글 >',
    'detail.created': '작성일',
    'detail.updated': '수정일',
    'detail.related': '관련 글',
    'detail.tagFallback': '태그',
    'admin.menu': '관리자 메뉴',
    'admin.actions': '관리자 동작',
    'admin.login': '관리자 로그인',
    'admin.loginTitle': '관리자 로그인',
    'admin.username': '아이디',
    'admin.password': '비밀번호',
    'admin.cancel': '취소',
    'admin.submit': '로그인',
    'admin.editCurrent': '현재 글 수정',
    'admin.write': '글쓰기',
    'admin.pageManager': '페이지 관리',
    'admin.logout': '로그아웃'
  }
};

export function t(lang: SiteLang, key: UiTextKey): string {
  return UI_TEXT[lang][key] || UI_TEXT.en[key];
}

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
    blog: { en: 'Blog', ko: '블로그' },
    tools: { en: 'Tool', ko: '도구' },
    games: { en: 'Game', ko: '게임' },
    pages: { en: 'Page', ko: '페이지' }
  };
  return map[section][lang];
}

export function sectionNavLabel(section: SiteSection, lang: SiteLang): string {
  if (section === 'tools') return t(lang, 'nav.tool');
  if (section === 'games') return t(lang, 'nav.game');
  if (section === 'blog') return t(lang, 'nav.blog');
  return lang === 'ko' ? '페이지' : 'PAGE';
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
