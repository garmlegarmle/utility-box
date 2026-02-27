import { getEditorAsset, getServiceToken } from '../../_lib/posts.js';
import { getAdminSession, jsonResponse } from '../../_lib/session.js';

async function resolveReadToken(context) {
  const serviceToken = getServiceToken(context.env);
  if (serviceToken) return serviceToken;

  const session = await getAdminSession(context.request, context.env);
  return session?.token || '';
}

export async function onRequestGet(context) {
  try {
    const assetId = context.params.asset_id;
    if (!assetId) {
      return jsonResponse({ ok: false, error: 'asset_id is required' }, 400);
    }

    const token = await resolveReadToken(context);
    const asset = await getEditorAsset(token, context.env, assetId);
    if (!asset) {
      return jsonResponse({ ok: false, error: 'Asset not found' }, 404);
    }

    const target = new URL(asset.url, context.request.url).toString();
    return Response.redirect(target, 302);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch asset' }, 500);
  }
}
