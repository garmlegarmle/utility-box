import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { AdminDock } from './components/AdminDock';
import { AdminLoginModal } from './components/AdminLoginModal';
import { AdminPasswordModal } from './components/AdminPasswordModal';
import { EntryCard } from './components/EntryCard';
import { HoldemTournamentGameContent, TEXAS_HOLDEM_TOURNAMENT_SLUG } from './components/HoldemTournamentGame';
import { PageManagerModal } from './components/PageManagerModal';
import { PostEditorModal } from './components/PostEditorModal';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { TREND_ANALYZER_TOOL_SLUG, TrendAnalyzerToolContent } from './components/TrendAnalyzerTool';
import { trackPageView } from './lib/analytics';
import { changeAdminPassword, getPostBySlug, getSession, listPosts, login, logout } from './lib/api';
import { detectBrowserLang, normalizeLang, normalizeSection, sectionLabel, t } from './lib/site';
import type { PostItem, PostSaveSnapshot, SiteLang, SiteSection } from './types';

interface AdminState {
  loading: boolean;
  isAdmin: boolean;
  username: string | null;
}

interface EditorState {
  open: boolean;
  mode: 'create' | 'edit';
  initialPost: PostItem | null;
  defaultLang: SiteLang;
  defaultSection: SiteSection;
}

interface LanguageToggleState {
  languageSwitch?: boolean;
  fallbackPath?: string;
}

function toPostItem(snapshot: PostSaveSnapshot, existing?: PostItem): PostItem {
  return {
    id: snapshot.id,
    slug: snapshot.slug,
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    content_md: (snapshot.content_md ?? existing?.content_md) || '',
    content_before_md: snapshot.content_before_md ?? existing?.content_before_md ?? null,
    content_after_md: snapshot.content_after_md ?? existing?.content_after_md ?? null,
    status: snapshot.status,
    published_at: snapshot.status === 'published' ? existing?.published_at || snapshot.updated_at : null,
    created_at: existing?.created_at || snapshot.updated_at,
    updated_at: snapshot.updated_at,
    lang: snapshot.lang,
    section: snapshot.section,
    pair_slug: existing?.pair_slug || null,
    view_count: existing?.view_count || 0,
    tags: snapshot.tags,
    meta: snapshot.meta || existing?.meta || { title: null, description: null },
    og: snapshot.og || existing?.og || { title: null, description: null, imageUrl: null },
    schemaType: snapshot.schemaType ?? existing?.schemaType ?? null,
    cover: existing?.cover || null,
    card: snapshot.card
  };
}

function renderRichContent(raw: string | null | undefined): string {
  if (!raw) return '';

  const value = String(raw || '');
  if (/<[a-z][\s\S]*>/i.test(value)) {
    return DOMPurify.sanitize(value);
  }

  const parsed = marked.parse(value, { async: false }) as string;
  return DOMPurify.sanitize(parsed);
}

function upsertPost(list: PostItem[], snapshot: PostSaveSnapshot, maxItems?: number): PostItem[] {
  const index = list.findIndex((post) => post.id === snapshot.id);
  let next: PostItem[];

  if (index >= 0) {
    next = [...list];
    next[index] = toPostItem(snapshot, list[index]);
  } else {
    next = [toPostItem(snapshot), ...list];
  }

  if (typeof maxItems === 'number' && maxItems > 0) {
    return next.slice(0, maxItems);
  }
  return next;
}

function postDateValue(post: Pick<PostItem, 'published_at' | 'created_at'>): number {
  const raw = post.published_at || post.created_at;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function sortPostsByNewest(list: PostItem[]): PostItem[] {
  return [...list].sort((a, b) => {
    const diff = postDateValue(b) - postDateValue(a);
    if (diff !== 0) return diff;
    return b.id - a.id;
  });
}

function slugifyValue(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildCopyTitle(title: string, lang: SiteLang): string {
  const suffix = lang === 'ko' ? '복사본' : 'Copy';
  return `${String(title || '').trim()} ${suffix}`.trim();
}

function buildCopySlug(sourceSlug: string, existingSlugs: Iterable<string>): string {
  const used = new Set(Array.from(existingSlugs, (slug) => String(slug || '').trim().toLowerCase()).filter(Boolean));
  const base = `${slugifyValue(sourceSlug) || 'post'}-copy`;
  if (!used.has(base)) return base;

  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

async function listAllSectionSlugs(lang: SiteLang, section: SiteSection): Promise<Set<string>> {
  const slugs = new Set<string>();
  const limit = 100;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await listPosts({ lang, section, status: 'all', page, limit });
    for (const item of response.items || []) {
      if (item.slug) slugs.add(item.slug);
    }
    totalPages = Math.max(1, Math.ceil(Number(response.total || 0) / limit));
    if (!response.items?.length) break;
    page += 1;
  }

  return slugs;
}

function buildCopySeed(post: PostItem, slug: string): PostItem {
  const now = new Date().toISOString();
  const title = buildCopyTitle(post.title, post.lang);
  const derivedTag = post.tags.join(', ');

  return {
    ...post,
    id: 0,
    slug,
    title,
    status: 'draft',
    published_at: null,
    created_at: now,
    updated_at: now,
    pair_slug: null,
    view_count: 0,
    card: {
      ...post.card,
      title,
      tag: derivedTag || 'Tag'
    }
  };
}

const VIEW_COUNT_EXCLUDED_PAGE_SLUGS = new Set(['about', 'contact', 'privacy-policy']);

function shouldShowViewCount(post: Pick<PostItem, 'section' | 'slug'>): boolean {
  return !(post.section === 'pages' && VIEW_COUNT_EXCLUDED_PAGE_SLUGS.has(post.slug));
}

function formatViewCount(value: number, lang: SiteLang): string {
  return new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US').format(Math.max(0, Number(value || 0)));
}

function oppositeLang(lang: SiteLang): SiteLang {
  return lang === 'ko' ? 'en' : 'ko';
}

function buildSectionFallbackPath(lang: SiteLang, section: SiteSection | null): string {
  if (!section || section === 'pages') return `/${lang}/`;
  return `/${lang}/${section}/`;
}

function buildDetailLanguageToggle(
  lang: SiteLang,
  section: SiteSection | null,
  slug: string,
  pairSlug: string | null | undefined
): { path: string; state: LanguageToggleState } {
  const targetLang = oppositeLang(lang);
  const fallbackPath = buildSectionFallbackPath(targetLang, section);
  const targetSlug = String(pairSlug || slug || '').trim();

  if (!section || !targetSlug) {
    return {
      path: fallbackPath,
      state: { languageSwitch: true, fallbackPath }
    };
  }

  return {
    path: `/${targetLang}/${section}/${targetSlug}/`,
    state: { languageSwitch: true, fallbackPath }
  };
}

function renderTitleWithHiddenLoginTrigger(
  title: string,
  enabled: boolean,
  onTrigger: () => void
): React.ReactNode {
  if (!enabled) return title;

  const chars = [...title];
  let injected = false;

  return chars.map((char, index) => {
    if (!injected && /o/i.test(char)) {
      injected = true;
      return (
        <button
          key={`hidden-login-${index}`}
          type="button"
          className="hidden-admin-letter"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onTrigger();
          }}
          tabIndex={-1}
          aria-label="Admin login"
        >
          {char}
        </button>
      );
    }

    return <span key={`title-char-${index}`}>{char}</span>;
  });
}

function upsertHeadMeta(selector: string, attrName: 'name' | 'property', attrValue: string, content: string): () => void {
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;
  const created = !element;
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attrName, attrValue);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);

  return () => {
    if (created && element?.parentNode) {
      element.parentNode.removeChild(element);
    }
  };
}

function useAdminSession() {
  const [state, setState] = useState<AdminState>({ loading: true, isAdmin: false, username: null });

  const refresh = useCallback(async () => {
    try {
      const session = await getSession();
      setState({
        loading: false,
        isAdmin: Boolean(session.authenticated && session.isAdmin),
        username: session.username
      });
    } catch {
      setState({ loading: false, isAdmin: false, username: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}

function SiteShell({
  lang,
  active,
  languageTogglePath,
  languageToggleState,
  children
}: {
  lang: SiteLang;
  active: 'home' | SiteSection;
  languageTogglePath?: string;
  languageToggleState?: LanguageToggleState | null;
  children: React.ReactNode;
}) {
  return (
    <div className="site-shell">
      <SiteHeader lang={lang} active={active} languageTogglePath={languageTogglePath} languageToggleState={languageToggleState} />
      <main>{children}</main>
      <SiteFooter lang={lang} />
    </div>
  );
}

function RootRoute() {
  const lang = detectBrowserLang();
  return <Navigate to={`/${lang}/`} replace />;
}

function HomePage({
  admin,
  requestAdmin,
  openCreate,
  openPageManager,
  openPasswordChange,
  refreshKey,
  savedPost
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem, forcedLang?: SiteLang) => void;
  openPageManager: () => void;
  openPasswordChange: () => void;
  refreshKey: number;
  savedPost: PostSaveSnapshot | null;
}) {
  const params = useParams();
  const lang = normalizeLang(params.lang);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'tools' | 'games' | 'blog'>('all');
  const [selectedTag, setSelectedTag] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let canceled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const status = admin.isAdmin ? 'all' : 'published';
        const [blog, tools, games] = await Promise.all([
          listPosts({ lang, section: 'blog', status, limit: 120 }),
          listPosts({ lang, section: 'tools', status, limit: 120 }),
          listPosts({ lang, section: 'games', status, limit: 120 })
        ]);

        if (canceled) return;
        const merged = sortPostsByNewest([
          ...(Array.isArray(blog.items) ? blog.items : []),
          ...(Array.isArray(tools.items) ? tools.items : []),
          ...(Array.isArray(games.items) ? games.items : [])
        ]);
        setPosts(merged);
      } catch (err) {
        if (canceled) return;
        setPosts([]);
        setError(err instanceof Error ? err.message : 'Failed to load home feeds');
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [admin.isAdmin, lang, refreshKey]);

  useEffect(() => {
    if (!savedPost) return;
    if (savedPost.lang !== lang) return;
    if (!['blog', 'tools', 'games'].includes(savedPost.section)) return;

    setPosts((prev) => {
      const without = prev.filter((item) => item.id !== savedPost.id);
      if (!admin.isAdmin && savedPost.status !== 'published') {
        return without;
      }
      return sortPostsByNewest([toPostItem(savedPost), ...without]);
    });
  }, [admin.isAdmin, lang, savedPost]);

  useEffect(() => {
    setSelectedCategory('all');
    setSelectedTag('');
  }, [lang]);

  useEffect(() => {
    setSelectedTag('');
  }, [selectedCategory]);

  const categoryCounts = useMemo(
    () => ({
      all: posts.length,
      tools: posts.filter((item) => item.section === 'tools').length,
      games: posts.filter((item) => item.section === 'games').length,
      blog: posts.filter((item) => item.section === 'blog').length
    }),
    [posts]
  );

  const categoryPosts = useMemo(() => {
    if (selectedCategory === 'all') return posts;
    return posts.filter((item) => item.section === selectedCategory);
  }, [posts, selectedCategory]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of categoryPosts) {
      const seen = new Set<string>();
      for (const rawTag of item.tags || []) {
        const tag = String(rawTag || '').trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [categoryPosts]);

  const visiblePosts = useMemo(() => {
    if (!selectedTag) return categoryPosts;
    const key = selectedTag.trim().toLowerCase();
    return categoryPosts.filter((item) =>
      item.tags.some((tag) => String(tag || '').trim().toLowerCase() === key)
    );
  }, [categoryPosts, selectedTag]);

  const showLogin = useMemo(() => new URLSearchParams(window.location.search).get('admin') === '8722', []);

  return (
    <SiteShell lang={lang} active="home">
      <section className="page-section">
        <div className="container">
          <header className="list-head list-head--home-filters">
            <div className="list-tags-center">
              <p className="list-tags-title">{t(lang, 'home.category')}</p>
              <p className="list-tags">
                {([
                  { key: 'all', label: t(lang, 'common.all'), count: categoryCounts.all },
                  { key: 'tools', label: sectionLabel('tools', lang), count: categoryCounts.tools },
                  { key: 'games', label: sectionLabel('games', lang), count: categoryCounts.games },
                  { key: 'blog', label: sectionLabel('blog', lang), count: categoryCounts.blog }
                ] as const).map((item, index) => (
                  <span key={`home-category-${item.key}`}>
                    <button
                      type="button"
                      className={`tag-filter-btn${selectedCategory === item.key ? ' is-active' : ''}`}
                      onClick={() => setSelectedCategory(item.key)}
                    >
                      {item.label}({item.count})
                    </button>
                    {index < 3 ? ' | ' : ''}
                  </span>
                ))}
              </p>
            </div>

            <div className="list-tags-center">
              <p className="list-tags-title">{t(lang, 'home.tagList')}</p>
              {tagCounts.length > 0 ? (
                <p className="list-tags">
                  <span key="home-tag-all">
                    <button
                      type="button"
                      className={`tag-filter-btn${selectedTag === '' ? ' is-active' : ''}`}
                      onClick={() => setSelectedTag('')}
                    >
                      {t(lang, 'common.all')}({categoryPosts.length})
                    </button>
                    {' | '}
                  </span>
                  {tagCounts.map((item, index) => (
                    <span key={`home-tag-${item.name}-${index}`}>
                      <button
                        type="button"
                        className={`tag-filter-btn${selectedTag === item.name ? ' is-active' : ''}`}
                        onClick={() => setSelectedTag((prev) => (prev === item.name ? '' : item.name))}
                      >
                        {item.name}({item.count})
                      </button>
                      {index < tagCounts.length - 1 ? ' | ' : ''}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="list-tags list-tags--empty">
                  <button
                    type="button"
                    className={`tag-filter-btn${selectedTag === '' ? ' is-active' : ''}`}
                    onClick={() => setSelectedTag('')}
                  >
                    {t(lang, 'common.all')}({categoryPosts.length})
                  </button>
                </p>
              )}
            </div>
          </header>

          {loading ? <p>{t(lang, 'common.loading')}</p> : null}
          <div className="listing-grid listing-grid--four listing-grid--center">
            {visiblePosts.map((post) => (
              <EntryCard
                key={post.id}
                post={post}
                lang={lang}
                href={`/${lang}/${post.section}/${post.slug}/`}
                showDraftBadge={admin.isAdmin}
              />
            ))}
          </div>

          {!loading && visiblePosts.length === 0 ? <p className="list-tags">{t(lang, 'common.noPosts')}</p> : null}
        </div>
      </section>

      {error ? (
        <section className="page-section">
          <div className="container">
            <p className="list-tags">{error}</p>
          </div>
        </section>
      ) : null}

      {!admin.loading ? (
        <AdminDock
          lang={lang}
          showLogin={showLogin}
          isAdmin={admin.isAdmin}
          onLogin={requestAdmin}
          onLogout={() => {
            void logout().then(() => window.location.reload());
          }}
          onWrite={() => openCreate(selectedCategory === 'all' ? 'blog' : selectedCategory)}
          onManagePages={openPageManager}
          onChangePassword={openPasswordChange}
        />
      ) : null}
    </SiteShell>
  );
}

function SectionListPage({
  admin,
  requestAdmin,
  openCreate,
  openPageManager,
  openPasswordChange,
  refreshKey,
  savedPost
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem, forcedLang?: SiteLang) => void;
  openPageManager: () => void;
  openPasswordChange: () => void;
  refreshKey: number;
  savedPost: PostSaveSnapshot | null;
}) {
  const params = useParams();
  const lang = normalizeLang(params.lang);
  const section = normalizeSection(params.section || '') as SiteSection | null;
  const isValidSection = Boolean(section);

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError('');

    async function load() {
      if (!isValidSection || !section) {
        setPosts([]);
        setLoading(false);
        return;
      }

      try {
        const response = await listPosts({
          lang,
          section,
          status: admin.isAdmin ? 'all' : 'published',
          limit: 120,
          page: 1
        });
        if (canceled) return;
        setPosts(response.items);
      } catch (err) {
        if (canceled) return;
        setPosts([]);
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [admin.isAdmin, isValidSection, lang, refreshKey, section]);

  useEffect(() => {
    setSelectedTag('');
  }, [lang, section]);

  useEffect(() => {
    if (!savedPost) return;
    if (!section || !isValidSection) return;
    if (savedPost.lang !== lang || savedPost.section !== section) return;
    if (savedPost.status !== 'published' && !admin.isAdmin) return;
    if (
      selectedTag &&
      !savedPost.tags.some((tag) => tag.trim().toLowerCase() === selectedTag.trim().toLowerCase())
    ) {
      return;
    }

    setPosts((prev) => upsertPost(prev, savedPost, 120));
  }, [admin.isAdmin, isValidSection, lang, savedPost, section, selectedTag]);

  const showLogin = useMemo(() => new URLSearchParams(window.location.search).get('admin') === '8722', []);
  const sectionTotal = posts.length;
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of posts) {
      const seen = new Set<string>();
      for (const rawTag of item.tags || []) {
        const tag = String(rawTag || '').trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [posts]);
  const visiblePosts = useMemo(() => {
    if (!selectedTag) return posts;
    const key = selectedTag.trim().toLowerCase();
    return posts.filter((item) =>
      item.tags.some((tag) => String(tag || '').trim().toLowerCase() === key)
    );
  }, [posts, selectedTag]);

  if (!isValidSection || !section) {
    return <Navigate to={`/${lang}/`} replace />;
  }

  return (
    <SiteShell lang={lang} active={section}>
      <section className="page-section">
        <div className="container">
          <header className="list-head">
            <h1>{sectionLabel(section, lang)}</h1>
            <div className="list-tags-center">
              <p className="list-tags-title">{t(lang, 'home.tagList')}</p>
              {tagCounts.length > 0 ? (
                <p className="list-tags">
                  <span key="see-all-tag">
                    <button
                      type="button"
                      className={`tag-filter-btn${selectedTag === '' ? ' is-active' : ''}`}
                      onClick={() => setSelectedTag('')}
                    >
                      {t(lang, 'common.all')}({sectionTotal})
                    </button>
                    {' | '}
                  </span>
                  {tagCounts.map((item, index) => (
                    <span key={`${item.name}-${index}`}>
                      <button
                        type="button"
                        className={`tag-filter-btn${selectedTag === item.name ? ' is-active' : ''}`}
                        onClick={() => setSelectedTag((prev) => (prev === item.name ? '' : item.name))}
                      >
                        {item.name}({item.count})
                      </button>
                      {index < tagCounts.length - 1 ? ' | ' : ''}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="list-tags">
                  <button
                    type="button"
                    className={`tag-filter-btn${selectedTag === '' ? ' is-active' : ''}`}
                    onClick={() => setSelectedTag('')}
                  >
                    {t(lang, 'common.all')}({sectionTotal})
                  </button>
                </p>
              )}
            </div>
          </header>

          {loading ? <p>{t(lang, 'common.loading')}</p> : null}
          {error ? <p>{error}</p> : null}

          <div className="listing-grid listing-grid--four listing-grid--center">
            {visiblePosts.map((post) => (
              <EntryCard
                key={post.id}
                post={post}
                lang={lang}
                href={`/${lang}/${section}/${post.slug}/`}
                showDraftBadge={admin.isAdmin}
              />
            ))}
          </div>

          {!loading && visiblePosts.length === 0 ? <p className="list-tags">{t(lang, 'common.noPosts')}</p> : null}
        </div>
      </section>

      {!admin.loading ? (
        <AdminDock
          lang={lang}
          showLogin={showLogin}
          isAdmin={admin.isAdmin}
          onLogin={requestAdmin}
          onLogout={() => {
            void logout().then(() => window.location.reload());
          }}
          onWrite={() => openCreate(section)}
          onManagePages={openPageManager}
          onChangePassword={openPasswordChange}
        />
      ) : null}
    </SiteShell>
  );
}

function DetailPage({
  admin,
  requestAdmin,
  openCreate,
  openPageManager,
  openPasswordChange,
  refreshKey,
  savedPost
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem, forcedLang?: SiteLang) => void;
  openPageManager: () => void;
  openPasswordChange: () => void;
  refreshKey: number;
  savedPost: PostSaveSnapshot | null;
}) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const lang = normalizeLang(params.lang);
  const section = normalizeSection(params.section || '') as SiteSection | null;
  const slug = String(params.slug || '');
  const isValidSection = Boolean(section);

  const [post, setPost] = useState<PostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previousPost, setPreviousPost] = useState<PostItem | null>(null);
  const [nextPost, setNextPost] = useState<PostItem | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<PostItem[]>([]);
  const languageToggle = useMemo(
    () => buildDetailLanguageToggle(lang, section, slug, post?.pair_slug),
    [lang, post?.pair_slug, section, slug]
  );
  const locationState = location.state as LanguageToggleState | null;
  const languageSwitchFallback =
    locationState?.languageSwitch && locationState.fallbackPath ? locationState.fallbackPath : null;

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError('');

    async function load() {
      if (!isValidSection || !section) {
        setPost(null);
        setLoading(false);
        return;
      }

      try {
        const response = await getPostBySlug(slug, lang, section);
        if (canceled) return;
        setPost(response.post);
      } catch (err) {
        if (canceled) return;
        const message = err instanceof Error ? err.message : 'Failed to load post';
        if (message === 'Post not found' && languageSwitchFallback) {
          navigate(languageSwitchFallback, { replace: true });
          return;
        }
        setPost(null);
        setError(message);
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [isValidSection, lang, languageSwitchFallback, navigate, refreshKey, section, slug]);

  useEffect(() => {
    if (!savedPost) return;
    setPost((prev) => {
      if (!prev || prev.id !== savedPost.id) return prev;
      return toPostItem(savedPost, prev);
    });
  }, [savedPost]);

  useEffect(() => {
    if (!post) {
      setPreviousPost(null);
      setNextPost(null);
      setRelatedPosts([]);
      return;
    }
    const currentPost: PostItem = post;
    if (currentPost.section === 'pages') {
      setPreviousPost(null);
      setNextPost(null);
      setRelatedPosts([]);
      return;
    }

    let canceled = false;
    async function loadNeighborsAndRelated() {
      try {
        const status = admin.isAdmin ? 'all' : 'published';
        const [neighborsResponse, relatedResponse] = await Promise.all([
          listPosts({
            lang: currentPost.lang,
            section: currentPost.section,
            status,
            page: 1,
            limit: 120
          }),
          currentPost.tags[0]
            ? listPosts({
                lang: currentPost.lang,
                section: currentPost.section,
                status,
                tag: currentPost.tags[0],
                page: 1,
                limit: 120
              })
            : Promise.resolve({ ok: true, items: [], page: 1, limit: 0, total: 0 })
        ]);

        if (canceled) return;

        const neighbors = Array.isArray(neighborsResponse.items) ? neighborsResponse.items : [];
        const currentIndex = neighbors.findIndex((item) => item.id === currentPost.id);
        setPreviousPost(currentIndex >= 0 ? neighbors[currentIndex + 1] || null : null);
        setNextPost(currentIndex > 0 ? neighbors[currentIndex - 1] || null : null);

        const related = Array.isArray(relatedResponse.items) ? relatedResponse.items : [];
        setRelatedPosts(
          related
            .filter((item) => item.id !== currentPost.id)
            .slice(0, 4)
        );
      } catch {
        if (canceled) return;
        setPreviousPost(null);
        setNextPost(null);
        setRelatedPosts([]);
      }
    }

    void loadNeighborsAndRelated();
    return () => {
      canceled = true;
    };
  }, [admin.isAdmin, post?.id, post?.lang, post?.section, post?.tags]);

  useEffect(() => {
    if (!post) return;
    const canonical = `${window.location.origin}/${post.lang}/${post.section}/${post.slug}/`;
    const metaTitle = post.meta?.title?.trim() || post.title;
    const metaDescription = post.meta?.description?.trim() || post.excerpt || '';
    const ogTitle = metaTitle;
    const ogDescription = metaDescription;
    const ogImage = post.card?.imageUrl || post.cover?.url || '';

    const previousTitle = document.title;
    document.title = `${metaTitle} | GA-ML`;

    const cleanup = [
      upsertHeadMeta('meta[name="description"]', 'name', 'description', metaDescription),
      upsertHeadMeta('meta[property="og:type"]', 'property', 'og:type', 'article'),
      upsertHeadMeta('meta[property="og:title"]', 'property', 'og:title', ogTitle),
      upsertHeadMeta('meta[property="og:description"]', 'property', 'og:description', ogDescription),
      upsertHeadMeta('meta[property="og:url"]', 'property', 'og:url', canonical)
    ];

    if (ogImage) {
      cleanup.push(upsertHeadMeta('meta[property="og:image"]', 'property', 'og:image', ogImage));
    }

    return () => {
      document.title = previousTitle;
      cleanup.forEach((fn) => fn());
    };
  }, [post]);

  const html = useMemo(() => renderRichContent(post?.content_md), [post?.content_md]);

  const showLogin = useMemo(() => new URLSearchParams(window.location.search).get('admin') === '8722', []);
  const enableHiddenPolicyLogin =
    section === 'pages' && lang === 'en' && slug === 'privacy-policy' && !admin.isAdmin;
  const isStandalonePage = section === 'pages';
  const isTrendAnalyzerTool = section === 'tools' && slug === TREND_ANALYZER_TOOL_SLUG;
  const isHoldemTournamentGame = section === 'games' && slug === TEXAS_HOLDEM_TOURNAMENT_SLUG;
  const isEmbeddedProgramPost = isTrendAnalyzerTool || isHoldemTournamentGame;
  const programTopHtml = useMemo(
    () => (isEmbeddedProgramPost ? renderRichContent(post?.content_before_md) : ''),
    [isEmbeddedProgramPost, post?.content_before_md]
  );
  const programBottomSource = useMemo(() => {
    if (!isEmbeddedProgramPost) return '';
    if (post?.content_after_md) return post.content_after_md;
    if (!post?.content_before_md) return post?.content_md || '';
    return '';
  }, [isEmbeddedProgramPost, post?.content_after_md, post?.content_before_md, post?.content_md]);
  const programBottomHtml = useMemo(
    () => (isEmbeddedProgramPost ? renderRichContent(programBottomSource) : ''),
    [isEmbeddedProgramPost, programBottomSource]
  );
  const schemaJson = useMemo(() => {
    if (!post?.schemaType) return '';

    const url = `${window.location.origin}/${post.lang}/${post.section}/${post.slug}/`;
    if (post.schemaType === 'Service') {
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: post.title,
        description: post.excerpt || '',
        url
      });
    }

    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.excerpt || '',
      datePublished: post.published_at || post.created_at,
      dateModified: post.updated_at,
      inLanguage: post.lang,
      url
    });
  }, [post]);

  if (!isValidSection || !section) return <Navigate to={`/${lang}/`} replace />;

  return (
    <SiteShell
      lang={lang}
      active={section}
      languageTogglePath={languageToggle.path}
      languageToggleState={languageToggle.state}
    >
      <article className="page-section">
        <div className={`container detail-layout${isEmbeddedProgramPost ? ' detail-layout--program' : ''}`}>
          {loading ? <p>{t(lang, 'common.loading')}</p> : null}
          {error ? <p>{error}</p> : null}
          {!loading && !error && post ? (
            <>
              <header className="detail-layout__head">
                {!isStandalonePage ? (
                  <>
                    <div className="detail-layout__pager">
                      {previousPost ? (
                        <Link className="detail-layout__pager-link" to={`/${post.lang}/${post.section}/${previousPost.slug}/`}>
                          {t(lang, 'detail.prev')}
                        </Link>
                      ) : (
                        <span className="detail-layout__pager-link detail-layout__pager-link--placeholder" aria-hidden="true">
                          {t(lang, 'detail.prev')}
                        </span>
                      )}
                      {nextPost ? (
                        <Link
                          className="detail-layout__pager-link detail-layout__pager-link--next"
                          to={`/${post.lang}/${post.section}/${nextPost.slug}/`}
                        >
                          {t(lang, 'detail.next')}
                        </Link>
                      ) : (
                        <span
                          className="detail-layout__pager-link detail-layout__pager-link--next detail-layout__pager-link--placeholder"
                          aria-hidden="true"
                        >
                          {t(lang, 'detail.next')}
                        </span>
                      )}
                    </div>
                    <p className="detail-layout__tag">
                      {Array.isArray(post.tags) && post.tags.length > 0 ? post.tags.join(' | ') : t(lang, 'detail.tagFallback')}
                    </p>
                    <p className="detail-layout__date">
                      {t(lang, 'detail.created')}: {new Date(post.created_at).toLocaleDateString()}
                      {post.updated_at && post.updated_at !== post.created_at
                        ? ` | ${t(lang, 'detail.updated')}: ${new Date(post.updated_at).toLocaleDateString()}`
                        : ''}
                      {shouldShowViewCount(post) ? ` | ${t(lang, 'detail.views')}: ${formatViewCount(post.view_count, lang)}` : ''}
                    </p>
                  </>
                ) : shouldShowViewCount(post) ? (
                  <p className="detail-layout__date">
                    {t(lang, 'detail.views')}: {formatViewCount(post.view_count, lang)}
                  </p>
                ) : null}
                <div className="detail-layout__title-row">
                  <h1>
                    {renderTitleWithHiddenLoginTrigger(post.title, enableHiddenPolicyLogin, requestAdmin)}
                  </h1>
                </div>
              </header>

              {isEmbeddedProgramPost && programTopHtml ? (
                <section className="detail-layout__content content-prose" dangerouslySetInnerHTML={{ __html: programTopHtml }} />
              ) : null}

              {isTrendAnalyzerTool ? (
                <section className="detail-program detail-program--tool" aria-label="Tool area">
                  <TrendAnalyzerToolContent lang={lang} embedded />
                </section>
              ) : isHoldemTournamentGame ? (
                <section className="detail-program detail-program--game" aria-label="Game area">
                  <HoldemTournamentGameContent lang={lang} embedded />
                </section>
              ) : (section === 'tools' || section === 'games') && (
                <section className="detail-program" aria-label="Program area">
                  {post.cover?.url ? (
                    <img src={post.cover.url} alt={post.title} loading="lazy" decoding="async" />
                  ) : (
                    <div className="detail-program__placeholder">
                      {lang === 'ko' ? '도구 / 게임 영역' : 'Tool / Game Area'}
                    </div>
                  )}
                </section>
              )}

              {isEmbeddedProgramPost ? (
                programBottomHtml ? (
                  <section className="detail-layout__content content-prose" dangerouslySetInnerHTML={{ __html: programBottomHtml }} />
                ) : null
              ) : (
                <section className="detail-layout__content content-prose" dangerouslySetInnerHTML={{ __html: html }} />
              )}
              {!isStandalonePage && relatedPosts.length > 0 ? (
                <section className="detail-related" aria-label={t(lang, 'detail.related')}>
                  <h2>{`${t(lang, 'detail.related')}: #${post.tags[0]}`}</h2>
                  <ul>
                    {relatedPosts.map((item) => (
                      <li key={`related-${item.id}`}>
                        <Link to={`/${item.lang}/${item.section}/${item.slug}/`}>{item.title}</Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {schemaJson ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schemaJson }} /> : null}
            </>
          ) : null}
        </div>
      </article>

      {!admin.loading ? (
        <AdminDock
          lang={lang}
          showLogin={showLogin}
          isAdmin={admin.isAdmin}
          onLogin={requestAdmin}
          onLogout={() => {
            void logout().then(() => window.location.reload());
          }}
          onWrite={() => openCreate(section)}
          onManagePages={openPageManager}
          onEditCurrent={post ? () => openCreate(section, post) : undefined}
          onChangePassword={openPasswordChange}
        />
      ) : null}
    </SiteShell>
  );
}

function AppInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state: admin, refresh } = useAdminSession();
  const hasTrackedInitialPageView = useRef(false);

  const [editorState, setEditorState] = useState<EditorState>({
    open: false,
    mode: 'create',
    initialPost: null,
    defaultLang: 'en',
    defaultSection: 'blog'
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [savedPost, setSavedPost] = useState<PostSaveSnapshot | null>(null);
  const [pageManagerOpen, setPageManagerOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const currentLang = useMemo(() => {
    const first = location.pathname.split('/').filter(Boolean)[0];
    return normalizeLang(first);
  }, [location.pathname]);

  useEffect(() => {
    if (!hasTrackedInitialPageView.current) {
      hasTrackedInitialPageView.current = true;
      return;
    }

    const pagePath = `${location.pathname}${location.search}${location.hash}`;
    trackPageView(pagePath);
  }, [location.hash, location.pathname, location.search]);

  const requestAdmin = useCallback(() => {
    setLoginOpen(true);
  }, []);

  const openCreate = useCallback(
    (section: SiteSection, post?: PostItem, forcedLang?: SiteLang) => {
      if (!admin.isAdmin) return;

      if (post) {
        setEditorState({
          open: true,
          mode: 'edit',
          initialPost: post,
          defaultLang: post.lang,
          defaultSection: post.section
        });
        return;
      }

      setEditorState({
        open: true,
        mode: 'create',
        initialPost: null,
        defaultLang: forcedLang || currentLang,
        defaultSection: section
      });
    },
    [admin.isAdmin, currentLang]
  );

  const openPageManager = useCallback(() => {
    if (!admin.isAdmin) return;
    setPageManagerOpen(true);
  }, [admin.isAdmin]);

  const openCopy = useCallback(
    async (post: PostItem) => {
      if (!admin.isAdmin) return;

      const existingSlugs = await listAllSectionSlugs(post.lang, post.section);
      const nextSlug = buildCopySlug(post.slug, existingSlugs);
      const seed = buildCopySeed(post, nextSlug);

      setPageManagerOpen(false);
      setEditorState({
        open: true,
        mode: 'create',
        initialPost: seed,
        defaultLang: post.lang,
        defaultSection: post.section
      });
    },
    [admin.isAdmin]
  );

  return (
    <>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route
          path="/:lang"
          element={
            <HomePage
              admin={admin}
              requestAdmin={requestAdmin}
              openCreate={openCreate}
              openPageManager={openPageManager}
              openPasswordChange={() => setPasswordOpen(true)}
              refreshKey={refreshKey}
              savedPost={savedPost}
            />
          }
        />
        <Route
          path="/:lang/:section"
          element={
            <SectionListPage
              admin={admin}
              requestAdmin={requestAdmin}
              openCreate={openCreate}
              openPageManager={openPageManager}
              openPasswordChange={() => setPasswordOpen(true)}
              refreshKey={refreshKey}
              savedPost={savedPost}
            />
          }
        />
        <Route
          path="/:lang/:section/:slug"
          element={
            <DetailPage
              admin={admin}
              requestAdmin={requestAdmin}
              openCreate={openCreate}
              openPageManager={openPageManager}
              openPasswordChange={() => setPasswordOpen(true)}
              refreshKey={refreshKey}
              savedPost={savedPost}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <PostEditorModal
        open={editorState.open}
        mode={editorState.mode}
        initialPost={editorState.initialPost}
        defaultLang={editorState.defaultLang}
        defaultSection={editorState.defaultSection}
        onClose={() => {
          setEditorState((prev) => ({ ...prev, open: false }));
        }}
        onSaved={(snapshot) => {
          const prev = editorState.initialPost;
          setEditorState((prev) => ({ ...prev, open: false }));
          setSavedPost(snapshot);
          setRefreshKey((prev) => prev + 1);

          if (editorState.mode === 'edit' && prev && prev.id === snapshot.id) {
            const slugChanged =
              prev.slug !== snapshot.slug || prev.section !== snapshot.section || prev.lang !== snapshot.lang;
            if (slugChanged) {
              navigate(`/${snapshot.lang}/${snapshot.section}/${snapshot.slug}/`, { replace: true });
            }
          }
        }}
        onDeleted={() => {
          setEditorState((prev) => ({ ...prev, open: false }));
          setRefreshKey((prev) => prev + 1);
        }}
      />

      <PageManagerModal
        open={pageManagerOpen}
        defaultLang={currentLang}
        onClose={() => setPageManagerOpen(false)}
        onCreate={(section, lang) => {
          setPageManagerOpen(false);
          openCreate(section, undefined, lang);
        }}
        onEdit={(post) => {
          setPageManagerOpen(false);
          openCreate(post.section, post, post.lang);
        }}
        onCopy={openCopy}
        onChanged={() => {
          setRefreshKey((prev) => prev + 1);
        }}
      />

      <AdminLoginModal
        open={loginOpen}
        lang={currentLang}
        onClose={() => setLoginOpen(false)}
        onSubmit={async (username, password) => {
          await login(username, password);
          await refresh();
          navigate(`${location.pathname}${location.search}`, { replace: true });
        }}
      />

      <AdminPasswordModal
        open={passwordOpen}
        lang={currentLang}
        onClose={() => setPasswordOpen(false)}
        onSubmit={async (currentPassword, newPassword) => {
          await changeAdminPassword(currentPassword, newPassword);
        }}
      />
    </>
  );
}

export default function App() {
  return <AppInner />;
}
