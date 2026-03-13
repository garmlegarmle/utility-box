import { useEffect, useState } from 'react';
import { t } from '../lib/site';
import type { SiteLang } from '../types';

interface AdminLoginModalProps {
  open: boolean;
  lang: SiteLang;
  onClose: () => void;
  onSubmit: (username: string, password: string) => Promise<void>;
}

export function AdminLoginModal({ open, lang, onClose, onSubmit }: AdminLoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setPassword('');
    setError('');
    setLoading(false);
  }, [open]);

  if (!open) return null;

  async function handleSubmit() {
    if (!username.trim() || !password) {
      setError(lang === 'ko' ? '아이디와 비밀번호를 입력하세요.' : 'Enter username and password.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onSubmit(username.trim(), password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : lang === 'ko' ? '로그인에 실패했습니다.' : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'admin.loginTitle')}>
      <div className="admin-modal__backdrop" onClick={onClose} />
      <div className="admin-modal__panel admin-login-modal">
        <div className="admin-modal__header">
          <div>
            <h2>{t(lang, 'admin.loginTitle')}</h2>
          </div>
          <button type="button" className="admin-modal__close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>
        <div className="admin-modal__body">
          <div className="admin-form-grid">
            <label>
              {t(lang, 'admin.username')}
              <input
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSubmit();
                }}
              />
            </label>
            <label>
              {t(lang, 'admin.password')}
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSubmit();
                }}
              />
            </label>
            {error ? <p className="admin-error">{error}</p> : null}
            <div className="admin-actions">
              <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose} disabled={loading}>
                {t(lang, 'admin.cancel')}
              </button>
              <button type="button" className="admin-btn" onClick={() => void handleSubmit()} disabled={loading}>
                {loading ? `${t(lang, 'admin.submit')}...` : t(lang, 'admin.submit')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
