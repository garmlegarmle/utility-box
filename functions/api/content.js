import { getRepoFile, parseRepo, upsertRepoFile } from '../_lib/github.js';
import { getAdminSession, jsonResponse } from '../_lib/session.js';

function isAllowedPath(path) {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('src/content/')) return false;
  if (path.includes('..')) return false;
  return /\.(md|mdx)$/i.test(path);
}

function normalizePath(value) {
  return String(value || '').trim().replace(/^\/+/, '');
}

export async function onRequestGet(context) {
  try {
    const session = await getAdminSession(context.request, context.env);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const url = new URL(context.request.url);
    const path = normalizePath(url.searchParams.get('path'));

    if (!isAllowedPath(path)) {
      return jsonResponse({ ok: false, error: 'Invalid path' }, 400);
    }

    const { owner, repo, branch } = parseRepo(context.env);
    const file = await getRepoFile(session.token, owner, repo, branch, path);

    if (!file) {
      return jsonResponse({ ok: false, error: 'File not found' }, 404);
    }

    return jsonResponse({
      ok: true,
      path,
      sha: file.sha,
      content: file.content
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to read file' }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const session = await getAdminSession(context.request, context.env);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const payload = await context.request.json().catch(() => null);
    const path = normalizePath(payload?.path);
    const content = typeof payload?.content === 'string' ? payload.content : '';
    const message = String(payload?.message || `Update ${path}`).trim();

    if (!isAllowedPath(path)) {
      return jsonResponse({ ok: false, error: 'Invalid path' }, 400);
    }

    if (!message) {
      return jsonResponse({ ok: false, error: 'Commit message is required' }, 400);
    }

    const { owner, repo, branch } = parseRepo(context.env);
    const current = await getRepoFile(session.token, owner, repo, branch, path);

    const result = await upsertRepoFile(
      session.token,
      owner,
      repo,
      branch,
      path,
      content,
      message,
      current?.sha
    );

    return jsonResponse({
      ok: true,
      commit: result?.commit?.sha || null,
      htmlUrl: result?.content?.html_url || null
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to save file' }, 500);
  }
}
