import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPost, deletePost, updatePost, uploadMedia } from '../lib/api';
import type { PostItem, PostSaveSnapshot, SiteLang, SiteSection } from '../types';

interface PostEditorModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialPost?: PostItem | null;
  defaultLang: SiteLang;
  defaultSection: SiteSection;
  onClose: () => void;
  onSaved: (snapshot: PostSaveSnapshot) => void;
  onDeleted?: () => void;
}

const RESIZE_EDGE_THRESHOLD = 14;

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

function parseRankNumber(value: string): number | null {
  const match = String(value || '').match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseTags(value: string): string[] {
  const map = new Map<string, string>();
  for (const raw of String(value || '').split(',')) {
    const clean = raw.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!map.has(key)) map.set(key, clean);
  }
  return [...map.values()];
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toInitialEditorHtml(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '<p><br></p>';

  if (/<[a-z][\s\S]*>/i.test(value)) return value;

  const paragraphHtml = escapeHtml(value)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return paragraphHtml || '<p><br></p>';
}

function isEditorHtmlEmpty(html: string): boolean {
  const raw = String(html || '').trim();
  if (!raw) return true;

  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hasMedia = /<(img|video|iframe|table|ul|ol|blockquote)\b/i.test(raw);
  return !text && !hasMedia;
}

function moveCaretAfter(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function applyImageAlignment(image: HTMLImageElement, align: 'left' | 'center' | 'right') {
  image.dataset.align = align;
  image.style.display = 'block';

  if (align === 'left') {
    image.style.marginLeft = '0';
    image.style.marginRight = 'auto';
  } else if (align === 'right') {
    image.style.marginLeft = 'auto';
    image.style.marginRight = '0';
  } else {
    image.style.marginLeft = 'auto';
    image.style.marginRight = 'auto';
  }
}

function isNearRightEdge(image: HTMLImageElement, clientX: number): boolean {
  const rect = image.getBoundingClientRect();
  return clientX >= rect.right - RESIZE_EDGE_THRESHOLD && clientX <= rect.right + 2;
}

function clearEdgeHoverStyles(editor: HTMLDivElement | null) {
  if (!editor) return;
  editor.style.cursor = '';
  editor
    .querySelectorAll('img.editor-inline-image.is-edge-hover')
    .forEach((node) => node.classList.remove('is-edge-hover'));
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
  const [status, setStatus] = useState<'draft' | 'published'>(initialPost?.status || 'published');
  const [tagsInput, setTagsInput] = useState((initialPost?.tags || []).join(', '));

  const [cardTitle, setCardTitle] = useState(initialPost?.card.title || initialPost?.title || '');
  const [cardCategory, setCardCategory] = useState(initialPost?.card.category || initialPost?.section || defaultSection);
  const [cardTag, setCardTag] = useState(initialPost?.card.tag || initialPost?.tags[0] || '');
  const [cardRank, setCardRank] = useState(stripRank(initialPost?.card.rank));
  const [cardImageId, setCardImageId] = useState<number | null>(initialPost?.card.imageId ?? null);
  const [cardImageUrl, setCardImageUrl] = useState(initialPost?.card.imageUrl || '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const editorRef = useRef<HTMLDivElement | null>(null);
  const selectedImageRef = useRef<HTMLImageElement | null>(null);
  const resizeStateRef = useRef<{
    image: HTMLImageElement;
    startX: number;
    startWidth: number;
  } | null>(null);

  const canDelete = mode === 'edit' && Boolean(initialPost?.id);
  const titleText = useMemo(() => (mode === 'edit' ? 'Edit Post' : 'Write Post'), [mode]);

  useEffect(() => {
    const nextHtml = toInitialEditorHtml(initialPost?.content_md || '');

    setTitle(initialPost?.title || '');
    setSlug(initialPost?.slug || '');
    setExcerpt(initialPost?.excerpt || '');
    setLang(initialPost?.lang || defaultLang);
    setSection(initialPost?.section || defaultSection);
    setStatus(initialPost?.status || 'published');
    setTagsInput((initialPost?.tags || []).join(', '));

    setCardTitle(initialPost?.card.title || initialPost?.title || '');
    setCardCategory(initialPost?.card.category || initialPost?.section || defaultSection);
    setCardTag(initialPost?.card.tag || initialPost?.tags[0] || '');
    setCardRank(stripRank(initialPost?.card.rank));
    setCardImageId(initialPost?.card.imageId ?? null);
    setCardImageUrl(initialPost?.card.imageUrl || '');

    selectedImageRef.current = null;
    resizeStateRef.current = null;
    setError('');
    setLoading(false);

    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = nextHtml;
        clearEdgeHoverStyles(editorRef.current);
      }
    });
  }, [defaultLang, defaultSection, initialPost, open]);

  useEffect(() => {
    if (!open) return undefined;

    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;

      const editorWidth = editorRef.current?.clientWidth || 900;
      const delta = event.clientX - state.startX;
      const nextWidth = Math.max(120, Math.min(editorWidth - 24, state.startWidth + delta));
      state.image.style.width = `${nextWidth}px`;
      state.image.style.height = 'auto';
    };

    const onMouseUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.classList.remove('is-resizing-editor-image');
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('is-resizing-editor-image');
      resizeStateRef.current = null;
      clearEdgeHoverStyles(editorRef.current);
    };
  }, [open]);

  if (!open) return null;

  function syncEditorHtml(): string {
    return editorRef.current?.innerHTML || '';
  }

  function focusEditor() {
    editorRef.current?.focus();
  }

  function exec(command: string, value?: string) {
    focusEditor();
    document.execCommand(command, false, value || '');
  }

  function insertNodeAtCursor(node: Node) {
    focusEditor();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      editorRef.current?.appendChild(node);
      moveCaretAfter(node);
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    moveCaretAfter(node);
  }

  function setSelectedImageFromEvent(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      selectedImageRef.current = null;
      return;
    }

    const image = target.closest('img.editor-inline-image') as HTMLImageElement | null;
    selectedImageRef.current = image;
  }

  function handleEditorMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (resizeStateRef.current) return;

    const editor = editorRef.current;
    const target = event.target as HTMLElement | null;

    if (target instanceof HTMLImageElement && target.classList.contains('editor-inline-image')) {
      const nearEdge = isNearRightEdge(target, event.clientX);
      target.classList.toggle('is-edge-hover', nearEdge);

      if (editor) {
        editor.style.cursor = nearEdge ? 'ew-resize' : '';
      }
      return;
    }

    clearEdgeHoverStyles(editor);
  }

  function startImageResize(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.classList.contains('editor-inline-image')) return;
    if (!isNearRightEdge(target, event.clientX)) return;

    resizeStateRef.current = {
      image: target,
      startX: event.clientX,
      startWidth: target.getBoundingClientRect().width
    };

    selectedImageRef.current = target;
    document.body.classList.add('is-resizing-editor-image');
    event.preventDefault();
  }

  function setSelectedImageAlign(align: 'left' | 'center' | 'right') {
    const image = selectedImageRef.current;
    if (!image) return;
    applyImageAlignment(image, align);
  }

  function deleteSelectedImage() {
    const image = selectedImageRef.current;
    if (!image) return;
    image.remove();
    selectedImageRef.current = null;
  }

  async function uploadAndInsertBodyImage(file: File) {
    setLoading(true);
    setError('');

    try {
      const result = await uploadMedia(file);
      const url = result.urls.original || result.urls.thumb_webp;

      const image = document.createElement('img');
      image.className = 'editor-inline-image';
      image.src = url;
      image.alt = file.name;
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
      applyImageAlignment(image, 'center');
      insertNodeAtCursor(image);

      const paragraph = document.createElement('p');
      paragraph.innerHTML = '<br>';
      insertNodeAtCursor(paragraph);

      selectedImageRef.current = image;
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

  async function handleSave() {
    setError('');

    const normalizedTitle = title.trim();
    const normalizedSlug = slugify(slug || normalizedTitle);
    const html = syncEditorHtml().trim();

    if (!normalizedTitle || !normalizedSlug || isEditorHtmlEmpty(html)) {
      setError('title, slug, content are required.');
      return;
    }

    const parsedTags = parseTags(tagsInput);
    const normalizedExcerpt = excerpt.trim() || null;
    const rankNumber = parseRankNumber(cardRank.trim());

    const snapshot: PostSaveSnapshot = {
      id: initialPost?.id || 0,
      slug: normalizedSlug,
      title: normalizedTitle,
      excerpt: normalizedExcerpt,
      status,
      lang,
      section,
      updated_at: new Date().toISOString(),
      tags: parsedTags,
      card: {
        title: cardTitle.trim() || normalizedTitle,
        category: cardCategory.trim() || section,
        tag: cardTag.trim() || parsedTags[0] || 'Tag',
        rank: rankNumber ? `#${rankNumber}` : null,
        rankNumber,
        imageId: cardImageId,
        imageUrl: cardImageUrl || null
      }
    };

    const payload = {
      slug: normalizedSlug,
      title: normalizedTitle,
      excerpt: normalizedExcerpt || '',
      content_md: html,
      status,
      lang,
      section,
      tags: parsedTags,
      card: {
        title: snapshot.card.title,
        category: snapshot.card.category,
        tag: snapshot.card.tag,
        rank: rankNumber ? String(rankNumber) : '',
        image_id: cardImageId
      }
    };

    setLoading(true);
    try {
      if (mode === 'create') {
        const result = await createPost(payload);
        onSaved({ ...snapshot, id: result.id, slug: result.slug || snapshot.slug });
      } else if (initialPost?.id) {
        const result = await updatePost(initialPost.id, payload);
        onSaved({
          ...snapshot,
          id: result.id,
          slug: result.slug || snapshot.slug,
          lang: (result.lang as SiteLang) || snapshot.lang,
          section: (result.section as SiteSection) || snapshot.section,
          updated_at: result.updated_at || snapshot.updated_at
        });
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
          <div>
            <h2>{titleText}</h2>
            <p className="admin-status-note">Current status: {status}</p>
          </div>
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
                  <option value="tools">tool</option>
                  <option value="games">game</option>
                  <option value="pages">page</option>
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
              <h3>Body</h3>

              <div className="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
                <button type="button" onClick={() => exec('bold')} aria-label="Bold">
                  <strong>B</strong>
                </button>
                <button type="button" onClick={() => exec('italic')} aria-label="Italic">
                  <em>I</em>
                </button>
                <button type="button" onClick={() => exec('underline')} aria-label="Underline">
                  <u>U</u>
                </button>
                <button type="button" onClick={() => exec('strikeThrough')} aria-label="Strike">
                  <s>S</s>
                </button>
                <button type="button" onClick={() => exec('insertUnorderedList')} aria-label="Bullet list">
                  • List
                </button>
                <button type="button" onClick={() => exec('insertOrderedList')} aria-label="Numbered list">
                  1. List
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const href = window.prompt('Link URL');
                    if (href && href.trim()) exec('createLink', href.trim());
                  }}
                  aria-label="Insert link"
                >
                  Link
                </button>
                <button type="button" onClick={() => exec('removeFormat')} aria-label="Clear format">
                  Tx
                </button>
                <button type="button" onClick={() => exec('justifyLeft')} aria-label="Align left">
                  Left
                </button>
                <button type="button" onClick={() => exec('justifyCenter')} aria-label="Align center">
                  Center
                </button>
                <button type="button" onClick={() => exec('justifyRight')} aria-label="Align right">
                  Right
                </button>
                <label className="editor-toolbar__upload">
                  Image
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

              <div
                ref={editorRef}
                className="editor-surface"
                contentEditable
                suppressContentEditableWarning
                onClick={(event) => {
                  setSelectedImageFromEvent(event.target);
                }}
                onMouseMove={handleEditorMouseMove}
                onMouseLeave={() => clearEdgeHoverStyles(editorRef.current)}
                onMouseDown={startImageResize}
              />

              <div className="editor-image-tools">
                <span>Image</span>
                <button type="button" onClick={() => setSelectedImageAlign('left')}>
                  Left
                </button>
                <button type="button" onClick={() => setSelectedImageAlign('center')}>
                  Center
                </button>
                <button type="button" onClick={() => setSelectedImageAlign('right')}>
                  Right
                </button>
                <button type="button" onClick={deleteSelectedImage}>
                  Delete image
                </button>
                <span className="list-tags">Drag image edge to resize</span>
              </div>
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
