export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ADMIN_TOKEN?: string;
  ADMIN_SESSION_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_OAUTH_SCOPE?: string;
  ADMIN_GITHUB_USER?: string;
  ADMIN_GITHUB_USERS?: string;
  ADMIN_GITHUB_USERNAME?: string;
  ADMIN_GITHUB_USERNAMES?: string;
  GITHUB_ADMIN_USER?: string;
  GITHUB_ADMIN_USERS?: string;
  ALLOWED_ORIGINS?: string;
  MEDIA_PUBLIC_BASE_URL?: string;
  COOKIE_DOMAIN?: string;
  DEBUG_LOGS?: string;
}

export interface ApiError {
  status: number;
  message: string;
}

export interface SessionUser {
  username: string;
  token: string;
  exp: number;
}

export interface PostRecord {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_md: string;
  status: 'draft' | 'published';
  cover_image_id: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  lang: 'en' | 'ko';
  section: 'blog' | 'tools' | 'games' | 'pages';
  pair_slug: string | null;
  is_deleted: number;
  deleted_at: string | null;
  view_count: number;
  card_title: string | null;
  card_category: string | null;
  card_tag: string | null;
  card_rank: number | null;
  card_image_id: number | null;
}
