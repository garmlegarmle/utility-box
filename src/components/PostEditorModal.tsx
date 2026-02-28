import { useEffect, useMemo, useRef, useState } from 'react';
import { createPost, deletePost, updatePost, uploadMedia } from '../lib/api';
import type { PostItem, SiteLang, SiteSection } from '../types';

interface PostEditorModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialPost?: PostItem | null;
  defaultLang: SiteLang;
  defaultSection: SiteSection;
  onClose: () => void;
  onSaved: (postId: number) => void;
  onDeleted?: () => void;
}

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripRank(value: string | null | undefined): string {
  if (!value) return '';
  const match = String(value).match(/\d+/);
  return match ? match[0] : '';
}

export function PostEditorModal({
  open,
  mode,
  initialPost,
  defaultLang,
  defaultSection,
  onClose,
  onSaved,
  onDeleted
}: PostEditorModalProps) {
  const [title, setTitle] = useState(initialPost?.title || '');
  const [slug, setSlug] = useState(initialPost?.slug || '');
  const [excerpt, setExcerpt] = useState(initialPost?.excerpt || '');
  const [lang, setLang] = useState<SiteLang>(initialPost?.lang || defaultLang);
  const [section, setSection] = useState<SiteSection>(initialPost?.section || defaultSection);
  const [status, setStatus] = useState<'draft' | 'published'>(initialPost?.status || 'draft');
  const [tagsInput, setTagsInput] = useState((initialPost?.tags || []).join(', '));
  const [content, setContent] = useState(initialPost?.content_md || '');

  const [cardTitle, setCardTitle] = useState(initialPost?.card.title || initialPost?.title || '');
  const [cardCategory, setCardCategory] = useState(initialPost?.card.category || initialPost?.section || defaultSection);
  const [cardTag, setCardTag] = useState(initialPost?.card.tag || initialPost?.tags[0] || '');
  const [cardRank, setCardRank] = useState(stripRank(initialPost?.card.rank));
  const [cardImageId, setCardImageId] = useState<number | null>(initialPost?.card.imageId ?? null);
  const [cardImageUrl, setCardImageUrl] = useState(initialPost?.card.imageUrl || '');

  const [coverImageId, setCoverImageId] = useState<number | null>(initialPost?.cover?.id ?? null);
  const [coverImageUrl, setCoverImageUrl] = useState(initialPost?.cover?.url || '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const canDelete = mode === 'edit' && Boolean(initialPost?.id);

  const titleText = useMemo(() => (mode === 'edit' ? 'Edit Post' : 'Write Post'), [mode]);

  useEffect(() => {
    setTitle(initialPost?.title || '');
    setSlug(initialPost?.slug || '');
    setExcerpt(initialPost?.excerpt || '');
    setLang(initialPost?.lang || defaultLang);
    setSection(initialPost?.section || defaultSection);
    setStatus(initialPost?.status || 'draft');
    setTagsInput((initialPost?.tags || []).join(', '));
    setContent(initialPost?.content_md || '');

    setCardTitle(initialPost?.card.title || initialPost?.title || '');
    setCardCategory(initialPost?.card.category || initialPost?.section || defaultSection);
    setCardTag(initialPost?.card.tag || initialPost?.tags[0] || '');
    setCardRank(stripRank(initialPost?.card.rank));
    setCardImageId(initialPost?.card.imageId ?? null);
    setCardImageUrl(initialPost?.card.imageUrl || '');

    setCoverImageId(initialPost?.cover?.id ?? null);
    setCoverImageUrl(initialPost?.cover?.url || '');
    setError('');
    setLoading(false);
  }, [defaultLang, defaultSection, initialPost, open]);

  if (!open) return null;

  function insertAtCursor(text: string) {
    const target = bodyRef.current;
    if (!target) {
      setContent((prev) => `${prev}\n${text}`.trim());
      return;
    }

    const start = target.selectionStart || 0;
    const end = target.selectionEnd || start;
    const next = `${content.slice(0, start)}${text}${content.slice(end)}`;
    setContent(next);

    requestAnimationFrame(() => {
      target.focus();
      const pos = start + text.length;
      target.setSelectionRange(pos, pos);
    });
  }

  async function uploadAndInsertBodyImage(file: File) {
    setLoading(true);
    setError('');
    try {
      const result = await uploadMedia(file);
      const url = result.urls.thumb_webp || result.urls.original;
      insertAtCursor(`\n![${file.name}](${url})\n`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function uploadCardImage(file: File) {
    setLoading(true);
    setError('');
    try {
      const result = await uploadMedia(file);
      setCardImageId(result.mediaId);
      setCardImageUrl(result.urls.thumb_webp || result.urls.original);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Card image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function uploadCoverImage(file: File) {
    setLoading(true);
    setError('');
    try {
      const result = await uploadMedia(file);
      setCoverImageId(result.mediaId);
      setCoverImageUrl(result.urls.original);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setError('');

    const normalizedTitle = title.trim();
    const normalizedSlug = slugify(slug || normalizedTitle);
    const normalizedContent = content.trim();

    if (!normalizedTitle || !normalizedSlug || !normalizedContent) {
      setError('title, slug, content are required.');
      return;
    }

    const payload = {
      slug: normalizedSlug,
      title: normalizedTitle,
      excerpt: excerpt.trim(),
      content_md: normalizedContent,
      status,
      lang,
      section,
      cover_image_id: coverImageId,
      tags: tagsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      card: {
        title: cardTitle.trim() || normalizedTitle,
        category: cardCategory.trim() || section,
        tag: cardTag.trim(),
        rank: cardRank.trim(),
        image_id: cardImageId
      }
    };

    setLoading(true);
    try {
      if (mode === 'create') {
        const result = await createPost(payload);
        onSaved(result.id);
      } else if (initialPost?.id) {
        await updatePost(initialPost.id, payload);
        onSaved(initialPost.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save post');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!canDelete || !initialPost?.id) return;
    const confirmed = window.confirm('Delete this post?');
    if (!confirmed) return;

    setLoading(true);
    setError('');
    try {
      await deletePost(initialPost.id);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete post');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={titleText}>
      <div className="admin-modal__backdrop" onClick={onClose} />
      <div className="admin-modal__panel admin-editor-modal">
        <div className="admin-modal__header">
          <h2>{titleText}</h2>
          <button type="button" className="admin-modal__close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="admin-modal__body">
          <div className="admin-form-grid">
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Post title" />
            </label>

            <label>
              Slug
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                onBlur={() => setSlug((prev) => slugify(prev || title))}
                placeholder="post-slug"
              />
            </label>

            <label>
              Excerpt
              <input value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="Short summary" />
            </label>

            <div className="admin-inline-grid">
              <label>
                Language
                <select value={lang} onChange={(event) => setLang(event.target.value as SiteLang)}>
                  <option value="en">en</option>
                  <option value="ko">ko</option>
                </select>
              </label>

              <label>
                Category
                <select value={section} onChange={(event) => setSection(event.target.value as SiteSection)}>
                  <option value="blog">blog</option>
                  <option value="tools">tools</option>
                  <option value="games">games</option>
                  <option value="pages">pages</option>
                </select>
              </label>

              <label>
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value as 'draft' | 'published')}>
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                </select>
              </label>
            </div>

            <label>
              Tags (comma separated)
              <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="guide, workflow" />
            </label>

            <div className="admin-card-settings">
              <h3>Card Settings</h3>
              <label>
                Card Title
                <input value={cardTitle} onChange={(event) => setCardTitle(event.target.value)} placeholder="Card title" />
              </label>
              <div className="admin-inline-grid">
                <label>
                  Card Category
                  <input value={cardCategory} onChange={(event) => setCardCategory(event.target.value)} placeholder="blog" />
                </label>
                <label>
                  Card Tag
                  <input value={cardTag} onChange={(event) => setCardTag(event.target.value)} placeholder="tag" />
                </label>
                <label>
                  Post Number
                  <input value={cardRank} onChange={(event) => setCardRank(event.target.value)} placeholder="1" />
                </label>
              </div>

              <div className="admin-inline-grid">
                <label>
                  Card Image Upload
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) await uploadCardImage(file);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {cardImageUrl ? <img className="admin-preview-image" src={cardImageUrl} alt="Card preview" /> : null}
              </div>
            </div>

            <div className="admin-card-settings">
              <h3>Cover Image</h3>
              <div className="admin-inline-grid">
                <label>
                  Cover Upload
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) await uploadCoverImage(file);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {coverImageUrl ? <img className="admin-preview-image" src={coverImageUrl} alt="Cover preview" /> : null}
              </div>
            </div>

            <label>
              Body (Markdown/HTML)
              <textarea
                ref={bodyRef}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={16}
                placeholder="Write your content"
              />
            </label>

            <div className="admin-actions">
              <label className="admin-btn admin-btn--secondary admin-file-btn">
                Upload image & insert
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) await uploadAndInsertBodyImage(file);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>

            {error ? <p className="admin-error">{error}</p> : null}

            <div className="admin-actions">
              <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              {canDelete ? (
                <button type="button" className="admin-btn admin-btn--secondary" onClick={handleDelete} disabled={loading}>
                  Delete
                </button>
              ) : null}
              <button type="button" className="admin-btn" onClick={handleSave} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
