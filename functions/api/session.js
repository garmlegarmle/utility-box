import { getAdminSession, jsonResponse } from '../_lib/session.js';

export async function onRequestGet(context) {
  const session = await getAdminSession(context.request, context.env);

  if (!session) {
    return jsonResponse({ authenticated: false, isAdmin: false });
  }

  return jsonResponse({
    authenticated: true,
    isAdmin: true,
    username: session.username
  });
}
