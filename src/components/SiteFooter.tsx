import { Link } from 'react-router-dom';
import type { SiteLang } from '../types';

interface SiteFooterProps {
  lang: SiteLang;
}

export function SiteFooter({ lang }: SiteFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <p className="footer-meta">© {year} Utility Box. Practical tools and guides.</p>
        <div className="footer-links">
          <Link className="text-link" to={`/${lang}/pages/contact/`}>
            Contact
          </Link>
          <Link className="text-link" to={`/${lang}/pages/privacy-policy/`}>
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
