import { Link } from 'react-router-dom';
import { t } from '../lib/site';
import type { SiteLang } from '../types';

interface SiteFooterProps {
  lang: SiteLang;
}

export function SiteFooter({ lang }: SiteFooterProps) {
  const year = new Date().getFullYear();
  const meta =
    lang === 'ko'
      ? `© ${year} Utility Box. 실용적인 도구와 가이드.`
      : `© ${year} Utility Box. Practical tools and guides.`;

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <p className="footer-meta">{meta}</p>
        <div className="footer-links">
          <Link className="text-link" to={`/${lang}/pages/contact/`}>
            {t(lang, 'footer.contact')}
          </Link>
          <Link className="text-link" to={`/${lang}/pages/privacy-policy/`}>
            {t(lang, 'footer.privacy')}
          </Link>
        </div>
      </div>
    </footer>
  );
}
