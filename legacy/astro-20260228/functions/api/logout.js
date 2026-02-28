import { SESSION_COOKIE, makeClearCookie, jsonResponse } from '../_lib/session.js';

export async function onRequestPost() {
  return jsonResponse(
    { ok: true },
    200,
    {
      'Set-Cookie': makeClearCookie(SESSION_COOKIE)
    }
  );
}
