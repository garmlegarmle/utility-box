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
import { buildAuthUrl, getPostBySlug, getSession, listPosts, listTagCounts, logout } from './lib/api';
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
    meta: snapshot.meta || existing?.meta || { title: null, description: null },
    og: snapshot.og || existing?.og || { title: null, description: null, imageUrl: null },
    schemaType: snapshot.schemaType ?? existing?.schemaType ?? null,
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
          <header className="list-head">
            <div className="list-tags-center">
              <p className="list-tags-title">Category</p>
              <p className="list-tags">
                {([
                  { key: 'all', label: 'All', count: categoryCounts.all },
                  { key: 'tools', label: 'Tool', count: categoryCounts.tools },
                  { key: 'games', label: 'Game', count: categoryCounts.games },
                  { key: 'blog', label: 'Blog', count: categoryCounts.blog }
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
              <p className="list-tags-title">Tag list</p>
              {tagCounts.length > 0 ? (
                <p className="list-tags">
                  <span key="home-tag-all">
                    <button
                      type="button"
                      className={`tag-filter-btn${selectedTag === '' ? ' is-active' : ''}`}
                      onClick={() => setSelectedTag('')}
                    >
                      All({categoryPosts.length})
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
                    All({categoryPosts.length})
                  </button>
                </p>
              )}
            </div>
          </header>

          {loading ? <p>Loading...</p> : null}
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

          {!loading && visiblePosts.length === 0 ? <p className="list-tags">No posts yet.</p> : null}
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
          onWrite={() => openCreate(selectedCategory === 'all' ? 'blog' : selectedCategory)}
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
  const isValidSection = Boolean(section);

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [tagCounts, setTagCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [sectionTotal, setSectionTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError('');

    async function load() {
      if (!isValidSection || !section) {
        setPosts([]);
        setTagCounts([]);
        setSectionTotal(0);
        setLoading(false);
        return;
      }

      try {
        const [response, totals, tags] = await Promise.all([
          listPosts({
            lang,
            section,
            status: admin.isAdmin ? 'all' : 'published',
            tag: selectedTag || undefined,
            limit: 120,
            page: 1
          }),
          listPosts({
            lang,
            section,
            status: admin.isAdmin ? 'all' : 'published',
            limit: 1,
            page: 1
          }),
          listTagCounts({ lang, section })
        ]);
        if (canceled) return;
        setPosts(response.items);
        setSectionTotal(Number(totals.total || 0));
        setTagCounts(Array.isArray(tags.items) ? tags.items : []);
      } catch (err) {
        if (canceled) return;
        setPosts([]);
        setTagCounts([]);
        setSectionTotal(0);
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [admin.isAdmin, isValidSection, lang, refreshKey, section, selectedTag]);

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
              <p className="list-tags-title">Tag list</p>
              {tagCounts.length > 0 ? (
                <p className="list-tags">
                  <span key="see-all-tag">
                    <button
                      type="button"
                      className={`tag-filter-btn${selectedTag === '' ? ' is-active' : ''}`}
                      onClick={() => setSelectedTag('')}
                    >
                      All({sectionTotal})
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
                    All({sectionTotal})
                  </button>
                </p>
              )}
            </div>
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
  const [previousPost, setPreviousPost] = useState<PostItem | null>(null);
  const [nextPost, setNextPost] = useState<PostItem | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<PostItem[]>([]);

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
    if (!post) {
      setPreviousPost(null);
      setNextPost(null);
      setRelatedPosts([]);
      return;
    }
    const currentPost: PostItem = post;

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
    document.title = `${metaTitle} | Utility Box`;

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
    <SiteShell lang={lang} active={section}>
      <article className="page-section">
        <div className="container detail-layout">
          {loading ? <p>Loading...</p> : null}
          {error ? <p>{error}</p> : null}
          {!loading && !error && post ? (
            <>
              <header className="detail-layout__head">
                <div className="detail-layout__pager">
                  {previousPost ? (
                    <Link className="detail-layout__pager-link" to={`/${post.lang}/${post.section}/${previousPost.slug}/`}>
                      {'< 이전글'}
                    </Link>
                  ) : (
                    <span className="detail-layout__pager-link detail-layout__pager-link--placeholder" aria-hidden="true">
                      {'< 이전글'}
                    </span>
                  )}
                  {nextPost ? (
                    <Link
                      className="detail-layout__pager-link detail-layout__pager-link--next"
                      to={`/${post.lang}/${post.section}/${nextPost.slug}/`}
                    >
                      {'다음글 >'}
                    </Link>
                  ) : (
                    <span
                      className="detail-layout__pager-link detail-layout__pager-link--next detail-layout__pager-link--placeholder"
                      aria-hidden="true"
                    >
                      {'다음글 >'}
                    </span>
                  )}
                </div>
                <p className="detail-layout__tag">
                  {Array.isArray(post.tags) && post.tags.length > 0 ? post.tags.join(' | ') : 'tag'}
                </p>
                <p className="detail-layout__date">
                  Created: {new Date(post.created_at).toLocaleDateString()}
                  {post.updated_at && post.updated_at !== post.created_at
                    ? ` | Updated: ${new Date(post.updated_at).toLocaleDateString()}`
                    : ''}
                </p>
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
              {relatedPosts.length > 0 ? (
                <section className="detail-related" aria-label="Related posts">
                  <h2>{`#${post.tags[0]} posts`}</h2>
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
