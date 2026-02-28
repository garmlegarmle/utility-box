import type { PostDetailResponse, PostListResponse, SessionResponse, UploadResponse } from '../types';

const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!API_BASE) return path;
  return `${API_BASE}${path}`;
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.headers || {})
    }
  });

  const data = await parseJson(response);

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

export async function listPosts(params: ListPostsParams): Promise<PostListResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.tag) query.set('tag', params.tag);
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.lang) query.set('lang', params.lang);
  if (params.section) query.set('section', params.section);

  return apiFetch<PostListResponse>(`/api/posts?${query.toString()}`);
}

export async function getPostBySlug(slug: string, lang: 'en' | 'ko', section: string): Promise<PostDetailResponse> {
  const query = new URLSearchParams({ lang, section });
  return apiFetch<PostDetailResponse>(`/api/posts/${encodeURIComponent(slug)}?${query.toString()}`);
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

export async function updatePost(id: number, body: unknown): Promise<{ ok: true; id: number; updated_at: string }> {
  return apiFetch<{ ok: true; id: number; updated_at: string }>(`/api/posts/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
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

  return buildUrl(`/api/auth?${query.toString()}`);
}
