# Utility Box (Astro + MDX + Decap CMS)

A multilingual static site for `utility-box.org` with a section-based hybrid page builder.

## Stack
- Astro (static output)
- MDX content
- Decap CMS (`/admin`)
- GitHub + Cloudflare Pages

## Local run
```bash
npm install
npm run dev
```

Build:
```bash
npm run build
```

## Content structure
- Blog: `src/content/en/blog`, `src/content/ko/blog`
- Tools: `src/content/en/tools`, `src/content/ko/tools`
- Games: `src/content/en/games`, `src/content/ko/games`
- Page builder pages: `src/content/pages/en`, `src/content/pages/ko`

## Page Builder Model
Each page in `src/content/pages/{lang}` stores an ordered `sections` array in frontmatter.

Page frontmatter highlights:
- `title`, `description`, `slug`, `lang`, `pairSlug`
- `pageBg` (`none|solid|image`)
- `sections[]` (ordered)

Supported section types:
- `Hero`
- `RichText`
- `Media`
- `MediaText`
- `ToolEmbed`
- `GameEmbed`
- `LinkList`
- `CardGrid`
- `Callout`
- `Divider`

Shared section settings:
- `width` (`container|full`)
- `align` (`left|center`)
- `spacing` (`compact|normal|loose`)
- `bg` (`none|solid|image`)

Renderer:
- `src/components/sections/SectionRenderer.astro`

## Internal Route Index + Link Validation
Build pipeline generates route dropdown data and validates section links.

Scripts:
- `npm run generate:routes` -> writes:
  - `public/internal-routes.en.json`
  - `public/internal-routes.ko.json`
- `npm run validate:links` -> validates section internal links against route index
- `npm run build` runs both automatically via `prebuild`

If validation fails, build stops with page/section-level error output.

## CMS
- Admin path: `/admin`
- Config: `public/admin/config.yml`
- Upload directory: `public/uploads`
- Internal route picker widget: `public/admin/widgets/internal-route.js`

### GitHub OAuth on Cloudflare Pages
Pages Functions endpoints:
- `/api/auth`
- `/api/callback`

Set Cloudflare Pages environment variables:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- optional: `GITHUB_OAUTH_SCOPE` (default `repo`)

GitHub OAuth App settings:
- Homepage URL: `https://www.utility-box.org`
- Authorization callback URL: `https://www.utility-box.org/api/callback`

## Routes
- `/{lang}/`
- `/{lang}/blog/`, `/{lang}/tools/`, `/{lang}/games/`, `/{lang}/pages/`
- `/{lang}/{section}/{slug}/`
- `/{lang}/{section}/category/{category}/`
- `/{lang}/{section}/tag/{tag}/`
- `/{lang}/pages/{slug}/`
- `/{lang}/pages/category/{category}/`
- `/{lang}/pages/tag/{tag}/`
- `/rss.xml`
- `/sitemap.xml`

## Cloudflare Pages settings
- Build command: `npm run build`
- Output directory: `dist`
- Root directory: repository root (`/`)
