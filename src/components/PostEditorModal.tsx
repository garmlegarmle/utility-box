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
type EditorPaneKey = 'body' | 'before' | 'after';
type ProgramContentLayout = 'above' | 'below' | 'split';

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

function toPlainText(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(rawHtml || ''), 'text/html');
  doc.querySelectorAll('script, style').forEach((node) => node.remove());
  doc.querySelectorAll('br').forEach((node) => node.replaceWith(doc.createTextNode('\n')));
  doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, section, article').forEach((node) => {
    node.append(doc.createTextNode('\n'));
  });
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function toExcerptText(rawHtml: string, maxLength = 180): string {
  const clean = toPlainText(rawHtml);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
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

function createEditorImage(doc: Document, url: string, alt: string): HTMLImageElement {
  const image = doc.createElement('img');
  image.className = 'editor-inline-image';
  image.src = url;
  image.alt = alt;
  image.style.maxWidth = '100%';
  image.style.height = 'auto';
  applyImageAlignment(image, 'center');
  return image;
}

function createEditorParagraph(doc: Document): HTMLParagraphElement {
  const paragraph = doc.createElement('p');
  paragraph.innerHTML = '<br>';
  return paragraph;
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

function isLockedBuiltinProgramPost(post: PostItem | null | undefined): boolean {
  return Boolean(
    post &&
      ((post.section === 'tools' && post.slug === 'trend-analyzer') ||
        (post.section === 'games' && post.slug === 'texas-holdem-tournament'))
  );
}

function hasEmbeddedProgram(section: SiteSection, slug: string): boolean {
  const normalizedSlug = slugify(slug);
  return (
    (section === 'tools' && normalizedSlug === 'trend-analyzer') ||
    (section === 'games' && normalizedSlug === 'texas-holdem-tournament')
  );
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
  const [selectedTags, setSelectedTags] = useState<string[]>(initialPost?.tags || []);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');

  const [cardCategory, setCardCategory] = useState(initialPost?.card.category || initialPost?.section || defaultSection);
  const [cardRank, setCardRank] = useState(stripRank(initialPost?.card.rank));
  const [cardImageId, setCardImageId] = useState<number | null>(initialPost?.card.imageId ?? null);
  const [cardImageUrl, setCardImageUrl] = useState(initialPost?.card.imageUrl || '');
  const [cardImageAlt, setCardImageAlt] = useState('');
  const [cardCategoryTouched, setCardCategoryTouched] = useState(false);
  const [cardRankTouched, setCardRankTouched] = useState(false);
  const [bodyImageAlt, setBodyImageAlt] = useState('');
  const [internalLinkQuery, setInternalLinkQuery] = useState('');
  const [internalLinkResults, setInternalLinkResults] = useState<PostItem[]>([]);
  const [programContentLayout, setProgramContentLayout] = useState<ProgramContentLayout>('below');
  const [activeEditor, setActiveEditor] = useState<EditorPaneKey>('body');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const bodyEditorRef = useRef<HTMLDivElement | null>(null);
  const beforeEditorRef = useRef<HTMLDivElement | null>(null);
  const afterEditorRef = useRef<HTMLDivElement | null>(null);
  const selectedImageRef = useRef<HTMLImageElement | null>(null);
  const resizeStateRef = useRef<{
    image: HTMLImageElement;
    startX: number;
    startWidth: number;
    editor: HTMLDivElement | null;
  } | null>(null);

  const canDelete = mode === 'edit' && Boolean(initialPost?.id);
  const titleText = useMemo(() => (mode === 'edit' ? 'Edit Post' : 'Write Post'), [mode]);
  const isBuiltinProgramPost = useMemo(() => isLockedBuiltinProgramPost(initialPost), [initialPost]);
  const normalizedEditorSlug = useMemo(() => slugify(slug || title), [slug, title]);
  const hasEmbeddedProgramPost = useMemo(
    () => hasEmbeddedProgram(section, normalizedEditorSlug),
    [normalizedEditorSlug, section]
  );

  function getEditorRef(key: EditorPaneKey) {
    if (key === 'before') return beforeEditorRef;
    if (key === 'after') return afterEditorRef;
    return bodyEditorRef;
  }

  function getEditorElement(key: EditorPaneKey): HTMLDivElement | null {
    return getEditorRef(key).current;
  }

  function preferredEditorKey(): EditorPaneKey {
    if (!hasEmbeddedProgramPost) return 'body';
    if (programContentLayout === 'above') return 'before';
    if (programContentLayout === 'below') return 'after';
    return activeEditor === 'before' || activeEditor === 'after' ? activeEditor : 'after';
  }

  function activeEditorLabel(): string {
    const key = preferredEditorKey();
    if (key === 'before') return 'content above the program';
    if (key === 'after') return 'content below the program';
    return 'body';
  }

  function hydrateEditor(ref: { current: HTMLDivElement | null }, html: string) {
    if (!ref.current) return;
    ref.current.innerHTML = html;
    clearEdgeHoverStyles(ref.current);
  }

  function clearAllEditorEdgeHoverStyles() {
    [bodyEditorRef.current, beforeEditorRef.current, afterEditorRef.current].forEach((editor) => clearEdgeHoverStyles(editor));
  }

  useEffect(() => {
    const nextBodyHtml = toInitialEditorHtml(initialPost?.content_md || '');
    const nextBeforeSource = initialPost?.content_before_md || '';
    const nextAfterSource =
      initialPost?.content_after_md || (!initialPost?.content_before_md && !initialPost?.content_after_md ? initialPost?.content_md || '' : '');
    const nextBeforeHtml = toInitialEditorHtml(nextBeforeSource);
    const nextAfterHtml = toInitialEditorHtml(nextAfterSource);
    const embeddedInitial = hasEmbeddedProgram(initialPost?.section || defaultSection, initialPost?.slug || '');
    const nextLayout: ProgramContentLayout = nextBeforeSource.trim()
      ? nextAfterSource.trim()
        ? 'split'
        : 'above'
      : 'below';

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
    setSelectedTags(initialPost?.tags || []);
    setAvailableTags(initialPost?.tags || []);
    setTagDraft('');

    setCardCategory(initialPost?.card.category || initialPost?.section || defaultSection);
    setCardRank(stripRank(initialPost?.card.rank));
    setCardImageId(initialPost?.card.imageId ?? null);
    setCardImageUrl(initialPost?.card.imageUrl || '');
    setCardImageAlt('');
    setBodyImageAlt('');
    setInternalLinkQuery('');
    setInternalLinkResults([]);
    setCardCategoryTouched(
      Boolean(initialPost?.card.category && initialPost.card.category !== (initialPost.section || defaultSection))
    );
    setCardRankTouched(Boolean(stripRank(initialPost?.card.rank)));
    setProgramContentLayout(embeddedInitial ? nextLayout : 'below');
    setActiveEditor(embeddedInitial ? (nextLayout === 'above' ? 'before' : 'after') : 'body');

    selectedImageRef.current = null;
    resizeStateRef.current = null;
    setError('');
    setLoading(false);

    requestAnimationFrame(() => {
      hydrateEditor(bodyEditorRef, nextBodyHtml);
      hydrateEditor(beforeEditorRef, nextBeforeHtml);
      hydrateEditor(afterEditorRef, nextAfterHtml);
    });
  }, [defaultLang, defaultSection, initialPost, open]);

  useEffect(() => {
    if (!open) return undefined;

    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;

      const editorWidth = state.editor?.clientWidth || 900;
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
      clearAllEditorEdgeHoverStyles();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    async function loadTags() {
      try {
        const response = await listTags({ lang });
        if (canceled) return;
        setAvailableTags((prev) => dedupeTagList([...prev, ...(response.items || []), ...selectedTags]));
      } catch {
        // Keep current local tag cache only.
      }
    }

    void loadTags();
    return () => {
      canceled = true;
    };
  }, [lang, open, selectedTags]);

  useEffect(() => {
    if (!open) return;
    if (cardCategoryTouched) return;
    setCardCategory(section);
  }, [cardCategoryTouched, open, section]);

  useEffect(() => {
    if (!open) return;
    if (mode !== 'create') return;
    if (cardRankTouched) return;
    let canceled = false;

    async function assignDefaultRank() {
      try {
        const responses = await Promise.all([
          listPosts({ lang, section: 'blog', status: 'published', page: 1, limit: 1 }),
          listPosts({ lang, section: 'tools', status: 'published', page: 1, limit: 1 }),
          listPosts({ lang, section: 'games', status: 'published', page: 1, limit: 1 })
        ]);
        if (canceled) return;
        const total = responses.reduce((sum, response) => sum + Number(response.total || 0), 0);
        setCardRank(String(total + 1));
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

  function syncEditorHtml(key: EditorPaneKey = preferredEditorKey()): string {
    return getEditorElement(key)?.innerHTML || '';
  }

  function focusEditor(key: EditorPaneKey = preferredEditorKey()) {
    const editor = getEditorElement(key);
    if (!editor) return;
    setActiveEditor(key);
    editor.focus();
  }

  function exec(command: string, value?: string) {
    focusEditor(preferredEditorKey());
    document.execCommand(command, false, value || '');
  }

  function insertNodeAtCursor(node: Node) {
    const editorKey = preferredEditorKey();
    const editor = getEditorElement(editorKey);
    if (!editor) return;
    focusEditor(editorKey);

    const selection = window.getSelection();
    const hasSelectionInEditor =
      selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (!selection || selection.rangeCount === 0 || !hasSelectionInEditor) {
      editor.appendChild(node);
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

    const editor = event.currentTarget;
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

  function startImageResize(event: ReactMouseEvent<HTMLDivElement>, key: EditorPaneKey) {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.classList.contains('editor-inline-image')) return;
    if (!isNearRightEdge(target, event.clientX)) return;

    resizeStateRef.current = {
      image: target,
      startX: event.clientX,
      startWidth: target.getBoundingClientRect().width,
      editor: event.currentTarget
    };

    selectedImageRef.current = target;
    setActiveEditor(key);
    document.body.classList.add('is-resizing-editor-image');
    event.preventDefault();
  }

  function setSelectedImageAlign(align: 'left' | 'center' | 'right') {
    const image = selectedImageRef.current;
    if (!image) return;
    if (image.closest('.editor-image-row')) return;
    applyImageAlignment(image, align);
  }

  function deleteSelectedImage() {
    const image = selectedImageRef.current;
    if (!image) return;
    const row = image.closest('.editor-image-row');
    image.remove();
    if (row && row.querySelectorAll('img.editor-inline-image').length === 0) {
      const paragraph = createEditorParagraph(document);
      row.replaceWith(paragraph);
      moveCaretAfter(paragraph);
    }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tag');
    } finally {
      setLoading(false);
    }
  }

  function insertInternalLink(post: PostItem) {
    const anchor = document.createElement('a');
    anchor.href = `/${post.lang}/${post.section}/${post.slug}/`;
    anchor.textContent = post.title;
    insertNodeAtCursor(anchor);

    const spacer = document.createTextNode(' ');
    insertNodeAtCursor(spacer);
  }

  function resolveImageAlt(currentValue: string, fallbackLabel: string): string {
    const trimmed = currentValue.trim();
    if (trimmed) return trimmed;
    const prompted = window.prompt('Image alt text is recommended. Leave blank to use the file name.', fallbackLabel)?.trim() || '';
    return prompted || fallbackLabel || 'image';
  }

  function resolveMultiImageAltPrefix(files: File[]): string {
    const prefix = bodyImageAlt.trim();
    if (prefix) return prefix;
    const fallback = files[0]?.name.replace(/\.[^.]+$/, '') || 'image';
    const prompted =
      window
        .prompt('Image alt prefix is recommended for multi-image upload. Leave blank to use a generic label.', fallback)
        ?.trim() || '';
    return prompted || fallback || 'image';
  }

  async function uploadAndInsertBodyImage(file: File) {
    const alt = resolveImageAlt(bodyImageAlt, file.name.replace(/\.[^.]+$/, ''));

    setLoading(true);
    setError('');

    try {
      const result = await uploadMedia(file, alt);
      const url = result.urls.original || result.urls.thumb_webp;
      const image = createEditorImage(document, url, alt);
      insertNodeAtCursor(image);
      insertNodeAtCursor(createEditorParagraph(document));

      selectedImageRef.current = image;
      setBodyImageAlt(alt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function uploadAndInsertBodyImages(files: FileList | File[]) {
    const nextFiles = Array.from(files || []).filter(Boolean);
    if (nextFiles.length === 0) return;
    if (nextFiles.length === 1) {
      await uploadAndInsertBodyImage(nextFiles[0]);
      return;
    }

    const altPrefix = resolveMultiImageAltPrefix(nextFiles);

    setLoading(true);
    setError('');

    try {
      const uploaded = await Promise.all(
        nextFiles.map(async (file, index) => {
          const alt = `${altPrefix} ${index + 1}`;
          const result = await uploadMedia(file, alt);
          return {
            alt,
            url: result.urls.original || result.urls.thumb_webp
          };
        })
      );

      const row = document.createElement('div');
      row.className = 'editor-image-row';
      row.style.setProperty('--editor-image-columns', String(Math.min(uploaded.length, 4)));

      for (const item of uploaded) {
        const image = createEditorImage(document, item.url, item.alt);
        image.style.width = '100%';
        image.style.marginLeft = '0';
        image.style.marginRight = '0';
        row.appendChild(image);
      }

      insertNodeAtCursor(row);
      insertNodeAtCursor(createEditorParagraph(document));
      selectedImageRef.current = row.querySelector('img.editor-inline-image') as HTMLImageElement | null;
      setBodyImageAlt(altPrefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function uploadCardImage(file: File) {
    const alt = resolveImageAlt(cardImageAlt, file.name.replace(/\.[^.]+$/, ''));

    setLoading(true);
    setError('');

    try {
      const result = await uploadMedia(file, alt);
      setCardImageId(result.mediaId);
      setCardImageUrl(result.urls.thumb_webp || result.urls.original);
      setCardImageAlt(alt);
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
    const rawHtml = syncEditorHtml('body').trim();
    const html = normalizeBodyHtml(rawHtml).trim();
    const rawBeforeHtml =
      hasEmbeddedProgramPost && (programContentLayout === 'above' || programContentLayout === 'split')
        ? syncEditorHtml('before').trim()
        : '';
    const beforeHtml = rawBeforeHtml ? normalizeBodyHtml(rawBeforeHtml).trim() : '';
    const rawAfterHtml =
      hasEmbeddedProgramPost && (programContentLayout === 'below' || programContentLayout === 'split')
        ? syncEditorHtml('after').trim()
        : '';
    const afterHtml = rawAfterHtml ? normalizeBodyHtml(rawAfterHtml).trim() : '';
    const combinedHtml = hasEmbeddedProgramPost ? [beforeHtml, afterHtml].filter(Boolean).join('\n') : html;

    if (!normalizedTitle || !normalizedSlug) {
      setError('title and slug are required.');
      return;
    }
    if (!hasEmbeddedProgramPost && isEditorHtmlEmpty(html)) {
      setError('content is required.');
      return;
    }

    const parsedTags = dedupeTagList(selectedTags);
    const normalizedExcerpt = excerpt.trim() || toExcerptText(combinedHtml || html) || null;
    const rankNumber = parseRankNumber(cardRank.trim());
    const normalizedMetaTitle = metaTitle.trim() || null;
    const normalizedMetaDescription = metaDescription.trim() || normalizedExcerpt;
    const ogTitle = normalizedMetaTitle || normalizedTitle;
    const ogDescription = normalizedMetaDescription || normalizedExcerpt || null;
    const ogImage = cardImageUrl || null;
    const derivedCardTag = parsedTags.join(', ');

    const snapshot: PostSaveSnapshot = {
      id: mode === 'edit' ? initialPost?.id || 0 : 0,
      slug: normalizedSlug,
      title: normalizedTitle,
      excerpt: normalizedExcerpt,
      content_md: combinedHtml,
      content_before_md: hasEmbeddedProgramPost ? beforeHtml || null : null,
      content_after_md: hasEmbeddedProgramPost ? afterHtml || null : null,
      status,
      lang,
      section,
      updated_at: new Date().toISOString(),
      tags: parsedTags,
      meta: {
        title: normalizedMetaTitle,
        description: normalizedMetaDescription
      },
      og: {
        title: ogTitle,
        description: ogDescription,
        imageUrl: ogImage
      },
      schemaType,
      card: {
        title: normalizedTitle,
        category: cardCategory.trim() || section,
        tag: derivedCardTag || 'Tag',
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
      content_md: combinedHtml,
      content_before_md: hasEmbeddedProgramPost ? beforeHtml : '',
      content_after_md: hasEmbeddedProgramPost ? afterHtml : '',
      status,
      lang,
      section,
      tags: parsedTags,
      meta: {
        title: normalizedMetaTitle || '',
        description: normalizedMetaDescription || ''
      },
      schema_type: schemaType,
      card: {
        title: normalizedTitle,
        category: snapshot.card.category,
        tag: derivedCardTag,
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

  function renderEditorSurface(key: EditorPaneKey, heading: string, hint: string) {
    const ref = getEditorRef(key);
    const isActive = preferredEditorKey() === key;

    return (
      <div className={`admin-editor-block${isActive ? ' admin-editor-block--active' : ''}`}>
        <div className="admin-editor-block__head">
          <strong>{heading}</strong>
          <span className="list-tags">{hint}</span>
        </div>
        <div
          ref={ref}
          className="editor-surface"
          contentEditable
          suppressContentEditableWarning
          onFocus={() => setActiveEditor(key)}
          onClick={(event) => {
            setActiveEditor(key);
            setSelectedImageFromEvent(event.target);
          }}
          onMouseMove={handleEditorMouseMove}
          onMouseLeave={() => clearEdgeHoverStyles(ref.current)}
          onMouseDown={(event) => startImageResize(event, key)}
        />
      </div>
    );
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
                disabled={isBuiltinProgramPost}
                onChange={(event) => setSlug(event.target.value)}
                onBlur={() => setSlug((prev) => slugify(prev || title))}
                placeholder="post-slug"
              />
              {isBuiltinProgramPost ? (
                <span className="list-tags">This slug is reserved for a built-in program route and cannot be changed.</span>
              ) : null}
            </label>

            <label>
              Excerpt (optional)
              <input value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="Short summary" />
              <span className="list-tags">Leave blank to generate a summary from the body.</span>
            </label>

            <div className="admin-card-settings">
              <h3>SEO</h3>
              <label>
                Meta Title (optional)
                <input
                  value={metaTitle}
                  maxLength={60}
                  onChange={(event) => setMetaTitle(event.target.value)}
                  placeholder="Meta title (max 60)"
                />
                <span className="list-tags">{metaTitle.length}/60. Blank uses the post title.</span>
              </label>
              <label>
                Meta Description (optional)
                <textarea
                  value={metaDescription}
                  maxLength={160}
                  onChange={(event) => setMetaDescription(event.target.value)}
                  placeholder="Meta description (155-160)"
                />
                <span className="list-tags">
                  {metaDescription.length}/160 {metaDescription.length >= 155 && metaDescription.length <= 160 ? '(ideal)' : ''}{' '}
                  Blank uses the final excerpt.
                </span>
              </label>
              <label>
                Schema Type
                <select value={schemaType} onChange={(event) => setSchemaType(event.target.value as 'BlogPosting' | 'Service')}>
                  <option value="BlogPosting">BlogPosting</option>
                  <option value="Service">Service</option>
                </select>
              </label>
              <p className="list-tags">Open Graph is generated automatically from SEO fields and card image.</p>
            </div>

            <div className="admin-inline-grid">
              <label>
                Language
                <select value={lang} disabled={isBuiltinProgramPost} onChange={(event) => setLang(event.target.value as SiteLang)}>
                  <option value="en">en</option>
                  <option value="ko">ko</option>
                </select>
              </label>

              <label>
                Category
                <select
                  value={section}
                  disabled={isBuiltinProgramPost}
                  onChange={(event) => setSection(event.target.value as SiteSection)}
                >
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
                {availableTags.length === 0 ? <span className="list-tags">No saved tags yet.</span> : null}
              </div>
            </div>

            <div className="admin-card-settings">
              <h3>Card Settings</h3>
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
              <p className="list-tags">
                Card title and card tag follow the post title and tag list automatically. Post number counts across blog, tool, and game posts in the same language. Static pages like About, Contact, and Privacy are excluded.
              </p>

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
              {hasEmbeddedProgramPost ? (
                <>
                  <div className="admin-inline-grid">
                    <label>
                      Program Content Layout
                      <select
                        value={programContentLayout}
                        onChange={(event) => setProgramContentLayout(event.target.value as ProgramContentLayout)}
                      >
                        <option value="below">Program first, content below</option>
                        <option value="above">Content above, program below</option>
                        <option value="split">Content above and below the program</option>
                      </select>
                    </label>
                  </div>
                  <p className="list-tags">
                    Use separate editors when this post contains a built-in program. Formatting tools apply to the currently focused area: {activeEditorLabel()}.
                  </p>
                </>
              ) : null}

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
                  Image Alt Prefix
                  <input
                    className="editor-toolbar__alt"
                    value={bodyImageAlt}
                    onChange={(event) => setBodyImageAlt(event.target.value)}
                    placeholder="Used for uploads, numbered for multi-image rows"
                  />
                </label>
                <label className="editor-toolbar__upload">
                  Image
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={async (event) => {
                      if (event.target.files?.length) await uploadAndInsertBodyImages(event.target.files);
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

              {hasEmbeddedProgramPost ? (
                <div className="admin-editor-stack">
                  {(programContentLayout === 'above' || programContentLayout === 'split') &&
                    renderEditorSurface('before', 'Content above the program', 'Rendered before the embedded tool/game.')}
                  {(programContentLayout === 'below' || programContentLayout === 'split') &&
                    renderEditorSurface('after', 'Content below the program', 'Rendered after the embedded tool/game.')}
                </div>
              ) : (
                renderEditorSurface('body', 'Body content', 'Rendered as the main post body.')
              )}

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
                <span className="list-tags">Drag image edge to resize. Alignment applies only to standalone images.</span>
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
