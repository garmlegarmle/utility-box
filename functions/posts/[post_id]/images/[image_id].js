import { base64ToUint8Array, getRepoFileRaw, parseRepo } from '../../../_lib/github.js';
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
    if (!image) {
      return jsonResponse({ ok: false, error: 'Image not found' }, 404);
    }

    const { owner, repo, branch } = parseRepo(context.env);
    const rawFile = await getRepoFileRaw(token, owner, repo, branch, image.path);
    if (!rawFile?.contentBase64) {
      return jsonResponse({ ok: false, error: 'Image file not found' }, 404);
    }

    const bytes = base64ToUint8Array(rawFile.contentBase64);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': image.mimeType || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch image' }, 500);
  }
}
