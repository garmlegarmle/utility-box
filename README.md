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

The app does not read runtime content from MDX/JSON files at runtime.

## Scripts
- `npm run dev` - Vite dev server
- `npm run dev:worker` - Worker dev server via Wrangler
- `npm run dev:all` - run frontend + worker together
- `npm run build` - build frontend to `dist`
- `npm run check` - TypeScript check

## Environment
Frontend (`.env`):
- `VITE_API_BASE=http://127.0.0.1:8787`

Production frontend calls same-origin `/api/*`, proxied by Pages Function (`functions/api/[[path]].js`) to `https://api.utility-box.org`.

Worker secrets/vars are configured with Wrangler:
- `ADMIN_TOKEN`
- `ADMIN_SESSION_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- optional: `ADMIN_GITHUB_USER`, `ADMIN_GITHUB_USERS`, `MEDIA_PUBLIC_BASE_URL`, `DEBUG_LOGS`

## Cloudflare Setup
```bash
wrangler login
wrangler d1 create utility-box-db
wrangler r2 bucket create utility-box-media
wrangler d1 execute utility-box-db --file db/schema.sql --remote
wrangler d1 execute utility-box-db --file db/seed.sql --remote
wrangler secret put ADMIN_TOKEN
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler deploy
```

Pages settings:
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Production env vars: `VITE_API_BASE` is not required (leave unset).

Host canonicalization:
- Pages middleware (`functions/_middleware.js`) redirects `utility-box.org` and `utility-box.pages.dev` to `https://www.utility-box.org` (301).

More detail: see `MIGRATION.md`.

## Debug Logging
- Worker debug logs are off by default.
- Enable by setting Worker variable `DEBUG_LOGS=1`.
- Then inspect logs with:
```bash
npx wrangler tail utility-box-api
```
- Logged flows:
  - auth start/callback/session/logout
  - posts list/detail/create/update/delete
  - top-level API status/error

## Operations Checklist
1. Apply schema + seed.
2. Deploy Worker.
3. Deploy Pages (`dist`).
4. Validate:
   - `/api/session` keeps admin session after refresh.
   - public pages show `published` posts only.
   - new/edited posts appear on home/list/detail consistently.
