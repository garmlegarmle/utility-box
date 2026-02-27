# Utility Box (Astro + MDX)

Minimal multilingual static site for `utility-box.org`.

## Architecture
- Astro static output
- File-based content collections (no database)
- Fixed reusable page templates (no drag-and-drop/page builder)
- Git-based content management

## Layout Templates
- `src/layouts/HomeLayout.astro`
- `src/layouts/ToolsLayout.astro`
- `src/layouts/BlogLayout.astro`
- `src/layouts/GamesLayout.astro`
- `src/layouts/DetailLayout.astro`

## Content Structure
- `src/content/blog/en`, `src/content/blog/ko`
- `src/content/tools/en`, `src/content/tools/ko`
- `src/content/games/en`, `src/content/games/ko`
- `src/content/pages/en`, `src/content/pages/ko`

Each content file supports:
- `title`
- `description`
- `slug`
- `lang` (`en` or `ko`)
- `date` (required for blog, optional elsewhere)
- optional: `image`, `heroImage`, `cardImage`, `tags`, `category`, `pairSlug`
- body (`.md` or `.mdx`)

## Development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

Build pipeline includes a simple internal link check (`npm run validate:links`).

## Routes
- `/`
- `/{lang}/`
- `/{lang}/blog/`, `/{lang}/tools/`, `/{lang}/games/`, `/{lang}/pages/`
- `/{lang}/blog/{slug}/`
- `/{lang}/tools/{slug}/`
- `/{lang}/games/{slug}/`
- `/{lang}/pages/{slug}/`
- `/rss.xml`
- `/sitemap.xml`

## Cloudflare Pages
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root (`/`)

## Admin Inline Editing (No CMS)
Admin editing is handled by Cloudflare Pages Functions + GitHub OAuth.

### Required environment variables (Cloudflare Pages)
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `ADMIN_SESSION_SECRET` (random long string)
- `ADMIN_GITHUB_USERS` (comma-separated GitHub usernames allowed to edit)

Optional:
- `GITHUB_REPO` (default: `garmlegarmle/utility-box`)
- `GITHUB_BRANCH` (default: `main`)
- `GITHUB_OAUTH_SCOPE` (default: `repo`)

### GitHub OAuth App setup
- Authorization callback URL: `https://www.utility-box.org/api/callback`

### How to use as admin
1. Open any page with `?admin=1` (example: `/en/?admin=1`).
2. Click `Admin Login`.
3. After GitHub login, a `+` button appears (admin only).
4. Use `+` menu to:
   - edit current content page
   - add blog/tool/game/page entries
5. Use each card's `+` to edit that specific content file.

## Notice Board API (`/posts`)
This project also includes a runtime notice board API via Cloudflare Pages Functions.

### Main endpoints
- `GET /posts`
- `GET /posts/{id}`
- `POST /posts` (admin only, multipart)
- `PUT /posts/{id}` (admin only, multipart)
- `DELETE /posts/{id}` (admin only)
- `POST /posts/assets` (admin only)
- `GET /posts/assets/{asset_id}`
- `GET /posts/{post_id}/images/{image_id}`
- `POST /posts/{post_id}/poll/vote`
- `GET /posts/{post_id}/poll/voters` (admin only)

### Post fields
- `title` (required)
- `category` (required, one of `blog`, `tool`, `game`)
- `tags` (required, custom multiple tags)
- `body` (required, rich text HTML)
- `images` (optional, up to 6 files, each <= 10MB, image types only)

### Storage note
- Post data and uploaded files are saved to the GitHub repository through API calls.
- For visitor read on private repositories and for visitor write operations (view count / vote), set:
  - `POSTS_REPO_TOKEN` (token with repo write access)

### Notice page
- UI page: `/{lang}/notice/` (e.g., `/en/notice/`, `/ko/notice/`)
