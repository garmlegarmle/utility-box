import {
  applyUniqueView,
  deleteImageFiles,
  deletePostById,
  getPollResults,
  getPostById,
  getPostsIndex,
  savePostsIndex,
  getServiceToken,
  patchPostPayload,
  savePostAndIndex,
  uploadPostImages
} from '../_lib/posts.js';
import { getAdminSession, jsonResponse } from '../_lib/session.js';

function getFormString(formData, key) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function parseTags(formData, fallback = []) {
  const multi = formData
    .getAll('tags')
    .flatMap((value) => (typeof value === 'string' ? [value] : []))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  if (multi.length > 0) return multi;

  const single = getFormString(formData, 'tag');
  if (single) return single.split(',').map((value) => value.trim()).filter(Boolean);

  return fallback;
}

function parseKeepImageIds(formData) {
  const values = formData
    .getAll('keepImageIds')
    .flatMap((item) => (typeof item === 'string' ? [item] : []))
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(values)];
}

function parsePollPayload(formData, fallbackPoll) {
  const hasPollQuestion = formData.has('pollQuestion');
  const hasPollOptions = formData.has('pollOptions');
  if (!hasPollQuestion && !hasPollOptions) {
    return undefined;
  }

  const question = getFormString(formData, 'pollQuestion').trim();
  const optionsRaw = formData
    .getAll('pollOptions')
    .flatMap((item) => (typeof item === 'string' ? [item] : []))
    .flatMap((item) => item.split('\n'))
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();
  for (const option of optionsRaw) {
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }

  if (!question && deduped.length === 0) {
    return null;
  }

  if (!question) {
    throw new Error('poll question is required when poll options are provided');
  }

  if (deduped.length < 2) {
    throw new Error('poll options must have at least 2 items');
  }

  const existingOptions = Array.isArray(fallbackPoll?.options) ? fallbackPoll.options : [];
  const optionMap = new Map(existingOptions.map((item) => [String(item.text || '').toLowerCase(), item]));

  return {
    question,
    options: deduped.slice(0, 8).map((text, index) => {
      const reused = optionMap.get(text.toLowerCase());
      return reused || { id: `opt_${Date.now().toString(36)}_${index + 1}`, text, votes: 0 };
    }),
    voters: Array.isArray(fallbackPoll?.voters)
      ? fallbackPoll.voters.filter((voter) =>
          deduped.some((text) => String(optionMap.get(text.toLowerCase())?.id || '').trim() === voter.optionId)
        )
      : []
  };
}

async function resolveReadToken(context) {
  const serviceToken = getServiceToken(context.env);
  if (serviceToken) return serviceToken;

  const session = await getAdminSession(context.request, context.env);
  return session?.token || '';
}

export async function onRequestGet(context) {
  try {
    const postId = context.params.id;
    if (!postId) {
      return jsonResponse({ ok: false, error: 'Post id is required' }, 400);
    }

    const token = await resolveReadToken(context);
    const postFile = await getPostById(token, context.env, postId);
    if (!postFile.exists || !postFile.data) {
      return jsonResponse({ ok: false, error: 'Post not found' }, 404);
    }

    const viewResult = applyUniqueView(postFile.data, postId, context.request);
    let post = postFile.data;
    let viewCookie = null;

    if (viewResult.incremented) {
      const writeToken = getServiceToken(context.env);
      if (writeToken) {
        post = viewResult.post;
        const index = await getPostsIndex(writeToken, context.env);
        await savePostAndIndex(
          writeToken,
          context.env,
          postId,
          post,
          postFile.sha,
          index.data,
          index.sha,
          'Increment post view'
        );
        viewCookie = viewResult.cookie;
      }
    }

    const payload = {
      ok: true,
      post: {
        ...post,
        pollResults: getPollResults(post)
      }
    };

    if (!viewCookie) {
      return jsonResponse(payload);
    }

    return jsonResponse(payload, 200, { 'Set-Cookie': viewCookie });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch post' }, 500);
  }
}

export async function onRequestPut(context) {
  try {
    const postId = context.params.id;
    if (!postId) {
      return jsonResponse({ ok: false, error: 'Post id is required' }, 400);
    }

    const session = await getAdminSession(context.request, context.env);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const postFile = await getPostById(session.token, context.env, postId);
    if (!postFile.exists || !postFile.data) {
      return jsonResponse({ ok: false, error: 'Post not found' }, 404);
    }

    const formData = await context.request.formData();
    const existing = postFile.data;
    const keepImageIds = parseKeepImageIds(formData);
    const keepImages =
      keepImageIds.length > 0
        ? (existing.images || []).filter((item) => keepImageIds.includes(item.id))
        : existing.images || [];

    const newFiles = formData
      .getAll('images')
      .filter((value) => value && typeof value.arrayBuffer === 'function' && Number(value.size || 0) > 0);
    const newImages = await uploadPostImages(session.token, context.env, postId, newFiles);
    const images = [...keepImages, ...newImages];

    if (images.length > 6) {
      return jsonResponse({ ok: false, error: 'Maximum 6 images are allowed' }, 400);
    }

    const poll = parsePollPayload(formData, existing.poll);
    const existingTags = Array.isArray(existing.tags) ? existing.tags : existing.tag ? [existing.tag] : [];
    const patched = patchPostPayload(existing, {
      title: getFormString(formData, 'title') || existing.title,
      category: getFormString(formData, 'Category') || getFormString(formData, 'category') || existing.category,
      lang: getFormString(formData, 'lang') || existing.lang || 'en',
      tags: parseTags(formData, existingTags),
      body: getFormString(formData, 'body') || existing.body,
      card: {
        title: getFormString(formData, 'cardTitle'),
        category: getFormString(formData, 'cardCategory'),
        tag: getFormString(formData, 'cardTag'),
        image: getFormString(formData, 'cardImage'),
        rank: getFormString(formData, 'cardRank')
      },
      images,
      poll,
      author: session.username
    });

    const index = await getPostsIndex(session.token, context.env);
    await savePostAndIndex(
      session.token,
      context.env,
      postId,
      patched,
      postFile.sha,
      index.data,
      index.sha,
      'Update post'
    );

    const removedImages = (existing.images || []).filter((old) => !images.some((next) => next.id === old.id));
    await deleteImageFiles(session.token, context.env, removedImages, `Delete removed image (${postId})`);

    return jsonResponse({
      ok: true,
      post: patched
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to update post' }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const postId = context.params.id;
    if (!postId) {
      return jsonResponse({ ok: false, error: 'Post id is required' }, 400);
    }

    const session = await getAdminSession(context.request, context.env);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const postFile = await getPostById(session.token, context.env, postId);
    if (!postFile.exists || !postFile.data) {
      return jsonResponse({ ok: false, error: 'Post not found' }, 404);
    }

    const index = await getPostsIndex(session.token, context.env);
    const nextIndex = {
      posts: (index.data.posts || []).filter((item) => item.id !== postId)
    };
    await savePostsIndex(session.token, context.env, nextIndex, index.sha, `Delete post index: ${postId}`);
    await deletePostById(session.token, context.env, postId, `Delete post: ${postId}`);

    await deleteImageFiles(session.token, context.env, postFile.data.images || [], `Delete post images (${postId})`);

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to delete post' }, 500);
  }
}
