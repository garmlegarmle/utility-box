import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPost, deletePost, deleteTag, listPosts, listTags, updatePost, uploadMedia } from '../lib/api';
import type { CardTitleSize, PostItem, PostSaveSnapshot, SiteLang, SiteSection } from '../types';

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

const FONT_SIZE_OPTIONS = [
  { label: '12px', value: '1' },
  { label: '14px', value: '2' },
  { label: '15px', value: '3' },
  { label: '18px', value: '4' },
  { label: '24px', value: '5' },
  { label: '32px', value: '6' }
] as const;

const FONT_SIZE_TO_PX: Record<string, string> = {
  '1': '12px',
  '2': '14px',
  '3': '15px',
  '4': '18px',
  '5': '24px',
  '6': '32px',
  '7': '40px'
};

const FONT_FAMILY_OPTIONS = [
  { label: 'Default', value: 'system-ui, -apple-system, Inter, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Helvetica', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", Verdana, sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' }
] as const;

const CARD_TITLE_SIZE_OPTIONS: Array<{ label: string; value: CardTitleSize }> = [
  { label: 'Auto', value: 'auto' },
  { label: 'Default', value: 'default' },
  { label: 'Compact', value: 'compact' },
  { label: 'Tight', value: 'tight' },
  { label: 'Ultra Tight', value: 'ultra-tight' }
];

const TABLE_COLUMN_WIDTH_OPTIONS = [
  { label: 'Auto', value: 'auto' },
  { label: '15%', value: '15%' },
  { label: '20%', value: '20%' },
  { label: '25%', value: '25%' },
  { label: '33%', value: '33%' },
  { label: '40%', value: '40%' },
  { label: '50%', value: '50%' },
  { label: '60%', value: '60%' },
  { label: '75%', value: '75%' }
] as const;

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

  if (/<[a-z][\s\S]*>/i.test(value)) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(value, 'text/html');
    doc.querySelectorAll('script, style').forEach((node) => node.remove());
    const elements = Array.from(doc.body.children);
    if (elements.length === 1 && elements[0].tagName.toLowerCase() === 'main') {
      return elements[0].innerHTML || '<p><br></p>';
    }
    return doc.body.innerHTML || value;
  }

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

function normalizeLegacyFontTags(editor: HTMLDivElement | null) {
  if (!editor) return;

  editor.querySelectorAll('font').forEach((node) => {
    const span = document.createElement('span');
    const size = node.getAttribute('size');
    const face = node.getAttribute('face');
    const color = node.getAttribute('color');

    if (size && FONT_SIZE_TO_PX[size]) {
      span.style.fontSize = FONT_SIZE_TO_PX[size];
    }
    if (face) {
      span.style.fontFamily = face;
    }
    if (color) {
      span.style.color = color;
    }

    span.innerHTML = node.innerHTML;
    node.replaceWith(span);
  });
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
      ((post.section === 'tools' && (post.slug === 'trend-analyzer' || post.slug === 'chart-interpretation')) ||
        (post.section === 'games' &&
          (post.slug === 'texas-holdem-tournament' || post.slug === 'mine-cart-duel')))
  );
}

function hasEmbeddedProgram(section: SiteSection, slug: string): boolean {
  const normalizedSlug = slugify(slug);
  return (
    (section === 'tools' && (normalizedSlug === 'trend-analyzer' || normalizedSlug === 'chart-interpretation')) ||
    (section === 'games' &&
      (normalizedSlug === 'texas-holdem-tournament' || normalizedSlug === 'mine-cart-duel'))
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
  const [cardTitleSize, setCardTitleSize] = useState<CardTitleSize>(initialPost?.card.titleSize || 'auto');
  const [cardImageAlt, setCardImageAlt] = useState('');
  const [cardCategoryTouched, setCardCategoryTouched] = useState(false);
  const [cardRankTouched, setCardRankTouched] = useState(false);
  const [bodyImageAlt, setBodyImageAlt] = useState('');
  const [cardImageInputVersion, setCardImageInputVersion] = useState(0);
  const [bodyImageInputVersion, setBodyImageInputVersion] = useState(0);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkResults, setLinkResults] = useState<PostItem[]>([]);
  const [linkComposerOpen, setLinkComposerOpen] = useState(false);
  const [tableColumnWidth, setTableColumnWidth] = useState('auto');
  const [activeEditor, setActiveEditor] = useState<EditorPaneKey>('body');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const bodyEditorRef = useRef<HTMLDivElement | null>(null);
  const beforeEditorRef = useRef<HTMLDivElement | null>(null);
  const afterEditorRef = useRef<HTMLDivElement | null>(null);
  const selectedImageRef = useRef<HTMLImageElement | null>(null);
  const savedSelectionRef = useRef<{ key: EditorPaneKey; range: Range } | null>(null);
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
    return activeEditor === 'before' || activeEditor === 'after' ? activeEditor : 'after';
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
    setCardTitleSize(initialPost?.card.titleSize || 'auto');
    setCardImageAlt('');
    setBodyImageAlt('');
    setCardImageInputVersion(0);
    setBodyImageInputVersion(0);
    setLinkDraft('');
    setLinkResults([]);
    setLinkComposerOpen(false);
    setCardCategoryTouched(
      Boolean(initialPost?.card.category && initialPost.card.category !== (initialPost.section || defaultSection))
    );
    setCardRankTouched(Boolean(stripRank(initialPost?.card.rank)));
    setActiveEditor(embeddedInitial ? (nextBeforeSource.trim() ? 'before' : 'after') : 'body');

    selectedImageRef.current = null;
    savedSelectionRef.current = null;
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
    const query = linkDraft.trim();
    if (!query.startsWith('/')) {
      setLinkResults([]);
      return;
    }

    const normalizedQuery = query.slice(1).trim();
    if (!normalizedQuery) {
      setLinkResults([]);
      return;
    }

    let canceled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await listPosts({
          lang,
          q: normalizedQuery,
          status: 'all',
          page: 1,
          limit: 20
        });
        if (canceled) return;
        setLinkResults(response.items || []);
      } catch {
        if (canceled) return;
        setLinkResults([]);
      }
    }, 180);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [lang, linkDraft, open]);

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

  function getSelectionRange(key: EditorPaneKey = preferredEditorKey()): Range | null {
    const editor = getEditorElement(key);
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    return range;
  }

  function rememberSelection(key: EditorPaneKey = preferredEditorKey()) {
    const range = getSelectionRange(key);
    if (!range) return;
    savedSelectionRef.current = {
      key,
      range: range.cloneRange()
    };
  }

  function restoreRememberedSelection(key: EditorPaneKey = preferredEditorKey()): Range | null {
    const editor = getEditorElement(key);
    const saved = savedSelectionRef.current;
    if (!editor || !saved || saved.key !== key) return null;

    try {
      const selection = window.getSelection();
      if (!selection) return null;
      const range = saved.range.cloneRange();
      selection.removeAllRanges();
      selection.addRange(range);
      return range;
    } catch {
      return null;
    }
  }

  function getUsableSelectionRange(
    key: EditorPaneKey = preferredEditorKey(),
    options: { preferRemembered?: boolean } = {}
  ): Range | null {
    const { preferRemembered = false } = options;
    const hasRememberedSelection = savedSelectionRef.current?.key === key;

    if (preferRemembered && hasRememberedSelection) {
      return restoreRememberedSelection(key) || getSelectionRange(key);
    }

    return getSelectionRange(key) || restoreRememberedSelection(key);
  }

  function exec(command: string, value?: string) {
    focusEditor(preferredEditorKey());
    document.execCommand(command, false, value || '');
    normalizeLegacyFontTags(getEditorElement(preferredEditorKey()));
  }

  function execWithCss(command: string, value: string) {
    const key = preferredEditorKey();
    focusEditor(key);
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    normalizeLegacyFontTags(getEditorElement(key));
  }

  function applyBackgroundColor(color: string) {
    const key = preferredEditorKey();
    focusEditor(key);
    document.execCommand('styleWithCSS', false, 'true');
    const applied = document.execCommand('hiliteColor', false, color);
    if (!applied) {
      document.execCommand('backColor', false, color);
    }
    normalizeLegacyFontTags(getEditorElement(key));
  }

  function normalizeLinkHref(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('#') ||
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ) {
      return trimmed;
    }
    return `https://${trimmed}`;
  }

  function insertLinkHref(href: string) {
    const normalizedHref = normalizeLinkHref(href);
    if (!normalizedHref) return;

    const editorKey = preferredEditorKey();
    focusEditor(editorKey);
    const range = getUsableSelectionRange(editorKey, { preferRemembered: true });

    if (range && !range.collapsed) {
      document.execCommand('createLink', false, normalizedHref);
      normalizeLegacyFontTags(getEditorElement(editorKey));
      savedSelectionRef.current = null;
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = normalizedHref;
    anchor.textContent = normalizedHref;
    insertNodeAtCursor(anchor);
    insertNodeAtCursor(document.createTextNode(' '));
    savedSelectionRef.current = null;
  }

  function closeLinkComposer() {
    setLinkComposerOpen(false);
    setLinkDraft('');
    setLinkResults([]);
  }

  function insertNodeAtCursor(node: Node) {
    const editorKey = preferredEditorKey();
    const editor = getEditorElement(editorKey);
    if (!editor) return;
    focusEditor(editorKey);

    if (savedSelectionRef.current?.key === editorKey) {
      restoreRememberedSelection(editorKey);
    }

    const selection = window.getSelection();
    const hasSelectionInEditor =
      selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).commonAncestorContainer);
    if ((!selection || selection.rangeCount === 0 || !hasSelectionInEditor) && restoreRememberedSelection(editorKey)) {
      return insertNodeAtCursor(node);
    }

    if (!selection || selection.rangeCount === 0 || !hasSelectionInEditor) {
      editor.appendChild(node);
      moveCaretAfter(node);
      savedSelectionRef.current = null;
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    moveCaretAfter(node);
    savedSelectionRef.current = null;
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

  function closestElementFromRange(range: Range | null): HTMLElement | null {
    if (!range) return null;
    const node = range.commonAncestorContainer;
    if (node instanceof HTMLElement) return node;
    return node.parentElement;
  }

  function getCurrentTableCell(key: EditorPaneKey = preferredEditorKey()): HTMLTableCellElement | null {
    const range = getUsableSelectionRange(key, { preferRemembered: true });
    const element = closestElementFromRange(range);
    if (!element) return null;
    return element.closest('td, th');
  }

  function getCurrentTable(key: EditorPaneKey = preferredEditorKey()): HTMLTableElement | null {
    const cell = getCurrentTableCell(key);
    if (cell) return cell.closest('table');
    const range = getUsableSelectionRange(key, { preferRemembered: true });
    const element = closestElementFromRange(range);
    return element?.closest('table') || null;
  }

  function getCellIndex(cell: HTMLTableCellElement): number {
    return Array.from(cell.parentElement?.children || []).indexOf(cell);
  }

  function syncCurrentTableColumnWidth() {
    const cell = getCurrentTableCell();
    if (!cell) {
      setTableColumnWidth('auto');
      return;
    }
    setTableColumnWidth(cell.style.width || 'auto');
  }

  function createEditableTable(doc: Document, rows = 3, columns = 3): HTMLTableElement {
    const table = doc.createElement('table');
    table.className = 'editor-table';
    const tbody = doc.createElement('tbody');

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      const row = doc.createElement('tr');
      for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
        const cell = doc.createElement(rowIndex === 0 ? 'th' : 'td');
        cell.innerHTML = rowIndex === 0 ? `Heading ${columnIndex + 1}` : '<br>';
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    return table;
  }

  function insertTable() {
    const table = createEditableTable(document);
    insertNodeAtCursor(table);
    insertNodeAtCursor(createEditorParagraph(document));
    const firstBodyCell = table.querySelector('tbody tr:nth-child(2) td') as HTMLTableCellElement | null;
    if (firstBodyCell) {
      const range = document.createRange();
      range.selectNodeContents(firstBodyCell);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedSelectionRef.current = {
        key: preferredEditorKey(),
        range: range.cloneRange()
      };
    }
    syncCurrentTableColumnWidth();
  }

  function addTableRow() {
    const cell = getCurrentTableCell();
    if (!cell) return;
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const nextRow = document.createElement('tr');
    const cells = Array.from(row.children) as HTMLTableCellElement[];
    cells.forEach((currentCell) => {
      const tagName = currentCell.tagName.toLowerCase() === 'th' ? 'th' : 'td';
      const nextCell = document.createElement(tagName);
      nextCell.style.width = currentCell.style.width;
      nextCell.innerHTML = tagName === 'th' ? 'Heading' : '<br>';
      nextRow.appendChild(nextCell);
    });
    row.insertAdjacentElement('afterend', nextRow);
  }

  function removeTableRow() {
    const cell = getCurrentTableCell();
    if (!cell) return;
    const row = cell.parentElement as HTMLTableRowElement | null;
    const table = cell.closest('table');
    if (!row || !table) return;
    row.remove();
    if (table.querySelectorAll('tr').length === 0) {
      table.replaceWith(createEditorParagraph(document));
    }
  }

  function addTableColumn() {
    const cell = getCurrentTableCell();
    const table = getCurrentTable();
    if (!cell || !table) return;
    const columnIndex = getCellIndex(cell);
    table.querySelectorAll('tr').forEach((row) => {
      const rowElement = row as HTMLTableRowElement;
      const sourceCell = rowElement.children[columnIndex] as HTMLTableCellElement | undefined;
      const tagName = sourceCell?.tagName?.toLowerCase() === 'th' ? 'th' : 'td';
      const nextCell = document.createElement(tagName);
      nextCell.innerHTML = tagName === 'th' ? 'Heading' : '<br>';
      const insertAfter = rowElement.children[columnIndex];
      if (insertAfter) {
        insertAfter.insertAdjacentElement('afterend', nextCell);
      } else {
        rowElement.appendChild(nextCell);
      }
    });
  }

  function removeTableColumn() {
    const cell = getCurrentTableCell();
    const table = getCurrentTable();
    if (!cell || !table) return;
    const columnIndex = getCellIndex(cell);
    table.querySelectorAll('tr').forEach((row) => {
      const target = row.children[columnIndex];
      if (target) target.remove();
    });
    const hasAnyCells = Array.from(table.querySelectorAll('tr')).some((row) => row.children.length > 0);
    if (!hasAnyCells) {
      table.replaceWith(createEditorParagraph(document));
    }
  }

  function applyCurrentTableColumnWidth(width: string) {
    const cell = getCurrentTableCell();
    const table = getCurrentTable();
    if (!cell || !table) {
      setTableColumnWidth(width);
      return;
    }
    const columnIndex = getCellIndex(cell);
    table.querySelectorAll('tr').forEach((row) => {
      const targetCell = row.children[columnIndex] as HTMLElement | undefined;
      if (!targetCell) return;
      if (width === 'auto') targetCell.style.removeProperty('width');
      else targetCell.style.width = width;
    });
    setTableColumnWidth(width);
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
    const href = `/${post.lang}/${post.section}/${post.slug}/`;
    const editorKey = preferredEditorKey();
    focusEditor(editorKey);
    const range = getUsableSelectionRange(editorKey, { preferRemembered: true });

    if (range && !range.collapsed) {
      document.execCommand('createLink', false, href);
      normalizeLegacyFontTags(getEditorElement(editorKey));
      savedSelectionRef.current = null;
    } else {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = post.title;
      insertNodeAtCursor(anchor);
      insertNodeAtCursor(document.createTextNode(' '));
      savedSelectionRef.current = null;
    }

    closeLinkComposer();
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
    rememberSelection(preferredEditorKey());

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
    rememberSelection(preferredEditorKey());
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
    const rawBeforeHtml = hasEmbeddedProgramPost ? syncEditorHtml('before').trim() : '';
    const rawAfterHtml = hasEmbeddedProgramPost ? syncEditorHtml('after').trim() : '';
    const normalizedBeforeHtml = rawBeforeHtml ? normalizeBodyHtml(rawBeforeHtml).trim() : '';
    const normalizedAfterHtml = rawAfterHtml ? normalizeBodyHtml(rawAfterHtml).trim() : '';
    const beforeHtml = hasEmbeddedProgramPost ? normalizedBeforeHtml : '';
    const afterHtml = hasEmbeddedProgramPost ? normalizedAfterHtml : '';
    const combinedHtml = hasEmbeddedProgramPost ? [beforeHtml, afterHtml].filter(Boolean).join('\n') : html;

    if (!normalizedTitle || !normalizedSlug) {
      setError('title and slug are required.');
      return;
    }
    if (!hasEmbeddedProgramPost && isEditorHtmlEmpty(html)) {
      setError('content is required.');
      return;
    }
    if (
      hasEmbeddedProgramPost &&
      isEditorHtmlEmpty(beforeHtml) &&
      isEditorHtmlEmpty(afterHtml)
    ) {
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
        imageUrl: cardImageUrl || null,
        titleSize: cardTitleSize
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
        image_id: cardImageId,
        title_size: cardTitleSize
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
          className="editor-surface content-prose"
          contentEditable
          suppressContentEditableWarning
          onFocus={() => {
            setActiveEditor(key);
            syncCurrentTableColumnWidth();
          }}
          onClick={(event) => {
            setActiveEditor(key);
            setSelectedImageFromEvent(event.target);
            syncCurrentTableColumnWidth();
          }}
          onKeyUp={syncCurrentTableColumnWidth}
          onMouseMove={handleEditorMouseMove}
          onMouseLeave={() => clearEdgeHoverStyles(ref.current)}
          onMouseDown={(event) => startImageResize(event, key)}
        />
      </div>
    );
  }

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={titleText}>
      <div className="admin-modal__backdrop" aria-hidden="true" />
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
                <label>
                  Card Title Size
                  <select value={cardTitleSize} onChange={(event) => setCardTitleSize(event.target.value as CardTitleSize)}>
                    {CARD_TITLE_SIZE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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
                    key={`card-image-input-${cardImageInputVersion}`}
                    type="file"
                    accept="image/*"
                    onClick={(event) => {
                      event.currentTarget.value = '';
                    }}
                    onChange={async (event) => {
                      const file = event.currentTarget.files?.[0];
                      setCardImageInputVersion((version) => version + 1);
                      if (file) await uploadCardImage(file);
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
                <p className="list-tags">
                  Built-in programs always keep two editable text areas. Content above is rendered before the program and content below is rendered after it. Formatting tools apply to the currently focused area.
                </p>
              ) : null}

              <div className="admin-editor-workbench">
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
                  <label className="editor-toolbar__label">
                    Size
                    <select
                      className="editor-toolbar__select"
                      defaultValue="3"
                      onChange={(event) => {
                        execWithCss('fontSize', event.target.value);
                      }}
                    >
                      {FONT_SIZE_OPTIONS.map((option) => (
                        <option key={`font-size-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="editor-toolbar__label">
                    Font
                    <select
                      className="editor-toolbar__select editor-toolbar__select--font"
                      defaultValue={FONT_FAMILY_OPTIONS[0].value}
                      onChange={(event) => {
                        execWithCss('fontName', event.target.value);
                      }}
                    >
                      {FONT_FAMILY_OPTIONS.map((option) => (
                        <option key={`font-family-${option.label}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
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
                  <button type="button" onMouseDown={() => rememberSelection(preferredEditorKey())} onClick={insertTable} aria-label="Insert table">
                    Table
                  </button>
                  <button type="button" onMouseDown={() => rememberSelection(preferredEditorKey())} onClick={addTableRow} aria-label="Add table row">
                    +Row
                  </button>
                  <button type="button" onMouseDown={() => rememberSelection(preferredEditorKey())} onClick={addTableColumn} aria-label="Add table column">
                    +Col
                  </button>
                  <button type="button" onMouseDown={() => rememberSelection(preferredEditorKey())} onClick={removeTableRow} aria-label="Remove table row">
                    -Row
                  </button>
                  <button type="button" onMouseDown={() => rememberSelection(preferredEditorKey())} onClick={removeTableColumn} aria-label="Remove table column">
                    -Col
                  </button>
                  <label className="editor-toolbar__label">
                    Column
                    <select
                      className="editor-toolbar__select"
                      value={tableColumnWidth}
                      onChange={(event) => applyCurrentTableColumnWidth(event.target.value)}
                    >
                      {TABLE_COLUMN_WIDTH_OPTIONS.map((option) => (
                        <option key={`table-width-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onMouseDown={() => rememberSelection(preferredEditorKey())}
                    onClick={() => {
                      setLinkComposerOpen((prev) => !prev);
                      setLinkDraft('');
                      setLinkResults([]);
                    }}
                    aria-label="Insert link"
                  >
                    Link
                  </button>
                  <label className="editor-toolbar__color">
                    Text
                    <input
                      type="color"
                      defaultValue="#111417"
                      onChange={(event) => {
                        execWithCss('foreColor', event.target.value);
                      }}
                    />
                  </label>
                  <label className="editor-toolbar__color">
                    Highlight
                    <input
                      type="color"
                      defaultValue="#fff4a3"
                      onChange={(event) => {
                        applyBackgroundColor(event.target.value);
                      }}
                    />
                  </label>
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
                  <label className="editor-toolbar__upload" onMouseDown={() => rememberSelection(preferredEditorKey())}>
                    Image
                    <input
                      key={`body-image-input-${bodyImageInputVersion}`}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onClick={(event) => {
                        event.currentTarget.value = '';
                      }}
                      onChange={async (event) => {
                        const files = Array.from(event.currentTarget.files || []);
                        setBodyImageInputVersion((version) => version + 1);
                        if (files.length) await uploadAndInsertBodyImages(files);
                      }}
                    />
                  </label>
                </div>

                {linkComposerOpen ? (
                  <div className="editor-link-composer">
                    <div className="editor-link-composer__row">
                      <input
                        className="editor-link-composer__input"
                        value={linkDraft}
                        onChange={(event) => setLinkDraft(event.target.value)}
                        placeholder="Paste a URL or type / to search internal posts"
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            closeLinkComposer();
                            return;
                          }

                          if (event.key !== 'Enter') return;
                          event.preventDefault();

                          const trimmed = linkDraft.trim();
                          if (!trimmed) return;

                          if (trimmed.startsWith('/')) {
                            if (linkResults.length > 0) {
                              insertInternalLink(linkResults[0]);
                            }
                            return;
                          }

                          insertLinkHref(trimmed);
                          closeLinkComposer();
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = linkDraft.trim();
                          if (!trimmed) return;
                          if (trimmed.startsWith('/')) {
                            if (linkResults.length > 0) {
                              insertInternalLink(linkResults[0]);
                            }
                            return;
                          }
                          insertLinkHref(trimmed);
                          closeLinkComposer();
                        }}
                      >
                        Apply
                      </button>
                      <button type="button" onClick={closeLinkComposer}>
                        Close
                      </button>
                    </div>
                    {linkDraft.trim().startsWith('/') ? (
                      <div className="internal-link-list">
                        {linkResults.map((item) => (
                          <button
                            key={`internal-link-${item.id}`}
                            type="button"
                            className="internal-link-item"
                            onClick={() => insertInternalLink(item)}
                          >
                            {item.title} ({item.lang}/{item.section})
                          </button>
                        ))}
                        {linkDraft.trim().slice(1).trim() && linkResults.length === 0 ? (
                          <p className="list-tags">No results.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {hasEmbeddedProgramPost ? (
                  <div className="admin-editor-stack">
                    {renderEditorSurface(
                      'before',
                      'Content above the program',
                      'Rendered before the embedded tool/game when this area has content.'
                    )}
                    {renderEditorSurface(
                      'after',
                      'Content below the program',
                      'Rendered after the embedded tool/game when this area has content.'
                    )}
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
