# Utility Box Migration Guide

## Scope
This migration moves Utility Box from:
- Astro static pages + Pages Functions + Git/file CMS

to:
- React + Vite frontend (Cloudflare Pages static output)
- Single Cloudflare Worker API (`/api/*`)
- Cloudflare D1 for posts/tags/media metadata
- Cloudflare R2 for uploaded files

Legacy Astro code has been removed from the runtime repository.

## What Stays
- Existing route shape:
  - `/`
  - `/:lang`
  - `/:lang/blog`, `/:lang/blog/:slug`
  - `/:lang/tools`, `/:lang/tools/:slug`
  - `/:lang/games`, `/:lang/games/:slug`
  - `/:lang/pages/:slug`
- Existing visual direction (header/footer/card/list/detail)
- GitHub OAuth admin login UX

## What Changes
- Content source of truth: file system -> D1
- Upload storage: repo/public -> R2
- API: Pages Functions -> single Worker
- Editor persistence: git commit flow -> direct DB writes

## Decisions
- Content SoT: D1
- Delete policy: soft delete (`is_deleted = 1`)
- Admin auth: GitHub OAuth session cookie OR `Authorization: Bearer <ADMIN_TOKEN>`
- Existing user-generated posts/media: reset and start clean
- Existing static brand assets in `public/uploads/*.svg`: keep
- Image transforms: delivery-time fallback (variant metadata is still produced)

## Data Mapping (Old -> New)
- Old post JSON/MDX content -> `posts.content_md`
- Old `category` (`blog|tool|game`) -> `posts.section` (`blog|tools|games`)
- Old tag list -> `tags` + `post_tags`
- Old media file path -> `media.r2_key`

## Deployment Steps

### 1) Create Cloudflare resources
```bash
wrangler login
wrangler d1 create utility-box-db
wrangler r2 bucket create utility-box-media
```

### 2) Update `wrangler.toml`
- Set real `database_id`
- Set production route/domain for the Worker

### 3) Apply schema
```bash
wrangler d1 execute utility-box-db --file db/schema.sql --remote
wrangler d1 execute utility-box-db --file db/seed.sql --remote
```

### 4) Set Worker secrets
```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

Optional:
```bash
wrangler secret put ADMIN_GITHUB_USER
wrangler secret put ADMIN_GITHUB_USERS
wrangler secret put MEDIA_PUBLIC_BASE_URL
```

### 5) Deploy Worker
```bash
wrangler deploy
```

### 6) Cloudflare Pages settings
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Leave `VITE_API_BASE` unset for production (frontend uses same-origin `/api/*`).

## Local Development

Install:
```bash
npm install
```

Run frontend:
```bash
npm run dev
```

Run worker:
```bash
npm run dev:worker
```

Run both:
```bash
npm run dev:all
```

Default local endpoints:
- Frontend: `http://localhost:5173`
- Worker API: `http://127.0.0.1:8787`

## Cutover Checklist
- [ ] Worker deployed and D1/R2 bindings valid
- [ ] `/api/session` works with GitHub OAuth popup
- [ ] Post list/detail load from D1
- [ ] Admin create/update/delete works
- [ ] Upload returns media metadata and URL
- [ ] CORS allows Pages domain
