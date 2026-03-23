import { useEffect, useRef, useState } from 'react';
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
  onChangePassword?: () => void;
}

export function AdminDock({
  lang,
  showLogin,
  isAdmin,
  onLogin,
  onLogout,
  onWrite,
  onManagePages,
  onEditCurrent,
  onChangePassword
}: AdminDockProps) {
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dockRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleWindowBlur() {
      setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [open]);

  function runMenuAction(action: () => void) {
    setOpen(false);
    action();
  }

  if (!showLogin && !isAdmin) return null;

  return (
    <div className="admin-dock" ref={dockRef}>
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
            <button type="button" className="admin-menu__item" role="menuitem" onClick={() => runMenuAction(onLogin)}>
              {t(lang, 'admin.login')}
            </button>
          ) : (
            <>
              {onEditCurrent ? (
                <button type="button" className="admin-menu__item" role="menuitem" onClick={() => runMenuAction(onEditCurrent)}>
                  {t(lang, 'admin.editCurrent')}
                </button>
              ) : null}
              <button type="button" className="admin-menu__item" role="menuitem" onClick={() => runMenuAction(onWrite)}>
                {t(lang, 'admin.write')}
              </button>
              {onManagePages ? (
                <button type="button" className="admin-menu__item" role="menuitem" onClick={() => runMenuAction(onManagePages)}>
                  {t(lang, 'admin.pageManager')}
                </button>
              ) : null}
              {onChangePassword ? (
                <button type="button" className="admin-menu__item" role="menuitem" onClick={() => runMenuAction(onChangePassword)}>
                  {t(lang, 'admin.changePassword')}
                </button>
              ) : null}
              <button type="button" className="admin-menu__item" role="menuitem" onClick={() => runMenuAction(onLogout)}>
                {t(lang, 'admin.logout')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
