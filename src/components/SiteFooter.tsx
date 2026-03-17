import { Link } from 'react-router-dom';
import { t } from '../lib/site';
import type { SiteLang } from '../types';

interface SiteFooterProps {
  lang: SiteLang;
}

export function SiteFooter({ lang }: SiteFooterProps) {
  void lang;
  const meta = '© 2026–Present GA-ML. All rights reserved.';

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
