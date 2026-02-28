import { handlePreflight, withCors } from './lib/cors';
import { error } from './lib/validators';
import type { Env } from './types';
import { handleAuthCallback, handleAuthLogout, handleAuthSession, handleAuthStart } from './routes/auth';
import { handleGetMedia, handleGetMediaFile } from './routes/media';
import { handlePostsRequest } from './routes/posts';
import { handleUpload } from './routes/upload';

function routePath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const segments = routePath(url.pathname);

  if (request.method.toUpperCase() === 'OPTIONS') {
    return handlePreflight(request, env);
  }

  if (segments[0] !== 'api') {
    return error(404, 'Not found');
  }

  const route = segments[1] || '';

  if (route === 'auth' && request.method.toUpperCase() === 'GET') {
    return handleAuthStart(request, env);
  }

  if (route === 'callback' && request.method.toUpperCase() === 'GET') {
    return handleAuthCallback(request, env);
  }

  if (route === 'session' && request.method.toUpperCase() === 'GET') {
    return handleAuthSession(request, env);
  }

  if (route === 'logout' && request.method.toUpperCase() === 'POST') {
    return handleAuthLogout(request, env);
  }

  if (route === 'posts') {
    return handlePostsRequest(request, env, segments.slice(2));
  }

  if (route === 'upload' && request.method.toUpperCase() === 'POST') {
    return handleUpload(request, env);
  }

  if (route === 'media') {
    const mediaId = segments[2];
    const tail = segments[3] || '';

    if (!mediaId) return error(400, 'Missing media id');

    if (!tail && request.method.toUpperCase() === 'GET') {
      return handleGetMedia(request, env, mediaId);
    }

    if (tail === 'file' && request.method.toUpperCase() === 'GET') {
      return handleGetMediaFile(request, env, mediaId);
    }
  }

  return error(404, 'Not found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await handleApi(request, env);
      return withCors(request, env, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      return withCors(
        request,
        env,
        new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
      );
    }
  }
};
