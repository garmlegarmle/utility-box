import { useState } from 'react';

interface AdminDockProps {
  showLogin: boolean;
  isAdmin: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onWrite: () => void;
  onManagePages?: () => void;
  onEditCurrent?: () => void;
}

export function AdminDock({ showLogin, isAdmin, onLogin, onLogout, onWrite, onManagePages, onEditCurrent }: AdminDockProps) {
  const [open, setOpen] = useState(false);

  if (!showLogin && !isAdmin) return null;

  return (
    <div className="admin-dock">
      <button
        type="button"
        className="admin-fab"
        aria-label="Admin menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        +
      </button>

      {open ? (
        <div className="admin-menu" role="menu" aria-label="Admin actions">
          {!isAdmin ? (
            <button type="button" className="admin-menu__item" role="menuitem" onClick={onLogin}>
              admin login
            </button>
          ) : (
            <>
              {onEditCurrent ? (
                <button type="button" className="admin-menu__item" role="menuitem" onClick={onEditCurrent}>
                  edit current post
                </button>
              ) : null}
              <button type="button" className="admin-menu__item" role="menuitem" onClick={onWrite}>
                write post
              </button>
              {onManagePages ? (
                <button type="button" className="admin-menu__item" role="menuitem" onClick={onManagePages}>
                  page manager
                </button>
              ) : null}
              <button type="button" className="admin-menu__item" role="menuitem" onClick={onLogout}>
                logout
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
