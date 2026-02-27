import { getRepoDirectoryEntries, getRepoFileBytes, parseRepo } from '../../../_lib/github.js';
import { findPostImage, getPostById, getServiceToken } from '../../../_lib/posts.js';
import { getAdminSession, jsonResponse } from '../../../_lib/session.js';

async function resolveReadToken(context) {
  const serviceToken = getServiceToken(context.env);
  if (serviceToken) return serviceToken;

  const session = await getAdminSession(context.request, context.env);
  return session?.token || '';
}

export async function onRequestGet(context) {
  try {
    const postId = context.params.post_id;
    const imageId = context.params.image_id;

    if (!postId || !imageId) {
      return jsonResponse({ ok: false, error: 'post_id and image_id are required' }, 400);
    }

    const token = await resolveReadToken(context);
    const postFile = await getPostById(token, context.env, postId);
    if (!postFile.exists || !postFile.data) {
      return jsonResponse({ ok: false, error: 'Post not found' }, 404);
    }

    const image = findPostImage(postFile.data, imageId);
    const { owner, repo, branch } = parseRepo(context.env);
    let filePath = image?.path || '';
    let mimeType = image?.mimeType || 'application/octet-stream';

    if (!filePath) {
      const entries = await getRepoDirectoryEntries(token, owner, repo, branch, `public/uploads/posts/images/${postId}`);
      const match = entries.find((entry) => {
        return entry?.type === 'file' && String(entry.name || '').startsWith(`${imageId}-`);
      });
      if (!match?.path) {
        return jsonResponse({ ok: false, error: 'Image not found' }, 404);
      }
      filePath = String(match.path);
      const name = String(match.name || '').toLowerCase();
      if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mimeType = 'image/jpeg';
      if (name.endsWith('.png')) mimeType = 'image/png';
      if (name.endsWith('.webp')) mimeType = 'image/webp';
      if (name.endsWith('.gif')) mimeType = 'image/gif';
      if (name.endsWith('.avif')) mimeType = 'image/avif';
    }

    if (!filePath) {
      return jsonResponse({ ok: false, error: 'Image not found' }, 404);
    }

    const rawFile = await getRepoFileBytes(token, owner, repo, branch, filePath);
    if (!rawFile?.bytes || rawFile.bytes.byteLength === 0) {
      return jsonResponse({ ok: false, error: 'Image file not found' }, 404);
    }

    const bytes = rawFile.bytes;
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mimeType || rawFile.contentType || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch image' }, 500);
  }
}
