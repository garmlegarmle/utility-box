import { applyVote, getPollResults, getPostById, getServiceToken, savePostById } from '../../../_lib/posts.js';
import { getAdminSession, jsonResponse } from '../../../_lib/session.js';

async function getOptionId(request) {
  const contentType = String(request.headers.get('content-type') || '');

  if (contentType.includes('application/json')) {
    const payload = await request.json().catch(() => ({}));
    return String(payload?.optionId || payload?.option_id || '').trim();
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData().catch(() => null);
    if (!formData) return '';
    return String(formData.get('optionId') || formData.get('option_id') || '').trim();
  }

  return '';
}

async function resolveWriteToken(context) {
  const serviceToken = getServiceToken(context.env);
  if (serviceToken) return serviceToken;

  const session = await getAdminSession(context.request, context.env);
  return session?.token || '';
}

export async function onRequestPost(context) {
  try {
    const postId = context.params.post_id;
    if (!postId) {
      return jsonResponse({ ok: false, error: 'post_id is required' }, 400);
    }

    const optionId = await getOptionId(context.request);
    if (!optionId) {
      return jsonResponse({ ok: false, error: 'optionId is required' }, 400);
    }

    const token = await resolveWriteToken(context);
    if (!token) {
      return jsonResponse(
        { ok: false, error: 'Missing write token. Set POSTS_REPO_TOKEN for visitor voting.' },
        503
      );
    }

    const postFile = await getPostById(token, context.env, postId);
    if (!postFile.exists || !postFile.data) {
      return jsonResponse({ ok: false, error: 'Post not found' }, 404);
    }

    const result = applyVote(postFile.data, postId, optionId, context.request);
    await savePostById(token, context.env, postId, result.post, postFile.sha, `Vote on post: ${postId}`);

    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    headers.append('Set-Cookie', result.voteCookie);
    if (result.visitorCookie) {
      headers.append('Set-Cookie', result.visitorCookie);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        poll: getPollResults(result.post)
      }),
      {
        status: 200,
        headers
      }
    );
  } catch (error) {
    const isDuplicate = /already voted/i.test(String(error?.message || ''));
    const status = isDuplicate ? 409 : 500;
    return jsonResponse({ ok: false, error: error.message || 'Failed to vote' }, status);
  }
}
