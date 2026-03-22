import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import multer from 'multer';
import { getConfig } from './config.js';
import {
  clamp,
  dedupeTags,
  jsonError,
  jsonOk,
  normalizeLang,
  normalizeSection,
  normalizeStatus,
  nowIso,
  parseCardRank,
  parseDateOrNull,
  parseIntSafe,
  slugify,
  slugifyTag,
  toExcerpt
} from './validators.js';
import {
  SESSION_COOKIE,
  createSignedValue,
  getAdminSession,
  hashPassword,
  isAdminRequest,
  isAllowedAdmin,
  makeClearCookie,
  makeSetCookie,
  verifyPasswordHash
} from './auth.js';
import {
  cleanupUnusedTag,
  createPool,
  ensureSeedProgramPosts,
  ensureSchema,
  ensureSeedPages,
  getNextPublishedContentCardRank,
  getAppSetting,
  getMediaById,
  getMediaVariants,
  getPostTags,
  getPostTagsMap,
  listDistinctTags,
  listTagCountsBySection,
  mapPostRow,
  normalizeDerivedPostCardFields,
  replacePostTags,
  setAppSetting,
  softDeletePost,
  touchViewCount
} from './db.js';
import {
  buildMediaUrls,
  buildStorageKey,
  detectMediaKind,
  extensionFromMime,
  resolveStoragePath,
  saveBufferToKey,
  variantMimeType,
  writeImageVariants
} from './media.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });
const execFileAsync = promisify(execFile);
const config = getConfig();
const pool = createPool(config);
const publicBaseUrl = config.mediaPublicBaseUrl || config.siteOrigin || '';
const SITEMAP_LANGS = ['en', 'ko'];
const SITEMAP_SECTIONS = ['tools', 'games', 'blog'];
const VIEW_COUNT_EXCLUDED_PAGE_SLUGS = new Set(['about', 'contact', 'privacy-policy']);

function withSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function resolvePublicOrigin(req) {
  if (config.siteOrigin) {
    return String(config.siteOrigin).replace(/\/+$/, '');
  }

  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSitemapDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function trackLatest(map, key, dateValue) {
  if (!dateValue) return;
  const previous = map.get(key);
  if (!previous || previous < dateValue) {
    map.set(key, dateValue);
  }
}

function shouldTrackViewCount(row) {
  return !(
    row.section === 'pages' &&
    VIEW_COUNT_EXCLUDED_PAGE_SLUGS.has(String(row.slug || '').trim().toLowerCase())
  );
}

function hasEmbeddedProgram(section, slug) {
  return (
    (section === 'tools' && slug === 'trend-analyzer') ||
    (section === 'games' && slug === 'texas-holdem-tournament')
  );
}

function renderSitemapXml(entries) {
  const body = entries
    .map((entry) => {
      const lines = ['  <url>', `    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) {
        lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      }
      lines.push('  </url>');
      return lines.join('\n');
    })
    .join('\n');

  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', body, '</urlset>'].join('\n');
}

function requireAdmin(req, res) {
  if (!isAdminRequest(req, config)) {
    jsonError(res, 401, 'Admin authentication required');
    return false;
  }
  return true;
}

function cacheHeadersForList(isAdmin, statusFilter, hasSearch) {
  if (isAdmin || statusFilter === 'all' || statusFilter === 'draft') {
    return { 'Cache-Control': 'no-store' };
  }
  if (hasSearch) {
    return { 'Cache-Control': 'public, max-age=15, s-maxage=60, stale-while-revalidate=120' };
  }
  return { 'Cache-Control': 'public, max-age=45, s-maxage=240, stale-while-revalidate=480' };
}

function normalizeTrendTicker(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, '');
}

function isCsvUpload(file) {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  const originalName = String(file?.originalname || '').toLowerCase();
  return (
    mimeType === 'text/csv' ||
    mimeType === 'application/csv' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/plain' ||
    originalName.endsWith('.csv')
  );
}

async function analyzeTrendCsvUpload(file, ticker) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ga-ml-trend-upload-'));
  const originalName = String(file.originalname || 'upload.csv').replace(/[^a-z0-9._-]/gi, '_');
  const tempCsvPath = path.join(tempDir, originalName.endsWith('.csv') ? originalName : `${originalName}.csv`);

  try {
    await fs.writeFile(tempCsvPath, file.buffer);
    const args = [
      config.trendAnalyzerScript,
      tempCsvPath,
      '--date-column',
      'date',
      '--window-bars',
      '200'
    ];

    if (config.trendAnalyzerBestParamsCsv) {
      args.push('--best-params-csv', config.trendAnalyzerBestParamsCsv);
    } else {
      args.push('--use-default-config');
    }
    if (ticker) {
      args.push('--ticker', ticker);
    }

    const { stdout, stderr } = await execFileAsync(config.trendAnalyzerPythonBin, args, {
      timeout: config.trendAnalyzerTimeoutMs,
      maxBuffer: 4 * 1024 * 1024
    });

    const payload = JSON.parse(String(stdout || '').trim() || '{}');
    if (!payload?.meta || !payload?.current_state || !Array.isArray(payload?.chart_200d?.candles)) {
      const detail = String(stderr || '').trim();
      throw new Error(detail || 'Trend analyzer returned an invalid payload');
    }
    return payload;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function bootstrap() {
  await fs.mkdir(config.mediaRoot, { recursive: true });
  await ensureSchema(pool);
  await ensureSeedPages(pool);
  await ensureSeedProgramPosts(pool);
  await normalizeDerivedPostCardFields(pool);
  const currentHash = await getAppSetting(pool, 'admin_password_hash');
  if (!currentHash && config.adminLoginPassword) {
    await setAppSetting(pool, 'admin_password_hash', hashPassword(config.adminLoginPassword));
  }
}

const app = express();
app.set('trust proxy', true);
app.use((req, res, next) => {
  withSecurityHeaders(res);
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  jsonOk(res, { ok: true, service: 'utility-box-api' });
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const origin = resolvePublicOrigin(req);
    const result = await pool.query(
      `SELECT lang, section, slug, COALESCE(updated_at, published_at, created_at) AS lastmod
       FROM posts
       WHERE is_deleted = FALSE
         AND status = 'published'
       ORDER BY lang ASC, section ASC, COALESCE(updated_at, published_at, created_at) DESC, id DESC`
    );

    const latestByLang = new Map();
    const latestBySection = new Map();
    const postEntries = [];

    for (const row of result.rows) {
      const lang = String(row.lang || '').trim().toLowerCase();
      const section = String(row.section || '').trim().toLowerCase();
      const slug = String(row.slug || '').trim();
      if (!lang || !section || !slug) continue;

      const lastmod = formatSitemapDate(row.lastmod);
      trackLatest(latestByLang, lang, lastmod);
      if (section !== 'pages') {
        trackLatest(latestBySection, `${lang}:${section}`, lastmod);
      }

      postEntries.push({
        loc: `${origin}/${lang}/${section}/${slug}/`,
        lastmod
      });
    }

    const staticEntries = [];
    for (const lang of SITEMAP_LANGS) {
      staticEntries.push({
        loc: `${origin}/${lang}/`,
        lastmod: latestByLang.get(lang) || ''
      });

      for (const section of SITEMAP_SECTIONS) {
        staticEntries.push({
          loc: `${origin}/${lang}/${section}/`,
          lastmod: latestBySection.get(`${lang}:${section}`) || ''
        });
      }
    }

    const entries = [...staticEntries, ...postEntries];
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
    res.send(renderSitemapXml(entries));
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!config.adminLoginUser) {
    return jsonError(res, 500, 'Admin login is not configured');
  }
  if (!username || !password) {
    return jsonError(res, 400, 'username and password are required');
  }
  const storedHash = await getAppSetting(pool, 'admin_password_hash');
  if (!storedHash) {
    return jsonError(res, 500, 'Admin password is not configured');
  }
  if (!isAllowedAdmin(username, config) || !verifyPasswordHash(password, storedHash)) {
    return jsonError(res, 401, 'Invalid username or password');
  }

  const sessionValue = createSignedValue(
    {
      username,
      exp: Date.now() + 1000 * 60 * 60 * 12,
      via: 'local'
    },
    config.adminSessionSecret
  );

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', makeSetCookie(SESSION_COOKIE, sessionValue, 60 * 60 * 12, config));
  return jsonOk(res, {
    ok: true,
    authenticated: true,
    isAdmin: true,
    username
  });
});

app.get('/api/session', (req, res) => {
  const session = getAdminSession(req, config);
  res.setHeader('Cache-Control', 'no-store');
  jsonOk(res, {
    ok: true,
    authenticated: Boolean(session),
    isAdmin: Boolean(session),
    username: session?.username || null
  });
});

app.post('/api/admin/password', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const currentPassword = String(req.body?.currentPassword || '');
  const nextPassword = String(req.body?.newPassword || '');

  if (!currentPassword || !nextPassword) {
    return jsonError(res, 400, 'currentPassword and newPassword are required');
  }
  if (nextPassword.length < 10) {
    return jsonError(res, 400, 'New password must be at least 10 characters');
  }

  const storedHash = await getAppSetting(pool, 'admin_password_hash');
  if (!storedHash) {
    return jsonError(res, 500, 'Admin password is not configured');
  }
  if (!verifyPasswordHash(currentPassword, storedHash)) {
    return jsonError(res, 401, 'Current password is incorrect');
  }

  await setAppSetting(pool, 'admin_password_hash', hashPassword(nextPassword));
  return jsonOk(res, { ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', makeClearCookie(SESSION_COOKIE, config));
  res.setHeader('Cache-Control', 'no-store');
  jsonOk(res, { ok: true });
});

app.get('/api/posts', async (req, res, next) => {
  try {
    const isAdmin = isAdminRequest(req, config);
    const statusRaw = String(req.query.status || '').trim().toLowerCase();
    const statusFilter = isAdmin && statusRaw === 'all' ? 'all' : isAdmin && statusRaw === 'draft' ? 'draft' : 'published';
    const lang = normalizeLang(req.query.lang || 'en');
    const sectionRaw = req.query.section ? normalizeSection(req.query.section) : null;
    const tagFilterRaw = String(req.query.tag || '').trim();
    const tagFilter = tagFilterRaw.toLowerCase();
    const tagFilterSlug = slugifyTag(tagFilterRaw);
    const q = String(req.query.q || '').trim();
    const page = clamp(parseIntSafe(req.query.page, 1) || 1, 1, 10000);
    const limit = clamp(parseIntSafe(req.query.limit, 12) || 12, 1, 50);
    const offset = (page - 1) * limit;

    const binds = [lang];
    const where = ['p.is_deleted = FALSE', `p.lang = $${binds.length}`];

    if (sectionRaw) {
      binds.push(sectionRaw);
      where.push(`p.section = $${binds.length}`);
    }
    if (statusFilter !== 'all') {
      binds.push(statusFilter);
      where.push(`p.status = $${binds.length}`);
    }
    if (q) {
      const pattern = `%${q}%`;
      binds.push(pattern, pattern, pattern);
      const base = binds.length - 2;
      where.push(`(p.title ILIKE $${base} OR p.excerpt ILIKE $${base + 1} OR p.content_md ILIKE $${base + 2})`);
    }
    if (tagFilter) {
      binds.push(tagFilterSlug || tagFilter, tagFilter);
      const base = binds.length - 1;
      where.push(`EXISTS (
        SELECT 1 FROM post_tags fpt
        JOIN tags ft ON ft.id = fpt.tag_id
        WHERE fpt.post_id = p.id
          AND (LOWER(ft.slug) = $${base} OR LOWER(ft.name) = $${base + 1})
      )`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM posts p ${whereSql}`, binds);

    const listBinds = [...binds, limit, offset];
    const rows = await pool.query(
      `SELECT p.* FROM posts p ${whereSql}
       ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC
       LIMIT $${listBinds.length - 1} OFFSET $${listBinds.length}`,
      listBinds
    );

    const tagMap = await getPostTagsMap(pool, rows.rows.map((row) => Number(row.id)));
    const items = rows.rows.map((row) => mapPostRow(row, tagMap.get(Number(row.id)) || [], req, publicBaseUrl));
    Object.entries(cacheHeadersForList(isAdmin, statusFilter, Boolean(q))).forEach(([k, v]) => res.setHeader(k, v));
    jsonOk(res, {
      ok: true,
      items,
      page,
      limit,
      total: Number(countResult.rows[0]?.total || 0)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/posts/:slug', async (req, res, next) => {
  try {
    const isAdmin = isAdminRequest(req, config);
    const slug = slugify(decodeURIComponent(req.params.slug || ''));
    if (!slug) return jsonError(res, 400, 'Invalid slug');
    const lang = normalizeLang(req.query.lang || 'en');
    const sectionRaw = req.query.section ? normalizeSection(req.query.section) : null;
    const binds = [slug, lang];
    const where = ['slug = $1', 'lang = $2', 'is_deleted = FALSE'];
    if (sectionRaw) {
      binds.push(sectionRaw);
      where.push(`section = $${binds.length}`);
    }
    if (!isAdmin) where.push(`status = 'published'`);
    const rows = await pool.query(
      `SELECT * FROM posts WHERE ${where.join(' AND ')} ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 1`,
      binds
    );
    const row = rows.rows[0];
    if (!row) return jsonError(res, 404, 'Post not found');
    const tags = await getPostTags(pool, Number(row.id));
    let updatedViewCount = Number(row.view_count || 0);
    if (!isAdmin && row.status === 'published' && shouldTrackViewCount(row)) {
      const viewCookieName = `ub_post_view_${row.id}`;
      if (!String(req.headers.cookie || '').includes(`${viewCookieName}=1`)) {
        await touchViewCount(pool, Number(row.id));
        updatedViewCount += 1;
        res.append('Set-Cookie', `${viewCookieName}=1; Path=/; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    const post = mapPostRow({ ...row, view_count: updatedViewCount }, tags, req, publicBaseUrl);
    jsonOk(res, { ok: true, post, tags, cover: post.cover, media: [] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const payload = req.body || {};
    const title = String(payload.title || '').trim();
    const content = String(payload.content_md || '').trim();
    const contentBefore = String(payload.content_before_md || '').trim();
    const contentAfter = String(payload.content_after_md || '').trim();
    if (!title) return jsonError(res, 400, 'title is required');
    const lang = normalizeLang(payload.lang || 'en');
    const section = normalizeSection(payload.section || 'blog');
    const slug = slugify(String(payload.slug || title));
    if (!slug) return jsonError(res, 400, 'slug is invalid');
    const embeddedProgram = hasEmbeddedProgram(section, slug);
    if (!embeddedProgram && !content) return jsonError(res, 400, 'content_md is required');
    const status = normalizeStatus(payload.status || 'draft');
    const tags = dedupeTags(payload.tags || []);
    const excerpt = String(payload.excerpt || '').trim() || (content ? toExcerpt(content) : '');
    const publishedAt = status === 'published' ? parseDateOrNull(payload.published_at) || nowIso() : null;
    const pairSlug = payload.pair_slug ? slugify(String(payload.pair_slug)) : null;
    const cardCategory = String(payload.card?.category || section).trim() || section;
    const cardTitle = title;
    const cardTag = tags.join(', ') || null;
    const cardRank = parseCardRank(payload.card?.rank) || (status === 'published' ? await getNextPublishedContentCardRank(pool, lang) : null);
    const cardImageId = parseIntSafe(payload.card?.image_id, null);
    const metaTitle = String(payload.meta?.title || '').trim() || null;
    const metaDescription = String(payload.meta?.description || '').trim() || null;
    const ogTitle = metaTitle || title;
    const ogDescription = metaDescription || excerpt || null;
    const schemaTypeRaw = String(payload.schema_type || '').trim();
    const schemaType = schemaTypeRaw === 'Service' || schemaTypeRaw === 'BlogPosting' ? schemaTypeRaw : null;

    const existing = await pool.query(
      'SELECT id FROM posts WHERE slug = $1 AND lang = $2 AND section = $3 AND is_deleted = FALSE LIMIT 1',
      [slug, lang, section]
    );
    if (existing.rows[0]) return jsonError(res, 409, 'Post with same slug/lang/section already exists');

    const insert = await pool.query(
      `INSERT INTO posts (
        slug, title, excerpt, content_md, content_before_md, content_after_md, status, cover_image_id, published_at,
        lang, section, pair_slug, created_at, updated_at,
        card_title, card_category, card_tag, card_rank, card_image_id,
        meta_title, meta_description, og_title, og_description, og_image_url, schema_type
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      ) RETURNING id`,
      [
        slug, title, excerpt, content, embeddedProgram ? contentBefore || null : null, embeddedProgram ? contentAfter || null : null,
        status, null, publishedAt, lang, section, pairSlug, nowIso(), nowIso(),
        cardTitle, cardCategory, cardTag, cardRank, cardImageId, metaTitle, metaDescription,
        ogTitle, ogDescription, null, schemaType
      ]
    );
    const postId = Number(insert.rows[0].id);
    if (tags.length) await replacePostTags(pool, postId, tags);
    jsonOk(res, { ok: true, id: postId, slug });
  } catch (error) {
    next(error);
  }
});

app.put('/api/posts/:id', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const postId = parseIntSafe(req.params.id);
    if (!postId) return jsonError(res, 400, 'Invalid post id');
    const currentResult = await pool.query('SELECT * FROM posts WHERE id = $1 AND is_deleted = FALSE LIMIT 1', [postId]);
    const current = currentResult.rows[0];
    if (!current) return jsonError(res, 404, 'Post not found');

    const payload = req.body || {};
    const title = payload.title !== undefined ? String(payload.title || '').trim() : current.title;
    const content = payload.content_md !== undefined ? String(payload.content_md || '').trim() : current.content_md;
    if (!title) return jsonError(res, 400, 'title is required');
    const lang = payload.lang !== undefined ? normalizeLang(payload.lang) : current.lang;
    const section = payload.section !== undefined ? normalizeSection(payload.section) : current.section;
    const slug = payload.slug !== undefined ? slugify(String(payload.slug || title)) : current.slug;
    if (!slug) return jsonError(res, 400, 'slug is invalid');
    const embeddedProgram = hasEmbeddedProgram(section, slug);
    if (!embeddedProgram && !content) return jsonError(res, 400, 'content_md is required');
    const contentBefore = embeddedProgram
      ? (payload.content_before_md !== undefined ? String(payload.content_before_md || '').trim() : current.content_before_md || '')
      : '';
    const contentAfter = embeddedProgram
      ? (payload.content_after_md !== undefined ? String(payload.content_after_md || '').trim() : current.content_after_md || '')
      : '';
    const status = payload.status !== undefined ? normalizeStatus(payload.status) : current.status;
    const tags = payload.tags !== undefined ? dedupeTags(payload.tags || []) : await getPostTags(pool, postId);
    const excerpt = payload.excerpt !== undefined
      ? String(payload.excerpt || '').trim() || (content ? toExcerpt(content) : '')
      : current.excerpt;
    const publishedAt = payload.published_at !== undefined
      ? parseDateOrNull(payload.published_at)
      : status === 'published'
        ? (current.published_at ? new Date(current.published_at).toISOString() : nowIso())
        : null;
    const pairSlug = payload.pair_slug !== undefined ? (payload.pair_slug ? slugify(String(payload.pair_slug)) : null) : current.pair_slug;
    const cardCategory = payload.card?.category !== undefined ? String(payload.card.category || '').trim() || section : current.card_category || section;
    const cardTitle = title;
    const cardTag = tags.join(', ') || null;
    const cardRank = payload.card?.rank !== undefined ? parseCardRank(payload.card.rank) : current.card_rank;
    const cardImageId = payload.card?.image_id !== undefined ? parseIntSafe(payload.card.image_id, null) : current.card_image_id;
    const metaTitle = payload.meta?.title !== undefined ? String(payload.meta.title || '').trim() || null : current.meta_title;
    const metaDescription = payload.meta?.description !== undefined ? String(payload.meta.description || '').trim() || null : current.meta_description;
    const ogTitle = metaTitle || title;
    const ogDescription = metaDescription || excerpt || null;
    const schemaTypeRaw = payload.schema_type !== undefined ? String(payload.schema_type || '').trim() : current.schema_type || '';
    const schemaType = schemaTypeRaw === 'Service' || schemaTypeRaw === 'BlogPosting' ? schemaTypeRaw : null;

    const existing = await pool.query(
      'SELECT id FROM posts WHERE slug = $1 AND lang = $2 AND section = $3 AND is_deleted = FALSE AND id != $4 LIMIT 1',
      [slug, lang, section, postId]
    );
    if (existing.rows[0]) return jsonError(res, 409, 'Another post with same slug/lang/section exists');

    await pool.query(
      `UPDATE posts SET
         slug=$1, title=$2, excerpt=$3, content_md=$4, content_before_md=$5, content_after_md=$6, status=$7, cover_image_id=$8,
         published_at=$9, lang=$10, section=$11, pair_slug=$12, updated_at=$13,
         card_title=$14, card_category=$15, card_tag=$16, card_rank=$17, card_image_id=$18,
         meta_title=$19, meta_description=$20, og_title=$21, og_description=$22, og_image_url=$23, schema_type=$24
       WHERE id = $25`,
      [
        slug, title, excerpt, content, embeddedProgram ? contentBefore || null : null, embeddedProgram ? contentAfter || null : null,
        status, current.cover_image_id, publishedAt, lang, section, pairSlug, nowIso(),
        cardTitle, cardCategory, cardTag, cardRank, cardImageId,
        metaTitle, metaDescription, ogTitle, ogDescription, null, schemaType, postId
      ]
    );
    if (payload.tags !== undefined) {
      await replacePostTags(pool, postId, tags);
    }
    jsonOk(res, { ok: true, id: postId, slug, section, lang, updated_at: nowIso() });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/posts/:id', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const postId = parseIntSafe(req.params.id);
    if (!postId) return jsonError(res, 400, 'Invalid post id');
    const result = await softDeletePost(pool, postId);
    if (!result.rowCount) return jsonError(res, 404, 'Post not found');
    jsonOk(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/tags', async (req, res, next) => {
  try {
    const lang = normalizeLang(req.query.lang || 'en');
    const section = req.query.section ? normalizeSection(req.query.section) : undefined;
    const includeCounts = String(req.query.counts || '').trim() === '1';
    const isAdmin = isAdminRequest(req, config);
    const publishedOnly = !isAdmin;

    if (includeCounts && section) {
      const items = await listTagCountsBySection(pool, { lang, section, publishedOnly });
      if (publishedOnly) res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=900, stale-while-revalidate=1800');
      else res.setHeader('Cache-Control', 'no-store');
      return jsonOk(res, { ok: true, items });
    }

    const items = await listDistinctTags(pool, { lang, publishedOnly });
    if (publishedOnly) res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=900, stale-while-revalidate=1800');
    else res.setHeader('Cache-Control', 'no-store');
    jsonOk(res, { ok: true, items });
  } catch (error) {
    next(error);
  }
});

app.post('/api/tools/trend-analyzer/analyze', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return jsonError(res, 400, 'file is required');
    if (!isCsvUpload(file)) return jsonError(res, 415, 'Only CSV uploads are supported');

    const ticker = normalizeTrendTicker(req.body?.ticker);
    const payload = await analyzeTrendCsvUpload(file, ticker || undefined);
    res.setHeader('Cache-Control', 'no-store');
    jsonOk(res, { ok: true, payload });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/tags/:tag', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const targetSlug = slugify(decodeURIComponent(req.params.tag || ''));
    if (!targetSlug) return jsonError(res, 400, 'Invalid tag');
    const lang = normalizeLang(req.query.lang || 'en');
    const tagResult = await pool.query('SELECT id, name, slug FROM tags WHERE slug = $1 LIMIT 1', [targetSlug]);
    const tag = tagResult.rows[0];
    if (!tag) return jsonError(res, 404, 'Tag not found');
    await pool.query(
      `DELETE FROM post_tags
       WHERE tag_id = $1
         AND post_id IN (SELECT id FROM posts WHERE lang = $2 AND is_deleted = FALSE)`,
      [tag.id, lang]
    );
    await cleanupUnusedTag(pool, Number(tag.id));
    jsonOk(res, { ok: true, deleted: { id: Number(tag.id), name: tag.name, slug: tag.slug } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const file = req.file;
    const altRaw = String(req.body.alt || '').trim();
    if (!file) return jsonError(res, 400, 'file is required');
    const mimeType = file.mimetype || 'application/octet-stream';
    const allowed = [/^image\//i, /^video\//i, /^application\/pdf$/i].some((pattern) => pattern.test(mimeType));
    if (!allowed) return jsonError(res, 415, 'Unsupported file type');
    if (/^image\//i.test(mimeType) && !altRaw) return jsonError(res, 400, 'alt is required for image uploads');

    const kind = detectMediaKind(mimeType);
    const originalKey = buildStorageKey(mimeType);
    const originalPath = await saveBufferToKey(config, originalKey, file.buffer);
    let width = null;
    let height = null;
    let variants = [];
    if (kind === 'image') {
      const parsed = path.parse(originalKey);
      const keyBaseNoExt = path.posix.join(parsed.dir, parsed.name);
      const variantResult = await writeImageVariants(config, keyBaseNoExt, file.buffer);
      width = variantResult.width;
      height = variantResult.height;
      variants = variantResult.variants;
    }

    const mediaInsert = await pool.query(
      `INSERT INTO media (r2_key, kind, width, height, alt, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [originalKey, kind, width, height, altRaw || file.originalname || null, mimeType, file.size]
    );
    const mediaId = Number(mediaInsert.rows[0].id);

    for (const variant of variants) {
      await pool.query(
        `INSERT INTO media_variants (media_id, variant, r2_key, width, height, format)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [mediaId, variant.variant, variant.key, variant.width, variant.height, variant.format]
      );
    }

    const urls = buildMediaUrls({
      request: req,
      mediaId,
      variantNames: variants.map((item) => item.variant),
      publicBaseUrl
    });
    jsonOk(res, {
      ok: true,
      mediaId,
      keys: {
        original: originalKey,
        ...Object.fromEntries(variants.map((item) => [item.variant, item.key]))
      },
      urls,
      variants: variants.map((item) => ({ variant: item.variant, key: item.key, width: item.width, format: item.format }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/media/:id', async (req, res, next) => {
  try {
    const mediaId = parseIntSafe(req.params.id);
    if (!mediaId) return jsonError(res, 400, 'Invalid media id');
    const media = await getMediaById(pool, mediaId);
    if (!media) return jsonError(res, 404, 'Media not found');
    const variants = await getMediaVariants(pool, mediaId);
    const urls = buildMediaUrls({
      request: req,
      mediaId,
      variantNames: variants.map((variant) => variant.variant),
      publicBaseUrl
    });
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
    jsonOk(res, { ok: true, media, variants, urls });
  } catch (error) {
    next(error);
  }
});

app.get('/api/media/:id/file', async (req, res, next) => {
  try {
    const mediaId = parseIntSafe(req.params.id);
    if (!mediaId) return jsonError(res, 400, 'Invalid media id');
    const media = await getMediaById(pool, mediaId);
    if (!media) return jsonError(res, 404, 'Media not found');
    const requestedVariant = String(req.query.variant || '').trim();
    let key = media.r2_key;
    let mimeType = media.mime_type || 'application/octet-stream';
    if (requestedVariant) {
      const variants = await getMediaVariants(pool, mediaId);
      const found = variants.find((variant) => variant.variant === requestedVariant);
      if (found?.r2_key) {
        key = found.r2_key;
        mimeType = variantMimeType(found.format, mimeType);
      }
    }
    const filePath = resolveStoragePath(config, key);
    const buffer = await fs.readFile(filePath).catch(() => null);
    if (!buffer) return jsonError(res, 404, 'Media object not found');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return jsonError(res, 413, 'File size exceeds 10MB limit');
  }
  console.error('[utility-box-api]', err);
  jsonError(res, 500, message);
});

await bootstrap();
app.listen(config.port, () => {
  console.log(`[utility-box-api] listening on :${config.port}`);
});
