import { getServiceToken, uploadEditorAsset } from '../../_lib/posts.js';
import { getAdminSession, jsonResponse } from '../../_lib/session.js';

export async function onRequestPost(context) {
  try {
    const session = await getAdminSession(context.request, context.env);
    if (!session) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const formData = await context.request.formData();
    const file = formData.get('file') || formData.get('image') || formData.get('asset');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonResponse({ ok: false, error: 'Image file is required' }, 400);
    }

    const asset = await uploadEditorAsset(session.token, context.env, file, session.username);

    return jsonResponse(
      {
        ok: true,
        asset_id: asset.id,
        url: asset.url,
        asset
      },
      201
    );
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to upload asset' }, 500);
  }
}

export async function onRequestGet(context) {
  try {
    const serviceToken = getServiceToken(context.env);
    if (!serviceToken) {
      return jsonResponse({ ok: true, message: 'Upload endpoint is available. Use POST with multipart/form-data.' });
    }
    return jsonResponse({ ok: true, message: 'Upload endpoint is available. Use POST with multipart/form-data.' });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Failed to handle request' }, 500);
  }
}
