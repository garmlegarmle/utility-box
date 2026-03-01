# Utility Box

Cloudflare-native stack:
- Frontend: React + Vite (static build to `dist`)
- API: Cloudflare Worker (`/api/*`)
- Database: Cloudflare D1
- Media: Cloudflare R2

## Content Source Of Truth
- Code/layout: GitHub repository
- Runtime posts/cards/tags: D1 (`posts`, `tags`, `post_tags`)
- Uploaded images/files: R2 (`media/*`) + metadata in D1 (`media`, `media_variants`)

The app does not read runtime content from legacy MDX/JSON files.

Legacy Astro implementation is preserved in `legacy/astro-20260228/`.

## Scripts
- `npm run dev` - Vite dev server
- `npm run dev:worker` - Worker dev server via Wrangler
- `npm run dev:all` - run frontend + worker together
- `npm run build` - build frontend to `dist`
- `npm run check` - TypeScript check

## Environment
Frontend (`.env`):
- `VITE_API_BASE=http://127.0.0.1:8787`

Production frontend should call same-origin `/api/*` routes.

Worker secrets/vars are configured with Wrangler:
- `ADMIN_TOKEN`
- `ADMIN_SESSION_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- optional: `ADMIN_GITHUB_USER`, `ADMIN_GITHUB_USERS`, `MEDIA_PUBLIC_BASE_URL`

## Cloudflare Setup
```bash
wrangler login
wrangler d1 create utility-box-db
wrangler r2 bucket create utility-box-media
wrangler d1 execute utility-box-db --file db/schema.sql --remote
wrangler d1 execute utility-box-db --file db/seed.sql --remote
# one-time legacy cleanup
wrangler d1 execute utility-box-db --file scripts/cleanup-legacy-posts.sql --remote
wrangler secret put ADMIN_TOKEN
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler deploy
```

Pages settings:
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Production env vars: optional (`VITE_API_BASE` is not required in production)

More detail: see `MIGRATION.md`.

## Operations Checklist
1. Apply schema + seed.
2. Run `scripts/cleanup-legacy-posts.sql` once to remove old sample posts.
3. Deploy Worker.
4. Deploy Pages (`dist`).
5. Validate:
   - `/api/session` keeps admin session after refresh.
   - public pages show `published` posts only.
   - new/edited posts appear on home/list/detail consistently.
