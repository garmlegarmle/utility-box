import { createPostPayload, getPostsIndex, getServiceToken, savePostAndIndex, uploadPostImages } from '../_lib/posts.js';
import { getAdminSession, jsonResponse } from '../_lib/session.js';

function getFormString(formData, key) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function parseTags(formData) {
  const multi = formData
    .getAll('tags')
    .flatMap((value) => (typeof value === 'string' ? [value] : []))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  if (multi.length > 0) return multi;

  const single = getFormString(formData, 'tag');
  return single ? single.split(',').map((value) => value.trim()).filter(Boolean) : [];
}

function getPollPayload(formData) {
  const question = getFormString(formData, 'pollQuestion');
  const options = formData
    .getAll('pollOptions')
    .flatMap((item) => (typeof item === 'string' ? [item] : []));

  if (!question && options.length === 0) return null;

  const compact = options
    .flatMap((entry) => entry.split('\n'))
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();
  for (const option of compact) {
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }

  if (!question.trim()) {
    throw new Error('poll question is required when poll options are provided');
  }
  if (deduped.length < 2) {
    throw new Error('poll options must have at least 2 items');
  }

  return {
    question: question.trim(),
    options: deduped.slice(0, 8).map((text, index) => ({
      id: `opt_${Date.now().toString(36)}_${index + 1}`,
      text,
      votes: 0
    })),
    voters: []
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
    const token = await resolveReadToken(context);
    const index = await getPostsIndex(token, context.env);

    return jsonResponse({
      ok: true,
      posts: index.data.posts,
      total: index.data.posts.length
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch posts' }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const session = await getAdminSession(context.request, context.env);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const formData = await context.request.formData();

    const title = getFormString(formData, 'title');
    const category = getFormString(formData, 'Category') || getFormString(formData, 'category');
    const tags = parseTags(formData);
    const body = getFormString(formData, 'body');
    const poll = getPollPayload(formData);
    const files = formData
      .getAll('images')
      .filter((value) => value && typeof value.arrayBuffer === 'function' && Number(value.size || 0) > 0);

    const draft = createPostPayload({
      title,
      category,
      tags,
      body,
      poll,
      author: session.username,
      images: []
    });

    const uploadedImages = await uploadPostImages(session.token, context.env, draft.id, files);
    const post = {
      ...draft,
      images: uploadedImages
    };

    const index = await getPostsIndex(session.token, context.env);
    await savePostAndIndex(
      session.token,
      context.env,
      post.id,
      post,
      null,
      index.data,
      index.sha,
      'Create post'
    );

    return jsonResponse(
      {
        ok: true,
        post
      },
      201
    );
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to create post' }, 500);
  }
}
