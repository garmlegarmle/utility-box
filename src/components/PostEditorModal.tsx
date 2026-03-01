import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPost, deletePost, deleteTag, listPosts, listTags, updatePost, uploadMedia } from '../lib/api';
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

function dedupeTagList(values: string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of values) {
    const clean = raw.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!map.has(key)) map.set(key, clean);
  }
  return [...map.values()];
}

function parseTagInput(value: string): string[] {
  return dedupeTagList(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
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

function normalizeBodyHtml(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  doc.querySelectorAll('h1').forEach((node) => {
    const replacement = doc.createElement('h2');
    replacement.innerHTML = node.innerHTML;
    node.parentNode?.replaceChild(replacement, node);
  });
  return doc.body.innerHTML;
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
  const [metaTitle, setMetaTitle] = useState(initialPost?.meta?.title || '');
  const [metaDescription, setMetaDescription] = useState(initialPost?.meta?.description || '');
  const [schemaType, setSchemaType] = useState<'BlogPosting' | 'Service'>(
    initialPost?.schemaType || (initialPost?.section === 'tools' || initialPost?.section === 'games' ? 'Service' : 'BlogPosting')
  );
  const [ogTitle, setOgTitle] = useState(initialPost?.og?.title || '');
  const [ogDescription, setOgDescription] = useState(initialPost?.og?.description || '');
  const [ogImageUrl, setOgImageUrl] = useState(initialPost?.og?.imageUrl || '');
  const [ogImageAlt, setOgImageAlt] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>(initialPost?.tags || []);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');

  const [cardTitle, setCardTitle] = useState(initialPost?.card.title || initialPost?.title || '');
  const [cardCategory, setCardCategory] = useState(initialPost?.card.category || initialPost?.section || defaultSection);
  const [selectedCardTags, setSelectedCardTags] = useState<string[]>(
    parseTagInput(initialPost?.card.tag || (initialPost?.tags || []).join(', '))
  );
  const [cardTagDraft, setCardTagDraft] = useState('');
  const [cardRank, setCardRank] = useState(stripRank(initialPost?.card.rank));
  const [cardImageId, setCardImageId] = useState<number | null>(initialPost?.card.imageId ?? null);
  const [cardImageUrl, setCardImageUrl] = useState(initialPost?.card.imageUrl || '');
  const [cardImageAlt, setCardImageAlt] = useState('');
  const [cardTitleTouched, setCardTitleTouched] = useState(false);
  const [cardCategoryTouched, setCardCategoryTouched] = useState(false);
  const [cardTagsTouched, setCardTagsTouched] = useState(false);
  const [cardRankTouched, setCardRankTouched] = useState(false);
  const [bodyImageAlt, setBodyImageAlt] = useState('');
  const [internalLinkQuery, setInternalLinkQuery] = useState('');
  const [internalLinkResults, setInternalLinkResults] = useState<PostItem[]>([]);

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
    setMetaTitle(initialPost?.meta?.title || '');
    setMetaDescription(initialPost?.meta?.description || '');
    setSchemaType(
      initialPost?.schemaType || (initialPost?.section === 'tools' || initialPost?.section === 'games' ? 'Service' : 'BlogPosting')
    );
    setOgTitle(initialPost?.og?.title || '');
    setOgDescription(initialPost?.og?.description || '');
    setOgImageUrl(initialPost?.og?.imageUrl || '');
    setOgImageAlt('');
    setSelectedTags(initialPost?.tags || []);
    setAvailableTags(initialPost?.tags || []);
    setTagDraft('');

    setCardTitle(initialPost?.card.title || initialPost?.title || '');
    setCardCategory(initialPost?.card.category || initialPost?.section || defaultSection);
    setSelectedCardTags(parseTagInput(initialPost?.card.tag || (initialPost?.tags || []).join(', ')));
    setCardTagDraft('');
    setCardRank(stripRank(initialPost?.card.rank));
    setCardImageId(initialPost?.card.imageId ?? null);
    setCardImageUrl(initialPost?.card.imageUrl || '');
    setCardImageAlt('');
    setBodyImageAlt('');
    setInternalLinkQuery('');
    setInternalLinkResults([]);
    setCardTitleTouched(Boolean(initialPost?.card.title && initialPost.card.title !== (initialPost.title || '')));
    setCardCategoryTouched(
      Boolean(initialPost?.card.category && initialPost.card.category !== (initialPost.section || defaultSection))
    );
    setCardTagsTouched(
      Boolean(parseTagInput(initialPost?.card.tag || '').join(',') !== parseTagInput((initialPost?.tags || []).join(',')).join(','))
    );
    setCardRankTouched(Boolean(stripRank(initialPost?.card.rank)));

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

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    async function loadTags() {
      try {
        const response = await listTags({ lang });
        if (canceled) return;
        setAvailableTags((prev) =>
          dedupeTagList([...prev, ...(response.items || []), ...selectedTags, ...selectedCardTags])
        );
      } catch {
        // Keep current local tag cache only.
      }
    }

    void loadTags();
    return () => {
      canceled = true;
    };
  }, [lang, open, selectedCardTags, selectedTags]);

  useEffect(() => {
    if (!open) return;
    if (cardTitleTouched) return;
    setCardTitle(title);
  }, [cardTitleTouched, open, title]);

  useEffect(() => {
    if (!open) return;
    if (cardCategoryTouched) return;
    setCardCategory(section);
  }, [cardCategoryTouched, open, section]);

  useEffect(() => {
    if (!open) return;
    if (cardTagsTouched) return;
    setSelectedCardTags(selectedTags);
  }, [cardTagsTouched, open, selectedTags]);

  useEffect(() => {
    if (!open) return;
    if (mode !== 'create') return;
    if (cardRankTouched) return;
    let canceled = false;

    async function assignDefaultRank() {
      try {
        const response = await listPosts({
          lang,
          status: 'published',
          page: 1,
          limit: 1
        });
        if (canceled) return;
        setCardRank(String((response.total || 0) + 1));
      } catch {
        if (canceled) return;
        setCardRank('1');
      }
    }

    void assignDefaultRank();
    return () => {
      canceled = true;
    };
  }, [cardRankTouched, lang, mode, open]);

  useEffect(() => {
    if (!open) return;
    const query = internalLinkQuery.trim();
    if (!query) {
      setInternalLinkResults([]);
      return;
    }

    let canceled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await listPosts({
          lang,
          q: query,
          status: 'all',
          page: 1,
          limit: 20
        });
        if (canceled) return;
        setInternalLinkResults(response.items || []);
      } catch {
        if (canceled) return;
        setInternalLinkResults([]);
      }
    }, 180);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [internalLinkQuery, lang, open]);

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

  function addTag(raw: string) {
    const next = parseTagInput(raw);
    if (next.length === 0) return;

    setSelectedTags((prev) => dedupeTagList([...prev, ...next]));
    setAvailableTags((prev) => dedupeTagList([...prev, ...next]));
    setTagDraft('');
  }

  function removeTag(raw: string) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return;
    setSelectedTags((prev) => prev.filter((item) => item.trim().toLowerCase() !== key));
  }

  async function removeTagEverywhere(raw: string) {
    const clean = String(raw || '').trim();
    if (!clean) return;
    const confirmed = window.confirm(`Delete tag "${clean}" from all posts in this language?`);
    if (!confirmed) return;

    setLoading(true);
    setError('');
    try {
      await deleteTag(clean, lang);
      const key = clean.toLowerCase();
      setAvailableTags((prev) => prev.filter((tag) => tag.trim().toLowerCase() !== key));
      setSelectedTags((prev) => prev.filter((tag) => tag.trim().toLowerCase() !== key));
      setSelectedCardTags((prev) => prev.filter((tag) => tag.trim().toLowerCase() !== key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tag');
    } finally {
      setLoading(false);
    }
  }

  function addCardTag(raw: string) {
    const next = parseTagInput(raw);
    if (next.length === 0) return;

    setCardTagsTouched(true);
    setSelectedCardTags((prev) => dedupeTagList([...prev, ...next]));
    setAvailableTags((prev) => dedupeTagList([...prev, ...next]));
    setCardTagDraft('');
  }

  function removeCardTag(raw: string) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return;
    setCardTagsTouched(true);
    setSelectedCardTags((prev) => prev.filter((item) => item.trim().toLowerCase() !== key));
  }

  function insertInternalLink(post: PostItem) {
    const anchor = document.createElement('a');
    anchor.href = `/${post.lang}/${post.section}/${post.slug}/`;
    anchor.textContent = post.title;
    insertNodeAtCursor(anchor);

    const spacer = document.createTextNode(' ');
    insertNodeAtCursor(spacer);
  }

  async function uploadAndInsertBodyImage(file: File) {
    const alt = bodyImageAlt.trim();
    if (!alt) {
      setError('Image alt text is required.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await uploadMedia(file, alt);
      const url = result.urls.original || result.urls.thumb_webp;

      const image = document.createElement('img');
      image.className = 'editor-inline-image';
      image.src = url;
      image.alt = alt;
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
      applyImageAlignment(image, 'center');
      insertNodeAtCursor(image);

      const paragraph = document.createElement('p');
      paragraph.innerHTML = '<br>';
      insertNodeAtCursor(paragraph);

      selectedImageRef.current = image;
      setBodyImageAlt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function uploadCardImage(file: File) {
    const alt = cardImageAlt.trim();
    if (!alt) {
      setError('Card image alt text is required.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await uploadMedia(file, alt);
      setCardImageId(result.mediaId);
      setCardImageUrl(result.urls.thumb_webp || result.urls.original);
      setCardImageAlt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Card image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function uploadOgImage(file: File) {
    const alt = ogImageAlt.trim();
    if (!alt) {
      setError('OG image alt text is required.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await uploadMedia(file, alt);
      setOgImageUrl(result.urls.original || result.urls.thumb_webp || '');
      setOgImageAlt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OG image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setError('');

    const normalizedTitle = title.trim();
    const normalizedSlug = slugify(slug || normalizedTitle);
    const rawHtml = syncEditorHtml().trim();
    const html = normalizeBodyHtml(rawHtml).trim();

    if (!normalizedTitle || !normalizedSlug || isEditorHtmlEmpty(html)) {
      setError('title, slug, content are required.');
      return;
    }

    const parsedTags = dedupeTagList(selectedTags);
    const parsedCardTags = dedupeTagList(selectedCardTags);
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
      meta: {
        title: metaTitle.trim() || null,
        description: metaDescription.trim() || null
      },
      og: {
        title: ogTitle.trim() || null,
        description: ogDescription.trim() || null,
        imageUrl: ogImageUrl.trim() || null
      },
      schemaType,
      card: {
        title: cardTitle.trim() || normalizedTitle,
        category: cardCategory.trim() || section,
        tag: parsedCardTags.join(', ') || parsedTags.join(', ') || 'Tag',
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
      meta: {
        title: metaTitle.trim(),
        description: metaDescription.trim()
      },
      og: {
        title: ogTitle.trim(),
        description: ogDescription.trim(),
        image_url: ogImageUrl.trim()
      },
      schema_type: schemaType,
      card: {
        title: snapshot.card.title,
        category: snapshot.card.category,
        tag: parsedCardTags.join(', ') || parsedTags.join(', ') || '',
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

            <div className="admin-card-settings">
              <h3>SEO</h3>
              <label>
                Meta Title
                <input
                  value={metaTitle}
                  maxLength={60}
                  onChange={(event) => setMetaTitle(event.target.value)}
                  placeholder="Meta title (max 60)"
                />
                <span className="list-tags">{metaTitle.length}/60</span>
              </label>
              <label>
                Meta Description
                <textarea
                  value={metaDescription}
                  maxLength={160}
                  onChange={(event) => setMetaDescription(event.target.value)}
                  placeholder="Meta description (155-160)"
                />
                <span className="list-tags">
                  {metaDescription.length}/160 {metaDescription.length >= 155 && metaDescription.length <= 160 ? '(ideal)' : ''}
                </span>
              </label>
              <label>
                Schema Type
                <select value={schemaType} onChange={(event) => setSchemaType(event.target.value as 'BlogPosting' | 'Service')}>
                  <option value="BlogPosting">BlogPosting</option>
                  <option value="Service">Service</option>
                </select>
              </label>
            </div>

            <div className="admin-card-settings">
              <h3>Open Graph</h3>
              <label>
                OG Title
                <input value={ogTitle} onChange={(event) => setOgTitle(event.target.value)} placeholder="OG title" />
              </label>
              <label>
                OG Description
                <textarea value={ogDescription} onChange={(event) => setOgDescription(event.target.value)} placeholder="OG description" />
              </label>
              <div className="admin-inline-grid">
                <label>
                  OG Image URL
                  <input value={ogImageUrl} onChange={(event) => setOgImageUrl(event.target.value)} placeholder="https://..." />
                </label>
                <label>
                  OG Image Alt (required)
                  <input value={ogImageAlt} onChange={(event) => setOgImageAlt(event.target.value)} placeholder="Describe image" />
                </label>
                <label>
                  OG Image Upload
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) await uploadOgImage(file);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

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

            <div className="notice-tag-builder">
              <p className="notice-tag-builder__label">Tags</p>
              <div className="notice-tag-builder__chips">
                {selectedTags.map((tag) => (
                  <button
                    key={tag.toLowerCase()}
                    type="button"
                    className="notice-tag-chip"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                  >
                    {tag} x
                  </button>
                ))}
                {selectedTags.length === 0 ? <span className="list-tags">No tags selected.</span> : null}
              </div>

              <div className="notice-tag-builder__input-row">
                <input
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  placeholder="Type tag and press Enter"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      addTag(tagDraft);
                    }
                  }}
                />
                <button type="button" className="admin-btn admin-btn--secondary" onClick={() => addTag(tagDraft)}>
                  add
                </button>
              </div>

              <div className="notice-tag-builder__suggestions">
                {availableTags
                  .filter(
                    (tag) => !selectedTags.some((picked) => picked.trim().toLowerCase() === tag.trim().toLowerCase())
                  )
                  .slice(0, 30)
                  .map((tag) => (
                    <span key={`suggestion-${tag.toLowerCase()}`} className="notice-tag-suggestion-wrap">
                      <button type="button" className="notice-tag-suggestion" onClick={() => addTag(tag)}>
                        {tag}
                      </button>
                      <button
                        type="button"
                        className="notice-tag-delete"
                        onClick={() => {
                          void removeTagEverywhere(tag);
                        }}
                        aria-label={`Delete tag ${tag}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
              </div>
            </div>

            <div className="admin-card-settings">
              <h3>Card Settings</h3>
              <label>
                Card Title
                <input
                  value={cardTitle}
                  onChange={(event) => {
                    setCardTitleTouched(true);
                    setCardTitle(event.target.value);
                  }}
                  placeholder="Card title"
                />
              </label>
              <div className="admin-inline-grid">
                <label>
                  Card Category
                  <input
                    value={cardCategory}
                    onChange={(event) => {
                      setCardCategoryTouched(true);
                      setCardCategory(event.target.value);
                    }}
                    placeholder="blog"
                  />
                </label>
                <label>
                  Post Number
                  <input
                    value={cardRank}
                    onChange={(event) => {
                      setCardRankTouched(true);
                      setCardRank(event.target.value);
                    }}
                    placeholder="1"
                  />
                </label>
              </div>

              <div className="notice-tag-builder">
                <p className="notice-tag-builder__label">Card Tags</p>
                <div className="notice-tag-builder__chips">
                  {selectedCardTags.map((tag) => (
                    <button
                      key={`card-tag-${tag.toLowerCase()}`}
                      type="button"
                      className="notice-tag-chip"
                      onClick={() => removeCardTag(tag)}
                    >
                      {tag} x
                    </button>
                  ))}
                  {selectedCardTags.length === 0 ? <span className="list-tags">No card tags selected.</span> : null}
                </div>
                <div className="notice-tag-builder__input-row">
                  <input
                    value={cardTagDraft}
                    onChange={(event) => setCardTagDraft(event.target.value)}
                    placeholder="Type card tag and press Enter"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        addCardTag(cardTagDraft);
                      }
                    }}
                  />
                  <button type="button" className="admin-btn admin-btn--secondary" onClick={() => addCardTag(cardTagDraft)}>
                    add
                  </button>
                </div>
                <div className="notice-tag-builder__suggestions">
                  {availableTags
                    .filter(
                      (tag) =>
                        !selectedCardTags.some((picked) => picked.trim().toLowerCase() === tag.trim().toLowerCase())
                    )
                    .slice(0, 30)
                    .map((tag) => (
                      <span key={`card-suggestion-${tag.toLowerCase()}`} className="notice-tag-suggestion-wrap">
                        <button type="button" className="notice-tag-suggestion" onClick={() => addCardTag(tag)}>
                          {tag}
                        </button>
                        <button
                          type="button"
                          className="notice-tag-delete"
                          onClick={() => {
                            void removeTagEverywhere(tag);
                          }}
                          aria-label={`Delete tag ${tag}`}
                        >
                          x
                        </button>
                      </span>
                    ))}
                </div>
              </div>

              <div className="admin-inline-grid">
                <label>
                  Card Image Alt (required)
                  <input
                    value={cardImageAlt}
                    onChange={(event) => setCardImageAlt(event.target.value)}
                    placeholder="Describe card image"
                  />
                </label>
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
              <p className="list-tags">H1 is generated automatically from the post title. Use H2/H3 in body.</p>

              <div className="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
                <label className="editor-toolbar__label">
                  Style
                  <select
                    className="editor-toolbar__select"
                    defaultValue="p"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'h2') exec('formatBlock', 'H2');
                      else if (value === 'h3') exec('formatBlock', 'H3');
                      else exec('formatBlock', 'P');
                      event.currentTarget.value = 'p';
                    }}
                  >
                    <option value="p">Normal</option>
                    <option value="h2">H2</option>
                    <option value="h3">H3</option>
                  </select>
                </label>
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
                <label className="editor-toolbar__label">
                  Image Alt
                  <input
                    className="editor-toolbar__alt"
                    value={bodyImageAlt}
                    onChange={(event) => setBodyImageAlt(event.target.value)}
                    placeholder="Required alt text"
                  />
                </label>
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

              <div className="admin-card-settings">
                <h3>Internal Link</h3>
                <label>
                  Search posts
                  <input
                    value={internalLinkQuery}
                    onChange={(event) => setInternalLinkQuery(event.target.value)}
                    placeholder="Search by title/content"
                  />
                </label>
                <div className="internal-link-list">
                  {internalLinkResults.map((item) => (
                    <button
                      key={`internal-link-${item.id}`}
                      type="button"
                      className="internal-link-item"
                      onClick={() => insertInternalLink(item)}
                    >
                      {item.title} ({item.lang}/{item.section})
                    </button>
                  ))}
                  {internalLinkQuery.trim() && internalLinkResults.length === 0 ? (
                    <p className="list-tags">No results.</p>
                  ) : null}
                </div>
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
