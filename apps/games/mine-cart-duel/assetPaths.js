export function assetUrl(relativePath) {
  const normalized = String(relativePath || '').replace(/^\/+/, '');
  return `${import.meta.env.BASE_URL}${normalized}`;
}
