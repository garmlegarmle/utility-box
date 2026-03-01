import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { AdminDock } from './components/AdminDock';
import { EntryCard } from './components/EntryCard';
import { PageManagerModal } from './components/PageManagerModal';
import { PostEditorModal } from './components/PostEditorModal';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { buildAuthUrl, getPostBySlug, getSession, listPosts, logout } from './lib/api';
import { detectBrowserLang, normalizeLang, normalizeSection, sectionLabel } from './lib/site';
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

function toPostItem(snapshot: PostSaveSnapshot, existing?: PostItem): PostItem {
  return {
    id: snapshot.id,
    slug: snapshot.slug,
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    content_md: existing?.content_md || '',
    status: snapshot.status,
    published_at: snapshot.status === 'published' ? existing?.published_at || snapshot.updated_at : null,
    created_at: existing?.created_at || snapshot.updated_at,
    updated_at: snapshot.updated_at,
    lang: snapshot.lang,
    section: snapshot.section,
    pair_slug: existing?.pair_slug || null,
    view_count: existing?.view_count || 0,
    tags: snapshot.tags,
    cover: existing?.cover || null,
    card: snapshot.card
  };
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
  children
}: {
  lang: SiteLang;
  active: 'home' | SiteSection;
  children: React.ReactNode;
}) {
  return (
    <div className="site-shell">
      <SiteHeader lang={lang} active={active} />
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
  refreshKey,
  savedPost
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem, forcedLang?: SiteLang) => void;
  openPageManager: () => void;
  refreshKey: number;
  savedPost: PostSaveSnapshot | null;
}) {
  const params = useParams();
  const lang = normalizeLang(params.lang);
  const [blogPosts, setBlogPosts] = useState<PostItem[]>([]);
  const [toolPosts, setToolPosts] = useState<PostItem[]>([]);
  const [gamePosts, setGamePosts] = useState<PostItem[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let canceled = false;

    async function load() {
      setError('');
      try {
        const status = admin.isAdmin ? 'all' : 'published';
        const [blog, tools, games] = await Promise.all([
          listPosts({ lang, section: 'blog', status, limit: 12 }),
          listPosts({ lang, section: 'tools', status, limit: 12 }),
          listPosts({ lang, section: 'games', status, limit: 12 })
        ]);

        if (canceled) return;
        setBlogPosts(Array.isArray(blog.items) ? blog.items : []);
        setToolPosts(Array.isArray(tools.items) ? tools.items : []);
        setGamePosts(Array.isArray(games.items) ? games.items : []);
      } catch (err) {
        if (canceled) return;
        setBlogPosts([]);
        setToolPosts([]);
        setGamePosts([]);
        setError(err instanceof Error ? err.message : 'Failed to load home feeds');
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
    if (savedPost.status !== 'published') return;

    if (savedPost.section === 'blog') {
      setBlogPosts((prev) => upsertPost(prev, savedPost, 12));
    } else if (savedPost.section === 'tools') {
      setToolPosts((prev) => upsertPost(prev, savedPost, 12));
    } else if (savedPost.section === 'games') {
      setGamePosts((prev) => upsertPost(prev, savedPost, 12));
    }
  }, [lang, savedPost]);

  const showLogin = useMemo(() => new URLSearchParams(window.location.search).get('admin') === '8722', []);

  return (
    <SiteShell lang={lang} active="home">
      <section className="page-section home-row-section">
        <div className="container">
          <h2 className="row-heading">Blog</h2>
          <div className="home-row-shell">
            <button className="home-row-arrow" type="button" aria-label="Previous blog items" disabled>
              <span aria-hidden="true">‹</span>
            </button>
            <div className="home-row-track">
              {blogPosts.map((post) => (
                <EntryCard
                  key={post.id}
                  post={post}
                  lang={lang}
                  href={`/${lang}/blog/${post.slug}/`}
                  showDraftBadge={admin.isAdmin}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="page-section home-row-section">
        <div className="container">
          <h2 className="row-heading">Tool</h2>
          <div className="home-row-shell">
            <button className="home-row-arrow" type="button" aria-label="Previous tool items" disabled>
              <span aria-hidden="true">‹</span>
            </button>
            <div className="home-row-track">
              {toolPosts.map((post) => (
                <EntryCard
                  key={post.id}
                  post={post}
                  lang={lang}
                  href={`/${lang}/tools/${post.slug}/`}
                  showDraftBadge={admin.isAdmin}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="page-section home-row-section">
        <div className="container">
          <h2 className="row-heading">Game</h2>
          <div className="home-row-shell">
            <button className="home-row-arrow" type="button" aria-label="Previous game items" disabled>
              <span aria-hidden="true">‹</span>
            </button>
            <div className="home-row-track">
              {gamePosts.map((post) => (
                <EntryCard
                  key={post.id}
                  post={post}
                  lang={lang}
                  href={`/${lang}/games/${post.slug}/`}
                  showDraftBadge={admin.isAdmin}
                />
              ))}
            </div>
          </div>
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
          showLogin={showLogin}
          isAdmin={admin.isAdmin}
          onLogin={requestAdmin}
          onLogout={() => {
            void logout().then(() => window.location.reload());
          }}
          onWrite={() => openCreate('blog')}
          onManagePages={openPageManager}
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
  refreshKey,
  savedPost
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem, forcedLang?: SiteLang) => void;
  openPageManager: () => void;
  refreshKey: number;
  savedPost: PostSaveSnapshot | null;
}) {
  const params = useParams();
  const lang = normalizeLang(params.lang);
  const section = normalizeSection(params.section || '') as SiteSection | null;
  const isValidSection = Boolean(section && section !== 'pages');

  const [posts, setPosts] = useState<PostItem[]>([]);
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
    if (!savedPost) return;
    if (!section || !isValidSection) return;
    if (savedPost.lang !== lang || savedPost.section !== section) return;
    if (savedPost.status !== 'published' && !admin.isAdmin) return;

    setPosts((prev) => upsertPost(prev, savedPost, 120));
  }, [admin.isAdmin, isValidSection, lang, savedPost, section]);

  const showLogin = useMemo(() => new URLSearchParams(window.location.search).get('admin') === '8722', []);

  if (!isValidSection || !section) {
    return <Navigate to={`/${lang}/`} replace />;
  }

  return (
    <SiteShell lang={lang} active={section}>
      <section className="page-section">
        <div className="container">
          <header className="list-head">
            <h1>{sectionLabel(section, lang)}</h1>
            <p className="list-tags">tag list ~~~~~~~~~~~~~~~~~~~~~~~~~~</p>
          </header>

          {loading ? <p>Loading...</p> : null}
          {error ? <p>{error}</p> : null}

          <div className="listing-grid listing-grid--four">
            {posts.map((post) => (
              <EntryCard
                key={post.id}
                post={post}
                lang={lang}
                href={`/${lang}/${section}/${post.slug}/`}
                showDraftBadge={admin.isAdmin}
              />
            ))}
          </div>

          {!loading && posts.length === 0 ? <p className="list-tags">No posts yet.</p> : null}
        </div>
      </section>

      {!admin.loading ? (
        <AdminDock
          showLogin={showLogin}
          isAdmin={admin.isAdmin}
          onLogin={requestAdmin}
          onLogout={() => {
            void logout().then(() => window.location.reload());
          }}
          onWrite={() => openCreate(section)}
          onManagePages={openPageManager}
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
  refreshKey,
  savedPost
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem, forcedLang?: SiteLang) => void;
  openPageManager: () => void;
  refreshKey: number;
  savedPost: PostSaveSnapshot | null;
}) {
  const params = useParams();
  const lang = normalizeLang(params.lang);
  const section = normalizeSection(params.section || '') as SiteSection | null;
  const slug = String(params.slug || '');
  const isValidSection = Boolean(section);

  const [post, setPost] = useState<PostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        setPost(null);
        setError(err instanceof Error ? err.message : 'Failed to load post');
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [isValidSection, lang, refreshKey, section, slug]);

  useEffect(() => {
    if (!savedPost) return;
    setPost((prev) => {
      if (!prev || prev.id !== savedPost.id) return prev;
      return toPostItem(savedPost, prev);
    });
  }, [savedPost]);

  useEffect(() => {
    if (!post) return;
    document.title = `${post.title} | Utility Box`;
  }, [post]);

  const html = useMemo(() => {
    if (!post?.content_md) return '';

    const raw = String(post.content_md || '');
    if (/<[a-z][\s\S]*>/i.test(raw)) {
      return DOMPurify.sanitize(raw);
    }

    const parsed = marked.parse(raw, { async: false }) as string;
    return DOMPurify.sanitize(parsed);
  }, [post?.content_md]);

  const showLogin = useMemo(() => new URLSearchParams(window.location.search).get('admin') === '8722', []);
  const enableHiddenPolicyLogin =
    section === 'pages' && lang === 'en' && slug === 'privacy-policy' && !admin.isAdmin;

  if (!isValidSection || !section) return <Navigate to={`/${lang}/`} replace />;

  return (
    <SiteShell lang={lang} active={section}>
      <article className="page-section">
        <div className="container detail-layout">
          {loading ? <p>Loading...</p> : null}
          {error ? <p>{error}</p> : null}
          {!loading && !error && post ? (
            <>
              <header className="detail-layout__head">
                <p className="detail-layout__tag">{Array.isArray(post.tags) && post.tags[0] ? post.tags[0] : 'tag'}</p>
                <div className="detail-layout__title-row">
                  <h1>
                    {renderTitleWithHiddenLoginTrigger(post.title, enableHiddenPolicyLogin, requestAdmin)}
                  </h1>
                </div>
                {post.excerpt ? <p className="list-tags">{post.excerpt}</p> : null}
              </header>

              {(section === 'tools' || section === 'games') && (
                <section className="detail-program" aria-label="Program area">
                  {post.cover?.url ? (
                    <img src={post.cover.url} alt={post.title} loading="lazy" decoding="async" />
                  ) : (
                    <div className="detail-program__placeholder">Tool / Game Area</div>
                  )}
                </section>
              )}

              <section className="detail-layout__content content-prose" dangerouslySetInnerHTML={{ __html: html }} />
            </>
          ) : null}
        </div>
      </article>

      {!admin.loading ? (
        <AdminDock
          showLogin={showLogin}
          isAdmin={admin.isAdmin}
          onLogin={requestAdmin}
          onLogout={() => {
            void logout().then(() => window.location.reload());
          }}
          onWrite={() => openCreate(section)}
          onManagePages={openPageManager}
          onEditCurrent={post ? () => openCreate(section, post) : undefined}
        />
      ) : null}
    </SiteShell>
  );
}

function AppInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state: admin, refresh } = useAdminSession();

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

  const currentLang = useMemo(() => {
    const first = location.pathname.split('/').filter(Boolean)[0];
    return normalizeLang(first);
  }, [location.pathname]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; ok?: boolean; message?: string; redirectPath?: string };
      if (!payload || payload.type !== 'ub-admin-auth-success') return;

      if (payload.ok === false) {
        const message = payload.message || 'Authentication failed';
        window.alert(`Admin login failed: ${message}`);
        return;
      }

      void refresh();
      if (payload.ok && payload.redirectPath && typeof payload.redirectPath === 'string') {
        navigate(payload.redirectPath, { replace: true });
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate, refresh]);

  const requestAdmin = useCallback(() => {
    const redirectPath = `${location.pathname}${location.search}`;
    const authUrl = buildAuthUrl(redirectPath);
    const popup = window.open(authUrl, 'ubAdminAuth', 'width=620,height=760');

    if (!popup) {
      window.alert('Popup was blocked. Please allow popups and try again.');
      return;
    }

    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;

      if (popup.closed || attempts >= 45) {
        window.clearInterval(timer);
      }

      try {
        const session = await getSession();
        if (session.authenticated && session.isAdmin) {
          window.clearInterval(timer);
          await refresh();
          if (!popup.closed) popup.close();
        }
      } catch {
        // ignore polling errors and continue until timeout
      }
    }, 1000);
  }, [location.pathname, location.search, refresh]);

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
        onChanged={() => {
          setRefreshKey((prev) => prev + 1);
        }}
      />
    </>
  );
}

export default function App() {
  return <AppInner />;
}
