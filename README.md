# Utility Box

Cloudflare-native stack:
- Frontend: React + Vite (static build to `dist`)
- API: Cloudflare Worker (`/api/*`)
- Database: Cloudflare D1
- Media: Cloudflare R2

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
wrangler secret put ADMIN_TOKEN
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler deploy
```

Pages settings:
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Env var: `VITE_API_BASE=https://api.utility-box.org`

More detail: see `MIGRATION.md`.
