export const DEFAULT_ASSET_ORIGIN = 'https://dexdsl.github.io';

export function getAssetOrigin() {
  const envOrigin = String(process.env.DEX_ASSET_ORIGIN || '').trim();
  return envOrigin || DEFAULT_ASSET_ORIGIN;
}

export function absAssetUrl(origin, urlPath) {
  const base = String(origin || DEFAULT_ASSET_ORIGIN).trim().replace(/\/+$/, '');
  const rawPath = String(urlPath || '').trim();
  if (!rawPath) return base;
  const withLeadingSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const normalizedPath = withLeadingSlash.replace(/^\/+/, '/');
  return `${base}${normalizedPath}`;
}
