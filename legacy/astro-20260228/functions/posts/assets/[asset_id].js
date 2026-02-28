import { getRepoDirectoryEntries, getRepoFileBytes, parseRepo } from '../../_lib/github.js';
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
    const { owner, repo, branch } = parseRepo(context.env);
    const asset = await getEditorAsset(token, context.env, assetId);

    let filePath = asset?.path || '';
    let mimeType = asset?.mimeType || 'application/octet-stream';

    if (!filePath) {
      const entries = await getRepoDirectoryEntries(token, owner, repo, branch, 'public/uploads/posts/assets');
      const match = entries.find((entry) => {
        return entry?.type === 'file' && String(entry.name || '').startsWith(`${assetId}-`);
      });
      if (!match?.path) {
        return jsonResponse({ ok: false, error: 'Asset not found' }, 404);
      }
      filePath = String(match.path);
      const name = String(match.name || '').toLowerCase();
      if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mimeType = 'image/jpeg';
      if (name.endsWith('.png')) mimeType = 'image/png';
      if (name.endsWith('.webp')) mimeType = 'image/webp';
      if (name.endsWith('.gif')) mimeType = 'image/gif';
      if (name.endsWith('.avif')) mimeType = 'image/avif';
    }

    const rawFile = await getRepoFileBytes(token, owner, repo, branch, filePath);
    if (!rawFile?.bytes || rawFile.bytes.byteLength === 0) {
      return jsonResponse({ ok: false, error: 'Asset file not found' }, 404);
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
    return jsonResponse({ ok: false, error: error.message || 'Failed to fetch asset' }, 500);
  }
}
