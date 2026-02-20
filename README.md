# Utility Box (Astro + MDX + Decap CMS)

A multilingual static content platform for `utility-box.org`.

## Stack
- Astro (static output)
- MDX content
- Decap CMS (`/admin`)
- GitHub + Cloudflare Pages

## Run
```bash
npm install
npm run dev
```

Build:
```bash
npm run build
```

## Content structure
All editable content lives under:
- `src/content/en/blog`
- `src/content/en/pages`
- `src/content/en/tools`
- `src/content/en/games`
- `src/content/ko/blog`
- `src/content/ko/pages`
- `src/content/ko/tools`
- `src/content/ko/games`

Frontmatter fields used:
- `title`
- `description`
- `slug`
- `lang` (`en` or `ko`)
- `date` (required for blog)
- `tags`
- `category`
- `heroImage`
- `cardImage`
- `pairSlug`

## Routes
Auto-generated via dynamic routes:
- `/{lang}/blog/`
- `/{lang}/tools/`
- `/{lang}/games/`
- `/{lang}/pages/`
- `/{lang}/{section}/category/{category}`
- `/{lang}/{section}/tag/{tag}`
- Detail pages from `slug`

Language toggle behavior:
- If paired content exists (`pairSlug`), header toggle links to the paired entry.
- If no pair exists, toggle links to the other language homepage.

## CMS
- Admin path: `/admin`
- Config: `public/admin/config.yml`
- Upload directory: `public/uploads`

### GitHub OAuth on Cloudflare Pages
Decap CMS with `backend: github` needs an OAuth token exchange endpoint.
This repo provides Cloudflare Pages Functions endpoints:
- `/api/auth` -> starts GitHub OAuth
- `/api/callback` -> exchanges code for token and returns token to Decap popup

Set these Cloudflare Pages environment variables:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- optional: `GITHUB_OAUTH_SCOPE` (default `repo`)

GitHub OAuth App settings:
- Homepage URL: `https://www.utility-box.org`
- Authorization callback URL: `https://www.utility-box.org/api/callback`

## MDX block components
Reusable blocks are in `src/components/mdx/`:
- `TextLink`
- `CTASection`
- `Callout`
- `Media`
- `MediaGrid`
- `CardGrid`
- `Divider`
- `QuoteBlock`
- `Steps`
- `YouTubeEmbed`

## Codex feature development
Editors manage content in CMS. When new interactive tool/game functionality is needed, add code routes/components under `src/pages` and link them from tool/game MDX.

## Cloudflare Pages
Recommended settings:
- Build command: `npm run build`
- Output directory: `dist`
- Root directory: repository root
