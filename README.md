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
