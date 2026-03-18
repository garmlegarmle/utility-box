import path from 'node:path';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function getConfig() {
  const uploadRoot = process.env.UPLOAD_ROOT || '/data/uploads';
  return {
    port: Number(process.env.PORT || 8200),
    databaseUrl: required('DATABASE_URL'),
    adminToken: String(process.env.ADMIN_TOKEN || '').trim(),
    adminSessionSecret: required('ADMIN_SESSION_SECRET'),
    adminLoginUser: String(process.env.ADMIN_LOGIN_USER || '').trim().toLowerCase(),
    adminLoginPassword: String(process.env.ADMIN_LOGIN_PASSWORD || '').trim(),
    cookieDomain: String(process.env.COOKIE_DOMAIN || '').trim(),
    uploadRoot,
    mediaRoot: path.join(uploadRoot, 'media'),
    mediaPublicBaseUrl: String(process.env.MEDIA_PUBLIC_BASE_URL || '').trim(),
    nodeEnv: String(process.env.NODE_ENV || 'development').trim(),
    siteOrigin: String(process.env.SITE_ORIGIN || '').trim()
  };
}
