import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { AdminDock } from './components/AdminDock';
import { EntryCard } from './components/EntryCard';
import { PostEditorModal } from './components/PostEditorModal';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { buildAuthUrl, getPostBySlug, getSession, listPosts, logout } from './lib/api';
import { detectBrowserLang, normalizeLang, normalizeSection, sectionLabel } from './lib/site';
import type { PostItem, SiteLang, SiteSection } from './types';

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
  openCreate
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem) => void;
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
        const [blog, tools, games] = await Promise.all([
          listPosts({ lang, section: 'blog', status: 'published', limit: 12 }),
          listPosts({ lang, section: 'tools', status: 'published', limit: 12 }),
          listPosts({ lang, section: 'games', status: 'published', limit: 12 })
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
  }, [lang]);

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
                <EntryCard key={post.id} post={post} lang={lang} href={`/${lang}/blog/${post.slug}/`} />
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
                <EntryCard key={post.id} post={post} lang={lang} href={`/${lang}/tools/${post.slug}/`} />
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
                <EntryCard key={post.id} post={post} lang={lang} href={`/${lang}/games/${post.slug}/`} />
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

      <AdminDock
        showLogin={showLogin}
        isAdmin={admin.isAdmin}
        onLogin={requestAdmin}
        onLogout={() => {
          void logout().then(() => window.location.reload());
        }}
        onWrite={() => openCreate('blog')}
      />
    </SiteShell>
  );
}

function SectionListPage({
  admin,
  requestAdmin,
  openCreate
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem) => void;
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
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [admin.isAdmin, isValidSection, lang, section]);

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
              />
            ))}
          </div>

          {!loading && posts.length === 0 ? <p className="list-tags">No posts yet.</p> : null}
        </div>
      </section>

      <AdminDock
        showLogin={showLogin}
        isAdmin={admin.isAdmin}
        onLogin={requestAdmin}
        onLogout={() => {
          void logout().then(() => window.location.reload());
        }}
        onWrite={() => openCreate(section)}
      />
    </SiteShell>
  );
}

function DetailPage({
  admin,
  requestAdmin,
  openCreate
}: {
  admin: AdminState;
  requestAdmin: () => void;
  openCreate: (section: SiteSection, post?: PostItem) => void;
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
        setError(err instanceof Error ? err.message : 'Failed to load post');
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [isValidSection, lang, section, slug]);

  useEffect(() => {
    if (!post) return;
    document.title = `${post.title} | Utility Box`;
  }, [post]);

  const html = useMemo(() => {
    if (!post?.content_md) return '';
    const parsed = marked.parse(post.content_md, { async: false }) as string;
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

      <AdminDock
        showLogin={showLogin}
        isAdmin={admin.isAdmin}
        onLogin={requestAdmin}
        onLogout={() => {
          void logout().then(() => window.location.reload());
        }}
        onWrite={() => openCreate(section)}
        onEditCurrent={post ? () => openCreate(section, post) : undefined}
      />
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

  const currentLang = useMemo(() => {
    const first = location.pathname.split('/').filter(Boolean)[0];
    return normalizeLang(first);
  }, [location.pathname]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; ok?: boolean; message?: string; redirectPath?: string };
      if (!payload || payload.type !== 'ub-admin-auth-success') return;
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
    (section: SiteSection, post?: PostItem) => {
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
        defaultLang: currentLang,
        defaultSection: section
      });
    },
    [admin.isAdmin, currentLang]
  );

  return (
    <>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/:lang" element={<HomePage admin={admin} requestAdmin={requestAdmin} openCreate={openCreate} />} />
        <Route
          path="/:lang/:section"
          element={<SectionListPage admin={admin} requestAdmin={requestAdmin} openCreate={openCreate} />}
        />
        <Route
          path="/:lang/:section/:slug"
          element={<DetailPage admin={admin} requestAdmin={requestAdmin} openCreate={openCreate} />}
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
        onSaved={(postId) => {
          setEditorState((prev) => ({ ...prev, open: false }));
          window.location.reload();
          void postId;
        }}
        onDeleted={() => {
          setEditorState((prev) => ({ ...prev, open: false }));
          window.location.reload();
        }}
      />
    </>
  );
}

export default function App() {
  return <AppInner />;
}
