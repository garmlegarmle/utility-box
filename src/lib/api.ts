import type {
  PostDetailResponse,
  PostListResponse,
  SessionResponse,
  TagCountResponse,
  TagListResponse,
  UploadResponse
} from '../types';

function buildApiUrl(path: string): string {
  // Keep API calls same-origin to avoid host/CORS mismatch.
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedPath;
}

async function parseJson(response: Response): Promise<{ data: unknown; nonJsonText?: string }> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await response.text().catch(() => '');
    return { data: { __nonJson: true }, nonJsonText: text };
  }
  const parsed = await response.json().catch(() => ({ __parseError: true }));
  return { data: parsed };
}

async function performRequest(url: string, init?: RequestInit): Promise<{ response: Response; data: unknown; nonJsonText?: string }> {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      ...(init?.headers || {})
    }
  });

  const parsed = await parseJson(response);
  return { response, data: parsed.data, nonJsonText: parsed.nonJsonText };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = buildApiUrl(path);
  const { response, data, nonJsonText } = await performRequest(url, init);

  if (typeof data === 'object' && data !== null && '__nonJson' in data) {
    throw new Error(
      `API returned non-JSON response for ${path} via ${url} (status ${response.status}, content-type: ${
        response.headers.get('content-type') || 'unknown'
      }). ${String(nonJsonText || '').slice(0, 120)}`
    );
  }

  if (typeof data === 'object' && data !== null && '__parseError' in data) {
    throw new Error(`API JSON parse failed for ${path} via ${url}.`);
  }

  if (!response.ok || (typeof data === 'object' && data !== null && 'ok' in data && (data as { ok?: boolean }).ok === false)) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error?: string }).error || 'Request failed')
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export interface ListPostsParams {
  status?: 'published' | 'draft' | 'all';
  tag?: string;
  q?: string;
  page?: number;
  limit?: number;
  lang?: 'en' | 'ko';
  section?: 'blog' | 'tools' | 'games' | 'pages';
}

export interface ListTagsParams {
  lang?: 'en' | 'ko';
  section?: 'blog' | 'tools' | 'games' | 'pages';
}

export async function listPosts(params: ListPostsParams): Promise<PostListResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.tag) query.set('tag', params.tag);
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.lang) query.set('lang', params.lang);
  if (params.section) query.set('section', params.section);

  const data = await apiFetch<Partial<PostListResponse>>(`/api/posts?${query.toString()}`);

  if (!Array.isArray(data.items)) {
    throw new Error('Invalid posts response: items is not an array');
  }

  return {
    ok: true,
    items: data.items,
    page: Number(data.page || 1),
    limit: Number(data.limit || params.limit || 12),
    total: Number(data.total || data.items.length)
  };
}

export async function listTags(params: ListTagsParams = {}): Promise<TagListResponse> {
  const query = new URLSearchParams();
  if (params.lang) query.set('lang', params.lang);
  if (params.section) query.set('section', params.section);

  const suffix = query.toString();
  const data = await apiFetch<Partial<TagListResponse>>(`/api/tags${suffix ? `?${suffix}` : ''}`);

  return {
    ok: true,
    items: Array.isArray(data.items) ? data.items : []
  };
}

export async function listTagCounts(params: { lang: 'en' | 'ko'; section: 'blog' | 'tools' | 'games' | 'pages' }): Promise<TagCountResponse> {
  const query = new URLSearchParams({
    lang: params.lang,
    section: params.section,
    counts: '1'
  });

  const data = await apiFetch<Partial<TagCountResponse>>(`/api/tags?${query.toString()}`);
  const items = Array.isArray(data.items)
    ? data.items
        .map((item) => ({
          name: String((item as { name?: string }).name || '').trim(),
          count: Number((item as { count?: number }).count || 0)
        }))
        .filter((item) => Boolean(item.name))
    : [];

  return {
    ok: true,
    items
  };
}

export async function getPostBySlug(slug: string, lang: 'en' | 'ko', section: string): Promise<PostDetailResponse> {
  const query = new URLSearchParams({ lang, section });
  const data = await apiFetch<Partial<PostDetailResponse>>(`/api/posts/${encodeURIComponent(slug)}?${query.toString()}`);

  if (!data.post || typeof data.post !== 'object') {
    throw new Error('Invalid post response: post is missing');
  }

  return {
    ok: true,
    post: data.post as PostDetailResponse['post'],
    tags: Array.isArray(data.tags) ? data.tags : [],
    cover: (data.cover as PostDetailResponse['cover']) || null,
    media: Array.isArray(data.media) ? data.media : []
  };
}

export async function createPost(body: unknown): Promise<{ ok: true; id: number; slug: string }> {
  return apiFetch<{ ok: true; id: number; slug: string }>(`/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
}

export async function updatePost(
  id: number,
  body: unknown
): Promise<{ ok: true; id: number; slug?: string; section?: string; lang?: string; updated_at: string }> {
  return apiFetch<{ ok: true; id: number; slug?: string; section?: string; lang?: string; updated_at: string }>(
    `/api/posts/${id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    }
  );
}

export async function deletePost(id: number): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/posts/${id}`, {
    method: 'DELETE'
  });
}

export async function getSession(): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/api/session');
}

export async function logout(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/logout', {
    method: 'POST'
  });
}

export async function uploadMedia(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);

  return apiFetch<UploadResponse>('/api/upload', {
    method: 'POST',
    body: form
  });
}

export function buildAuthUrl(redirectPath: string): string {
  const query = new URLSearchParams({
    redirect: redirectPath,
    origin: window.location.origin
  });

  return `/api/auth?${query.toString()}`;
}
