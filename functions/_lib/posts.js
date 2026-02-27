import {
  arrayBufferToBase64,
  deleteRepoFile,
  getRepoFile,
  getRepoFileRaw,
  parseRepo,
  upsertRepoBinaryFile,
  upsertRepoFile
} from './github.js';
import { parseCookie } from './session.js';

const MAX_IMAGES = 6;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);

const VIEW_COOKIE = 'ub_post_views';
const VOTE_COOKIE = 'ub_post_votes';
const VISITOR_COOKIE = 'ub_visitor_id';

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getStorageConfig(env) {
  return {
    indexPath: env.POSTS_INDEX_PATH || 'data/posts/index.json',
    postsDir: env.POSTS_ITEMS_DIR || 'data/posts/items',
    assetsDir: env.POSTS_ASSETS_META_DIR || 'data/posts/assets',
    publicAssetsDir: env.POSTS_PUBLIC_ASSETS_DIR || 'public/uploads/posts/assets',
    publicImagesDir: env.POSTS_PUBLIC_IMAGES_DIR || 'public/uploads/posts/images'
  };
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix = '') {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
  const stamp = Date.now().toString(36);
  return `${prefix}${stamp}${hex}`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeFileName(fileName) {
  return String(fileName || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extFromMime(mimeType, fileName) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif'
  };

  if (map[mimeType]) return map[mimeType];
  const fromName = String(fileName || '').split('.').pop();
  return fromName ? fromName.toLowerCase() : 'bin';
}

function requireText(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function makeSummary(post) {
  return {
    id: post.id,
    title: post.title,
    category: post.category,
    tag: post.tag,
    views: Number(post.views || 0),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    imageCount: Array.isArray(post.images) ? post.images.length : 0
  };
}

function sortSummary(posts) {
  return [...posts].sort((a, b) => {
    const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return right - left;
  });
}

export function getServiceToken(env) {
  return env.POSTS_REPO_TOKEN || env.GITHUB_REPO_TOKEN || '';
}

export function buildCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readJsonCookie(request, cookieName, fallback) {
  const raw = parseCookie(request, cookieName);
  if (!raw) return fallback;
  return safeJsonParse(raw, fallback);
}

export function getViewedPostIds(request) {
  const value = readJsonCookie(request, VIEW_COOKIE, []);
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').slice(0, 300);
}

export function makeViewedPostCookie(postIds) {
  const deduped = [...new Set(postIds)].slice(-300);
  return buildCookie(VIEW_COOKIE, JSON.stringify(deduped), 60 * 60 * 24 * 365);
}

export function getVoteMap(request) {
  const value = readJsonCookie(request, VOTE_COOKIE, {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

export function makeVoteMapCookie(voteMap) {
  return buildCookie(VOTE_COOKIE, JSON.stringify(voteMap), 60 * 60 * 24 * 365);
}

export function getVisitorId(request) {
  const existing = parseCookie(request, VISITOR_COOKIE);
  if (existing) return { visitorId: existing, setCookie: null };

  const newId = randomId('v_');
  return {
    visitorId: newId,
    setCookie: buildCookie(VISITOR_COOKIE, newId, 60 * 60 * 24 * 365)
  };
}

async function readJsonFile(token, env, path, fallback) {
  const { owner, repo, branch } = parseRepo(env);
  const file = await getRepoFile(token, owner, repo, branch, path);

  if (!file) {
    return {
      data: fallback,
      sha: null,
      exists: false
    };
  }

  return {
    data: safeJsonParse(file.content, fallback),
    sha: file.sha,
    exists: true
  };
}

async function writeJsonFile(token, env, path, data, message, sha) {
  const { owner, repo, branch } = parseRepo(env);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  return upsertRepoFile(token, owner, repo, branch, path, content, message, sha);
}

async function removeFile(token, env, path, message) {
  const { owner, repo, branch } = parseRepo(env);
  const existing = await getRepoFileRaw(token, owner, repo, branch, path);
  if (!existing) return false;
  await deleteRepoFile(token, owner, repo, branch, path, message, existing.sha);
  return true;
}

export async function getPostsIndex(token, env) {
  const { indexPath } = getStorageConfig(env);
  const { data, sha } = await readJsonFile(token, env, indexPath, { posts: [] });
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  return {
    sha,
    data: {
      posts: sortSummary(posts)
    },
    path: indexPath
  };
}

export async function savePostsIndex(token, env, indexPayload, sha, message) {
  const { indexPath } = getStorageConfig(env);
  return writeJsonFile(token, env, indexPath, indexPayload, message, sha);
}

export async function getPostById(token, env, postId) {
  const { postsDir } = getStorageConfig(env);
  const path = `${postsDir}/${postId}.json`;
  const { data, sha, exists } = await readJsonFile(token, env, path, null);
  return {
    path,
    sha,
    exists,
    data
  };
}

export async function savePostById(token, env, postId, postPayload, sha, message) {
  const { postsDir } = getStorageConfig(env);
  const path = `${postsDir}/${postId}.json`;
  return writeJsonFile(token, env, path, postPayload, message, sha);
}

export async function deletePostById(token, env, postId, message) {
  const { postsDir } = getStorageConfig(env);
  const path = `${postsDir}/${postId}.json`;
  return removeFile(token, env, path, message);
}

function validateImageFile(file) {
  if (!file) {
    throw new Error('Image file is required');
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || 'unknown'}`);
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image file is too large: ${file.name || 'image'}`);
  }
}

export function normalizeImageFiles(value) {
  const files = Array.isArray(value) ? value : [];
  const valid = files.filter((file) => file && typeof file.arrayBuffer === 'function' && file.size > 0);

  if (valid.length > MAX_IMAGES) {
    throw new Error(`Maximum ${MAX_IMAGES} images are allowed`);
  }

  valid.forEach(validateImageFile);
  return valid;
}

async function uploadBinaryFile(token, env, destinationPath, file, message) {
  const { owner, repo, branch } = parseRepo(env);
  const buffer = await file.arrayBuffer();
  const contentBase64 = arrayBufferToBase64(buffer);
  await upsertRepoBinaryFile(token, owner, repo, branch, destinationPath, contentBase64, message);
}

export async function uploadEditorAsset(token, env, file, author) {
  validateImageFile(file);

  const { assetsDir, publicAssetsDir } = getStorageConfig(env);
  const assetId = randomId('asset_');
  const ext = extFromMime(file.type, file.name);
  const safeName = sanitizeFileName(file.name || `${assetId}.${ext}`);
  const filePath = `${publicAssetsDir}/${assetId}-${safeName}`;
  const metaPath = `${assetsDir}/${assetId}.json`;

  await uploadBinaryFile(token, env, filePath, file, `Upload post asset: ${assetId}`);

  const payload = {
    id: assetId,
    name: safeName,
    mimeType: file.type,
    size: file.size,
    path: filePath,
    url: `/${filePath.replace(/^public\//, '')}`,
    createdAt: nowIso(),
    createdBy: author || null
  };

  await writeJsonFile(token, env, metaPath, payload, `Save post asset meta: ${assetId}`, null);

  return payload;
}

export async function getEditorAsset(token, env, assetId) {
  const { assetsDir } = getStorageConfig(env);
  const metaPath = `${assetsDir}/${assetId}.json`;
  const { data, exists } = await readJsonFile(token, env, metaPath, null);
  if (!exists || !data) return null;
  return data;
}

function normalizePollQuestion(value) {
  return String(value || '').trim();
}

function normalizePollOptions(value) {
  const asArray = Array.isArray(value) ? value : [value];
  const flattened = asArray
    .flatMap((entry) => String(entry || '').split('\n'))
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();

  for (const option of flattened) {
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }

  return deduped.slice(0, 8);
}

export function buildPollPayload(questionValue, optionsValue) {
  const question = normalizePollQuestion(questionValue);
  const options = normalizePollOptions(optionsValue);

  if (!question && options.length === 0) return null;
  if (!question) {
    throw new Error('poll question is required when poll options are provided');
  }
  if (options.length < 2) {
    throw new Error('poll options must have at least 2 items');
  }

  return {
    question,
    options: options.map((text) => ({
      id: randomId('opt_'),
      text,
      votes: 0
    })),
    voters: []
  };
}

export async function savePostAndIndex(token, env, postId, postPayload, postSha, index, indexSha, actionText) {
  await savePostById(token, env, postId, postPayload, postSha, `${actionText}: ${postId}`);

  const summary = makeSummary(postPayload);
  const current = Array.isArray(index?.posts) ? index.posts : [];
  const withoutCurrent = current.filter((item) => item.id !== postId);
  const nextIndex = {
    posts: sortSummary([summary, ...withoutCurrent])
  };

  await savePostsIndex(token, env, nextIndex, indexSha, `${actionText} index: ${postId}`);

  return nextIndex;
}

export async function uploadPostImages(token, env, postId, files) {
  const { publicImagesDir } = getStorageConfig(env);
  const normalized = normalizeImageFiles(files);

  const images = [];
  for (const file of normalized) {
    const imageId = randomId('img_');
    const ext = extFromMime(file.type, file.name);
    const safeName = sanitizeFileName(file.name || `${imageId}.${ext}`);
    const filePath = `${publicImagesDir}/${postId}/${imageId}-${safeName}`;
    await uploadBinaryFile(token, env, filePath, file, `Upload post image: ${postId}/${imageId}`);

    images.push({
      id: imageId,
      name: safeName,
      mimeType: file.type,
      size: file.size,
      path: filePath,
      url: `/${filePath.replace(/^public\//, '')}`
    });
  }

  return images;
}

export async function deleteImageFiles(token, env, images, messagePrefix) {
  const list = Array.isArray(images) ? images : [];
  for (const image of list) {
    if (!image?.path) continue;
    try {
      await removeFile(token, env, image.path, `${messagePrefix}: ${image.id || 'image'}`);
    } catch {
      // Best effort cleanup; do not fail the whole request for non-critical delete.
    }
  }
}

export function createPostPayload(input) {
  const title = requireText(input.title, 'title');
  const category = requireText(input.category, 'Category');
  const tag = requireText(input.tag, 'tag');
  const body = requireText(input.body, 'body');
  const createdAt = nowIso();
  const updatedAt = createdAt;
  const id = input.id || `${slugify(title) || 'post'}-${randomId('p_')}`;

  return {
    id,
    title,
    category,
    tag,
    body,
    images: Array.isArray(input.images) ? input.images : [],
    poll: input.poll || null,
    views: Number(input.views || 0),
    createdAt,
    updatedAt,
    createdBy: input.author || null,
    updatedBy: input.author || null
  };
}

export function patchPostPayload(existing, patch) {
  const title = requireText(patch.title ?? existing.title, 'title');
  const category = requireText(patch.category ?? existing.category, 'Category');
  const tag = requireText(patch.tag ?? existing.tag, 'tag');
  const body = requireText(patch.body ?? existing.body, 'body');

  return {
    ...existing,
    title,
    category,
    tag,
    body,
    images: Array.isArray(patch.images) ? patch.images : existing.images || [],
    poll: patch.poll === undefined ? existing.poll || null : patch.poll,
    updatedAt: nowIso(),
    updatedBy: patch.author || existing.updatedBy || null
  };
}

export function findPostImage(post, imageId) {
  const images = Array.isArray(post?.images) ? post.images : [];
  return images.find((item) => item.id === imageId) || null;
}

export function applyUniqueView(post, postId, request) {
  const viewedIds = getViewedPostIds(request);
  if (viewedIds.includes(postId)) {
    return {
      post,
      incremented: false,
      cookie: null
    };
  }

  const nextPost = {
    ...post,
    views: Number(post.views || 0) + 1
  };

  const nextViewedIds = [...viewedIds, postId];
  return {
    post: nextPost,
    incremented: true,
    cookie: makeViewedPostCookie(nextViewedIds)
  };
}

export function applyVote(post, postId, optionId, request) {
  const poll = post?.poll;
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) {
    throw new Error('Poll is not configured for this post');
  }

  const voteMap = getVoteMap(request);
  if (voteMap[postId]) {
    throw new Error('You already voted on this post');
  }

  const optionIndex = poll.options.findIndex((item) => item.id === optionId);
  if (optionIndex < 0) {
    throw new Error('Invalid poll option');
  }

  const { visitorId, setCookie: visitorCookie } = getVisitorId(request);
  const votedAt = nowIso();

  const nextOptions = poll.options.map((item, index) =>
    index === optionIndex ? { ...item, votes: Number(item.votes || 0) + 1 } : item
  );

  const nextVoters = Array.isArray(poll.voters) ? [...poll.voters] : [];
  nextVoters.push({
    visitorId,
    optionId,
    votedAt
  });

  const nextPost = {
    ...post,
    poll: {
      ...poll,
      options: nextOptions,
      voters: nextVoters
    },
    updatedAt: nowIso()
  };

  const nextVoteMap = {
    ...voteMap,
    [postId]: optionId
  };

  return {
    post: nextPost,
    voteCookie: makeVoteMapCookie(nextVoteMap),
    visitorCookie
  };
}

export function getPollResults(post) {
  const poll = post?.poll;
  if (!poll) return null;

  const totalVotes = (poll.options || []).reduce((sum, item) => sum + Number(item.votes || 0), 0);
  const options = (poll.options || []).map((item) => {
    const votes = Number(item.votes || 0);
    const rate = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
    return {
      ...item,
      votes,
      rate
    };
  });

  return {
    question: poll.question || '',
    totalVotes,
    options
  };
}

