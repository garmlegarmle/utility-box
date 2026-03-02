import { Link, useLocation } from 'react-router-dom';
import { getLanguageTogglePath, sectionNavLabel } from '../lib/site';
import type { SiteLang, SiteSection } from '../types';

interface SiteHeaderProps {
  lang: SiteLang;
  active?: 'home' | SiteSection;
}

const nav: Array<{ key: SiteSection; to: string }> = [
  { key: 'tools', to: 'tools' },
  { key: 'games', to: 'games' },
  { key: 'blog', to: 'blog' }
];

export function SiteHeader({ lang, active }: SiteHeaderProps) {
  const location = useLocation();
  const togglePath = getLanguageTogglePath(location.pathname, lang);
  const isAboutPage = new RegExp(`^/${lang}/pages/about/?$`).test(location.pathname);

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="site-title" to={`/${lang}/`}>
          Utility Box
        </Link>
        <nav className="site-nav" aria-label={lang === 'ko' ? '주요 탐색' : 'Primary navigation'}>
          <Link to={`/${lang}/`} aria-current={active === 'home' ? 'page' : undefined}>
            HOME
          </Link>
          <Link to={`/${lang}/pages/about/`} aria-current={isAboutPage ? 'page' : undefined}>
            ABOUT
          </Link>
          {nav.map((item) => (
            <Link key={item.key} to={`/${lang}/${item.to}/`} aria-current={active === item.key ? 'page' : undefined}>
              {sectionNavLabel(item.key)}
            </Link>
          ))}
          <Link className="lang-toggle" to={togglePath} rel="alternate" hrefLang={lang === 'ko' ? 'en' : 'ko'}>
            EN / KR
          </Link>
        </nav>
      </div>
    </header>
  );
}
