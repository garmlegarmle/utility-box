import { getPostById } from '../../../_lib/posts.js';
import { getAdminSession, jsonResponse } from '../../../_lib/session.js';

export async function onRequestGet(context) {
  try {
    const postId = context.params.post_id;
    if (!postId) {
      return jsonResponse({ ok: false, error: 'post_id is required' }, 400);
    }

    const session = await getAdminSession(context.request, context.env);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const postFile = await getPostById(session.token, context.env, postId);
    if (!postFile.exists || !postFile.data) {
      return jsonResponse({ ok: false, error: 'Post not found' }, 404);
    }

    const poll = postFile.data.poll;
    if (!poll) {
      return jsonResponse({ ok: false, error: 'Poll is not configured for this post' }, 404);
    }

    const optionMap = new Map((poll.options || []).map((item) => [item.id, item.text]));
    const voters = (poll.voters || []).map((item) => ({
      visitorId: item.visitorId,
      optionId: item.optionId,
      optionText: optionMap.get(item.optionId) || null,
      votedAt: item.votedAt
    }));

    return jsonResponse({
      ok: true,
      question: poll.question,
      voters
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch voters' }, 500);
  }
}
