import { base64ToUint8Array, getRepoFileRaw, parseRepo } from '../../_lib/github.js';
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

    const { owner, repo, branch } = parseRepo(context.env);
    const rawFile = await getRepoFileRaw(token, owner, repo, branch, asset.path);
    if (!rawFile?.contentBase64) {
      return jsonResponse({ ok: false, error: 'Asset file not found' }, 404);
    }

    const bytes = base64ToUint8Array(rawFile.contentBase64);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': asset.mimeType || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch asset' }, 500);
  }
}
