import { useState } from 'react';
import { t } from '../lib/site';
import type { SiteLang } from '../types';

interface AdminDockProps {
  lang: SiteLang;
  showLogin: boolean;
  isAdmin: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onWrite: () => void;
  onManagePages?: () => void;
  onEditCurrent?: () => void;
}

export function AdminDock({
  lang,
  showLogin,
  isAdmin,
  onLogin,
  onLogout,
  onWrite,
  onManagePages,
  onEditCurrent
}: AdminDockProps) {
  const [open, setOpen] = useState(false);

  if (!showLogin && !isAdmin) return null;

  return (
    <div className="admin-dock">
      <button
        type="button"
        className="admin-fab"
        aria-label={t(lang, 'admin.menu')}
        onClick={() => setOpen((prev) => !prev)}
      >
        +
      </button>

      {open ? (
        <div className="admin-menu" role="menu" aria-label={t(lang, 'admin.actions')}>
          {!isAdmin ? (
            <button type="button" className="admin-menu__item" role="menuitem" onClick={onLogin}>
              {t(lang, 'admin.login')}
            </button>
          ) : (
            <>
              {onEditCurrent ? (
                <button type="button" className="admin-menu__item" role="menuitem" onClick={onEditCurrent}>
                  {t(lang, 'admin.editCurrent')}
                </button>
              ) : null}
              <button type="button" className="admin-menu__item" role="menuitem" onClick={onWrite}>
                {t(lang, 'admin.write')}
              </button>
              {onManagePages ? (
                <button type="button" className="admin-menu__item" role="menuitem" onClick={onManagePages}>
                  {t(lang, 'admin.pageManager')}
                </button>
              ) : null}
              <button type="button" className="admin-menu__item" role="menuitem" onClick={onLogout}>
                {t(lang, 'admin.logout')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
