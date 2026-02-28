export type SiteLang = 'en' | 'ko';
export type SiteSection = 'blog' | 'tools' | 'games' | 'pages';

export interface CardData {
  title: string;
  category: string;
  tag: string;
  rank: string | null;
  rankNumber: number | null;
  imageId: number | null;
  imageUrl: string | null;
}

export interface PostItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_md: string;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
  lang: SiteLang;
  section: SiteSection;
  pair_slug: string | null;
  view_count: number;
  tags: string[];
  cover: { id: number; url: string } | null;
  card: CardData;
}

export interface PostListResponse {
  ok: true;
  items: PostItem[];
  page: number;
  limit: number;
  total: number;
}

export interface PostDetailResponse {
  ok: true;
  post: PostItem;
  tags: string[];
  cover: { id: number; url: string } | null;
  media: unknown[];
}

export interface SessionResponse {
  ok: true;
  authenticated: boolean;
  isAdmin: boolean;
  username: string | null;
}

export interface UploadResponse {
  ok: true;
  mediaId: number;
  keys: Record<string, string>;
  urls: Record<string, string>;
  variants: Array<{ variant: string; key: string; width: number; format: string }>;
}
