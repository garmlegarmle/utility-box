import { useEffect, useMemo, useState } from 'react';
import { deletePost, listPosts, updatePost } from '../lib/api';
import { sectionLabel } from '../lib/site';
import type { PostItem, SiteLang, SiteSection } from '../types';

interface PageManagerModalProps {
  open: boolean;
  defaultLang: SiteLang;
  onClose: () => void;
  onCreate: (section: SiteSection, lang: SiteLang) => void;
  onEdit: (post: PostItem) => void;
  onChanged: () => void;
}

type SectionFilter = SiteSection | 'all';
type StatusFilter = 'all' | 'draft' | 'published';

export function PageManagerModal({ open, defaultLang, onClose, onCreate, onEdit, onChanged }: PageManagerModalProps) {
  const [lang, setLang] = useState<SiteLang>(defaultLang);
  const [section, setSection] = useState<SectionFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [items, setItems] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLang(defaultLang);
    setSection('all');
    setStatus('all');
    setError('');
  }, [defaultLang, open]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await listPosts({
          lang,
          section: section === 'all' ? undefined : section,
          status,
          page: 1,
          limit: 300
        });
        if (canceled) return;
        setItems(Array.isArray(response.items) ? response.items : []);
      } catch (err) {
        if (canceled) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [lang, open, section, status]);

  const publishedCount = useMemo(() => items.filter((item) => item.status === 'published').length, [items]);
  const draftCount = useMemo(() => items.filter((item) => item.status === 'draft').length, [items]);

  if (!open) return null;

  async function togglePublish(post: PostItem) {
    const nextStatus = post.status === 'published' ? 'draft' : 'published';
    setBusyId(post.id);
    setError('');
    try {
      const result = await updatePost(post.id, {
        status: nextStatus,
        published_at: nextStatus === 'published' ? new Date().toISOString() : null
      });

      setItems((prev) =>
        prev.map((item) =>
          item.id === post.id
            ? {
                ...item,
                status: nextStatus,
                updated_at: result.updated_at || new Date().toISOString(),
                published_at: nextStatus === 'published' ? item.published_at || new Date().toISOString() : null
              }
            : item
        )
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(post: PostItem) {
    const confirmed = window.confirm(`Delete "${post.title}"?`);
    if (!confirmed) return;

    setBusyId(post.id);
    setError('');
    try {
      await deletePost(post.id);
      setItems((prev) => prev.filter((item) => item.id !== post.id));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete post');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Page manager">
      <div className="admin-modal__backdrop" onClick={onClose} />
      <div className="admin-modal__panel admin-page-manager">
        <div className="admin-modal__header">
          <div>
            <h2>Page Manager</h2>
            <p className="admin-status-note">
              total {items.length} / published {publishedCount} / draft {draftCount}
            </p>
          </div>
          <button type="button" className="admin-modal__close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="admin-modal__body">
          <div className="admin-page-manager__controls">
            <label>
              Language
              <select value={lang} onChange={(event) => setLang(event.target.value as SiteLang)}>
                <option value="en">en</option>
                <option value="ko">ko</option>
              </select>
            </label>
            <label>
              Section
              <select value={section} onChange={(event) => setSection(event.target.value as SectionFilter)}>
                <option value="all">all</option>
                <option value="blog">blog</option>
                <option value="tools">tool</option>
                <option value="games">game</option>
                <option value="pages">page</option>
              </select>
            </label>
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                <option value="all">all</option>
                <option value="published">published</option>
                <option value="draft">draft</option>
              </select>
            </label>
            <button
              type="button"
              className="admin-btn"
              onClick={() => onCreate(section === 'all' ? 'blog' : section, lang)}
            >
              create
            </button>
          </div>

          {loading ? <p className="list-tags">Loading...</p> : null}
          {error ? <p className="admin-error">{error}</p> : null}

          <div className="admin-page-manager__table-wrap">
            <table className="admin-page-manager__table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Section</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((post) => (
                  <tr key={post.id}>
                    <td>
                      <div className="admin-page-manager__title-cell">
                        <strong>{post.title}</strong>
                        <span className="list-tags">/{post.lang}/{post.section}/{post.slug}</span>
                      </div>
                    </td>
                    <td>{sectionLabel(post.section, post.lang)}</td>
                    <td>
                      <span className={`admin-status-pill admin-status-pill--${post.status}`}>{post.status}</span>
                    </td>
                    <td>{new Date(post.updated_at).toLocaleString()}</td>
                    <td>
                      <div className="admin-page-manager__actions">
                        <button
                          type="button"
                          className="admin-btn admin-btn--secondary"
                          disabled={busyId === post.id}
                          onClick={() => onEdit(post)}
                        >
                          edit
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--secondary"
                          disabled={busyId === post.id}
                          onClick={() => {
                            void togglePublish(post);
                          }}
                        >
                          {post.status === 'published' ? 'draft' : 'publish'}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--secondary"
                          disabled={busyId === post.id}
                          onClick={() => {
                            void handleDelete(post);
                          }}
                        >
                          delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <p className="list-tags">No posts found.</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
