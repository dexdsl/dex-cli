import { absAssetUrl, getAssetOrigin } from './asset-origin.mjs';

const ATTR_RX = /\b(src|href)\s*=\s*(["'])([^"']*)\2/gi;

function isRewritableAssetPath(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return false;
  if (/^(?:https?:|mailto:|tel:|#|\/\/)/i.test(candidate)) return false;
  if (/^(?:\/?entry\/|\/?favorites(?:[/?#]|$)|\/?polls(?:[/?#]|$))/i.test(candidate)) return false;
  return /^(?:\/(?:assets|scripts)\/|(?:assets|scripts)\/)/.test(candidate);
}

export function rewriteLocalAssetLinks(html, origin = getAssetOrigin()) {
  return String(html || '').replace(ATTR_RX, (full, attr, quote, value) => {
    if (!isRewritableAssetPath(value)) return full;
    return `${attr}=${quote}${absAssetUrl(origin, value)}${quote}`;
  });
}
