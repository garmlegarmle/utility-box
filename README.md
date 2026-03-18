# GA-ML / Utility Box Repo

Current production stack:
- Frontend: React + Vite
- Public domain: `https://www.ga-ml.com` behind Cloudflare
- Runtime API: VPS-native Node/Express API (`/server`)
- Database: VPS PostgreSQL
- Media: VPS local storage (`/opt/utility-box/storage/uploads`)

VPS migration prep is available in `deploy/vps/` and `VPS_MIGRATION.md`.
The production backend lives under `server/`.

## Content Source Of Truth
- Code/layout: GitHub repository
- Runtime posts/cards/tags: PostgreSQL (`posts`, `tags`, `post_tags`, `app_settings`)
- Uploaded images/files: local VPS storage + metadata in PostgreSQL (`media`, `media_variants`)

The app does not read runtime content from MDX/JSON files at runtime.

## Scripts
- `npm run dev` - Vite dev server
- `npm run dev:api` - VPS-native API dev server
- `npm run dev:all` - run frontend + VPS API together
- `npm run dev:vps` - run frontend + VPS-native API together
- `npm run build` - build frontend to `dist`
- `npm run check` - TypeScript check

## Environment
Frontend (`.env`):
- `VITE_API_BASE` is optional for local development only

Production frontend calls same-origin `/api/*`, proxied by the VPS web container to the local API container.

Server env (`deploy/vps/env/utility-box.api.env`):
- `ADMIN_SESSION_SECRET`
- `ADMIN_LOGIN_USER`
- `ADMIN_LOGIN_PASSWORD` (bootstrap value; password changes are then stored in DB)
- optional: `ADMIN_TOKEN`, `MEDIA_PUBLIC_BASE_URL`

Agent handoff/runbook: see `CLAUDE_CODE_GUIDE.md`.

## Operations Checklist
1. Deploy API + web containers on VPS.
2. Ensure `/api/session` returns JSON.
3. Ensure admin local login works.
4. Validate:
   - `/api/session` keeps admin session after refresh.
   - public pages show `published` posts only.
   - new/edited posts appear on home/list/detail consistently.

## Security + Cost Baseline
Code-level defaults already applied:
- API write methods (`POST/PUT/DELETE/PATCH`) reject disallowed `Origin`.
- API write payloads over ~12MB are rejected early.
- Security headers are attached to all API responses.
- Public read endpoints now return cacheable `Cache-Control`:
  - `GET /api/posts` (published/public): short CDN/browser cache
  - `GET /api/tags`: short CDN/browser cache
  - `GET /api/media/:id`: medium CDN/browser cache
  - write/admin/auth endpoints stay `no-store`
- VPS `/api` proxy preserves API cache headers.

Cloudflare Dashboard hardening to add:
1. WAF managed rules: enable default OWASP set.
2. Bot protection: enable Bot Fight Mode.
3. Rate limiting rules:
   - `/api/upload`: strict (very low burst)
   - `/api/posts` write methods: strict
   - `/api/login`: moderate
4. Cache rules:
   - bypass cache for write/auth/session paths
   - allow cache for public read paths if `Cache-Control` permits

## Security Notes
- Never commit real secret values into the repository.
- Use local-only files (`.env.local`, `CLAUDE_LOCAL_SECRETS.md`) and VPS env files.
- Local secret template: `CLAUDE_LOCAL_SECRETS.example.md`.
