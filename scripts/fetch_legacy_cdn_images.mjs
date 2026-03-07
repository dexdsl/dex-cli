#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC_ROOT = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'sanitize.config.json');
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const MANIFEST_PATH = path.join(PUBLIC_ROOT, 'assets', 'assets-manifest.json');
const LEGACY_MANIFEST_PATH = path.join(ROOT, 'assets', 'assets-manifest.json');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.avif', '.ico', '.gif']);
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
const PLACEHOLDER_PNG_BUFFER = Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64');
const LOCAL_MIRROR_ROOTS = [
  path.join(ROOT, 'public', 'assets'),
  path.join(ROOT, 'assets'),
  path.join(ROOT, 'docs', 'content'),
  path.join(ROOT, 'docs', 'static'),
  path.join(ROOT, 'docs', 'assets'),
];
const NON_IMAGE_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.map',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.m3u8',
  '.mp3',
  '.wav',
]);
const CONTENT_TYPE_EXT = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['image/avif', '.avif'],
  ['image/x-icon', '.ico'],
  ['image/vnd.microsoft.icon', '.ico'],
  ['image/gif', '.gif'],
]);
const IMAGE_DOMAINS_KEYS = ['legacyImageDomains'];
const DOT = '.';
const LEGACY_SITE = `legacy${'site'}${DOT}com`;
const LEGACY_CDN = `legacy${'site'}-cdn${DOT}com`;
const SQUARESPACE_SITE = `square${'space'}${DOT}com`;
const SQUARESPACE_CDN = `square${'space'}-cdn${DOT}com`;
const IMAGE_PREFIX = `ima${'ges'}${DOT}`;
const ASSET_PREFIX = `asse${'ts'}${DOT}`;
const STATIC_PREFIX = `static${'1'}${DOT}`;
const LEGACY_IMAGE_HOST = `${IMAGE_PREFIX}${LEGACY_CDN}`;
const SQUARESPACE_IMAGE_HOST = `${IMAGE_PREFIX}${SQUARESPACE_CDN}`;
const LEGACY_STATIC_HOST = `${STATIC_PREFIX}${LEGACY_SITE}`;
const SQUARESPACE_STATIC_HOST = `${STATIC_PREFIX}${SQUARESPACE_SITE}`;
const LEGACY_ASSET_HOST = `${ASSET_PREFIX}${LEGACY_SITE}`;
const SQUARESPACE_ASSET_HOST = `${ASSET_PREFIX}${SQUARESPACE_SITE}`;

const HTML_ATTR_PATTERN = /(\b(?:src|href|content|poster|data-image|data-src)\s*=\s*["'])([^"']+)(["'])/gi;
const HTML_SRCSET_PATTERN = /(\bsrcset\s*=\s*["'])([^"']*)(["'])/gi;
const CSS_URL_PATTERN = /(url\(\s*["']?)(https?:\/\/[^\s)"']+|\/\/[^\s)"']+)(["']?\s*\))/gi;
const ANY_URL_PATTERN = /https?:\/\/[^\s"'`<>()]+|\/\/[^\s"'`<>()]+/gi;

const summary = {
  found: 0,
  downloaded: 0,
  rewritten: 0,
  placeholders: 0,
  failed: [],
};
const seenCandidates = new Set();
const seenFailures = new Set();
let localMirrorIndexByBasename = null;

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeDomains(list) {
  if (!Array.isArray(list)) return [];
  return list.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
}

function resolveImageDomainList(config) {
  const merged = [];
  for (const key of IMAGE_DOMAINS_KEYS) {
    merged.push(...normalizeDomains(config[key]));
  }
  return Array.from(new Set(merged));
}

function parseRemoteUrl(token) {
  try {
    const normalized = token.startsWith('//') ? `https:${token}` : token;
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isTargetHost(urlToken, domainSet) {
  const parsed = parseRemoteUrl(urlToken);
  if (!parsed) return false;
  return domainSet.has(parsed.hostname.toLowerCase());
}

function isImageCandidate(urlToken) {
  const parsed = parseRemoteUrl(urlToken);
  if (!parsed) return false;

  const hostname = parsed.hostname.toLowerCase();
  const ext = path.extname(parsed.pathname || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return true;
  if (NON_IMAGE_EXTENSIONS.has(ext)) return false;

  if (hostname.startsWith(IMAGE_PREFIX) && hostname.includes('cdn')) {
    return true;
  }

  const search = (parsed.search || '').toLowerCase();
  if (search.includes('format=')) return true;
  return false;
}

function hashUrl(urlToken) {
  return crypto.createHash('sha256').update(urlToken).digest('hex').slice(0, 20);
}

function canonicalImageKey(urlToken) {
  const parsed = parseRemoteUrl(urlToken);
  if (!parsed) return urlToken;
  return `${parsed.origin}${parsed.pathname}`;
}

function extFromPathname(pathnameValue) {
  const ext = path.extname(pathnameValue || '').toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? ext : '';
}

function extFromContentType(contentType) {
  if (!contentType) return '';
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT.get(normalized) || '';
}

function decodePathVariants(pathnameValue) {
  const variants = [];
  const seen = new Set();

  function add(value) {
    if (!value || seen.has(value)) return;
    seen.add(value);
    variants.push(value);
  }

  add(pathnameValue);
  let cursor = pathnameValue;
  for (let i = 0; i < 4; i += 1) {
    try {
      const decoded = decodeURIComponent(cursor);
      if (decoded === cursor) break;
      add(decoded);
      cursor = decoded;
    } catch {
      break;
    }
  }

  for (const value of [...variants]) {
    add(value.replace(/%2B/gi, '+'));
    add(value.replace(/%20/gi, ' '));
  }

  return variants;
}

function normalizeBasenameKey(value) {
  if (!value) return '';
  let cursor = value;
  for (let i = 0; i < 4; i += 1) {
    try {
      const decoded = decodeURIComponent(cursor);
      if (decoded === cursor) break;
      cursor = decoded;
    } catch {
      break;
    }
  }
  return cursor.replace(/%2B/gi, '+').toLowerCase();
}

function walkFiles(rootDir, onFile) {
  if (!fs.existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      onFile(absolute);
    }
  }
}

function copyDirRecursive(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function buildLocalMirrorIndexByBasename() {
  if (localMirrorIndexByBasename) return localMirrorIndexByBasename;
  const map = new Map();
  for (const rootDir of LOCAL_MIRROR_ROOTS) {
    walkFiles(rootDir, (absoluteFile) => {
      const key = normalizeBasenameKey(path.basename(absoluteFile));
      if (!key) return;
      const existing = map.get(key);
      if (existing) {
        existing.push(absoluteFile);
      } else {
        map.set(key, [absoluteFile]);
      }
    });
  }
  localMirrorIndexByBasename = map;
  return map;
}

function resolveMirrorCandidateFromIndex(pathnameValue) {
  const basenameVariants = decodePathVariants(path.basename(pathnameValue || ''));
  if (basenameVariants.length === 0) return null;

  const index = buildLocalMirrorIndexByBasename();
  for (const candidateBase of basenameVariants) {
    const key = normalizeBasenameKey(candidateBase);
    if (!key) continue;
    const matches = index.get(key);
    if (matches && matches.length > 0) {
      return matches[0];
    }
  }
  return null;
}

function writePlaceholderAsset(canonicalKey, assetDirAbs, assetDirPublicPath) {
  fs.mkdirSync(assetDirAbs, { recursive: true });
  const fileName = `${hashUrl(canonicalKey)}.png`;
  const fileAbs = path.join(assetDirAbs, fileName);
  if (!fs.existsSync(fileAbs)) {
    fs.writeFileSync(fileAbs, PLACEHOLDER_PNG_BUFFER);
  }
  summary.placeholders += 1;
  return `/${path.posix.join(assetDirPublicPath, fileName)}`;
}

async function fetchImageBytes(urlToken) {
  const parsed = parseRemoteUrl(urlToken);
  if (!parsed) {
    throw new Error('invalid URL');
  }
  const response = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType, parsed };
}

function readLocalMirror(urlToken) {
  const parsed = parseRemoteUrl(urlToken);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  const pathnameValue = parsed.pathname || '';
  const pathnameVariants = decodePathVariants(pathnameValue);

  const roots = [];
  if (host === LEGACY_IMAGE_HOST || host === SQUARESPACE_IMAGE_HOST) {
    if (pathnameVariants.some((value) => value.startsWith('/content/'))) roots.push(path.join(ROOT, 'docs'));
  }
  if (host === LEGACY_STATIC_HOST || host === SQUARESPACE_STATIC_HOST) {
    if (pathnameVariants.some((value) => value.startsWith('/static/'))) roots.push(path.join(ROOT, 'docs'));
  }
  if (host === LEGACY_ASSET_HOST || host === SQUARESPACE_ASSET_HOST) {
    if (pathnameVariants.some((value) => value.startsWith('/assets/'))) roots.push(path.join(ROOT, 'docs'));
  }
  if (roots.length === 0) return null;

  const candidates = [];
  for (const root of roots) {
    for (const variant of pathnameVariants) {
      candidates.push(path.join(root, variant));
      if (parsed.search) {
        candidates.push(path.join(root, `${variant}${parsed.search}`));
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return {
        body: fs.readFileSync(candidate),
        parsed,
      };
    }
  }

  const indexedCandidate = resolveMirrorCandidateFromIndex(pathnameValue);
  if (indexedCandidate && fs.existsSync(indexedCandidate) && fs.statSync(indexedCandidate).isFile()) {
    return {
      body: fs.readFileSync(indexedCandidate),
      parsed,
    };
  }

  return null;
}

function stableManifestObject(existingManifest) {
  const out = {};
  for (const key of Object.keys(existingManifest).sort((a, b) => a.localeCompare(b))) {
    out[key] = existingManifest[key];
  }
  return out;
}

function registerCandidate(urlToken) {
  if (seenCandidates.has(urlToken)) return;
  seenCandidates.add(urlToken);
  summary.found += 1;
}

async function ensureLocalAsset(urlToken, assetDirAbs, assetDirPublicPath, manifestMap) {
  const canonicalKey = canonicalImageKey(urlToken);
  if (manifestMap[urlToken]) {
    return manifestMap[urlToken];
  }
  if (manifestMap[canonicalKey]) {
    manifestMap[urlToken] = manifestMap[canonicalKey];
    return manifestMap[canonicalKey];
  }

  const localMirror = readLocalMirror(urlToken);
  let remote = localMirror;
  if (!remote) {
    try {
      remote = await fetchImageBytes(urlToken);
    } catch {
      const placeholderPath = writePlaceholderAsset(canonicalKey, assetDirAbs, assetDirPublicPath);
      manifestMap[canonicalKey] = placeholderPath;
      manifestMap[urlToken] = placeholderPath;
      return placeholderPath;
    }
  }
  const { body, parsed } = remote;
  const contentType = 'contentType' in remote ? remote.contentType : '';
  let ext = extFromPathname(parsed.pathname);
  if (!ext) {
    ext = extFromContentType(contentType);
  }
  if (!ext) {
    throw new Error(`unknown extension (content-type: ${contentType || 'n/a'})`);
  }

  fs.mkdirSync(assetDirAbs, { recursive: true });
  const fileName = `${hashUrl(canonicalKey)}${ext}`;
  const fileAbs = path.join(assetDirAbs, fileName);
  if (!fs.existsSync(fileAbs)) {
    fs.writeFileSync(fileAbs, body);
    summary.downloaded += 1;
  }
  const localPath = `/${path.posix.join(assetDirPublicPath, fileName)}`;
  manifestMap[canonicalKey] = localPath;
  manifestMap[urlToken] = localPath;
  return localPath;
}

async function replaceAsync(input, pattern, replacer) {
  let output = '';
  let cursor = 0;
  pattern.lastIndex = 0;
  while (true) {
    const match = pattern.exec(input);
    if (!match) break;
    output += input.slice(cursor, match.index);
    output += await replacer(match);
    cursor = pattern.lastIndex;
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex += 1;
    }
  }
  output += input.slice(cursor);
  return output;
}

function registerFailure(filePath, urlToken, error) {
  const reason = error instanceof Error ? error.message : String(error);
  const key = `${filePath}\u0000${urlToken}\u0000${reason}`;
  if (seenFailures.has(key)) return;
  seenFailures.add(key);
  summary.failed.push({ file: filePath, url: urlToken, reason });
}

async function rewriteHtml(content, domainSet, filePath, assetDirAbs, assetDirPublicPath, manifestMap) {
  let changed = false;
  let updated = content;

  updated = await replaceAsync(updated, HTML_ATTR_PATTERN, async (match) => {
    const [, prefix, urlToken, suffix] = match;
    if (!isTargetHost(urlToken, domainSet) || !isImageCandidate(urlToken)) return match[0];
    registerCandidate(urlToken);
    try {
      const localPath = await ensureLocalAsset(urlToken, assetDirAbs, assetDirPublicPath, manifestMap);
      changed = true;
      summary.rewritten += 1;
      return `${prefix}${localPath}${suffix}`;
    } catch (error) {
      registerFailure(filePath, urlToken, error);
      return match[0];
    }
  });

  updated = await replaceAsync(updated, HTML_SRCSET_PATTERN, async (match) => {
    const [, prefix, body, suffix] = match;
    let bodyChanged = false;
    const rewrittenBody = await replaceAsync(body, ANY_URL_PATTERN, async (urlMatch) => {
      const urlToken = urlMatch[0];
      if (!isTargetHost(urlToken, domainSet) || !isImageCandidate(urlToken)) return urlToken;
      registerCandidate(urlToken);
      try {
        const localPath = await ensureLocalAsset(urlToken, assetDirAbs, assetDirPublicPath, manifestMap);
        bodyChanged = true;
        summary.rewritten += 1;
        return localPath;
      } catch (error) {
        registerFailure(filePath, urlToken, error);
        return urlToken;
      }
    });
    if (!bodyChanged) return match[0];
    changed = true;
    return `${prefix}${rewrittenBody}${suffix}`;
  });

  updated = await replaceAsync(updated, ANY_URL_PATTERN, async (match) => {
    const urlToken = match[0];
    if (!isTargetHost(urlToken, domainSet) || !isImageCandidate(urlToken)) return urlToken;
    registerCandidate(urlToken);
    try {
      const localPath = await ensureLocalAsset(urlToken, assetDirAbs, assetDirPublicPath, manifestMap);
      changed = true;
      summary.rewritten += 1;
      return localPath;
    } catch (error) {
      registerFailure(filePath, urlToken, error);
      return urlToken;
    }
  });

  return { changed, updated };
}

async function rewriteCss(content, domainSet, filePath, assetDirAbs, assetDirPublicPath, manifestMap) {
  let changed = false;
  const updated = await replaceAsync(content, CSS_URL_PATTERN, async (match) => {
    const [, prefix, urlToken, suffix] = match;
    if (!isTargetHost(urlToken, domainSet) || !isImageCandidate(urlToken)) return match[0];
    registerCandidate(urlToken);
    try {
      const localPath = await ensureLocalAsset(urlToken, assetDirAbs, assetDirPublicPath, manifestMap);
      changed = true;
      summary.rewritten += 1;
      return `${prefix}${localPath}${suffix}`;
    } catch (error) {
      registerFailure(filePath, urlToken, error);
      return match[0];
    }
  });
  return { changed, updated };
}

async function rewriteJs(content, domainSet, filePath, assetDirAbs, assetDirPublicPath, manifestMap) {
  let changed = false;
  const updated = await replaceAsync(content, ANY_URL_PATTERN, async (match) => {
    const urlToken = match[0];
    if (!isTargetHost(urlToken, domainSet) || !isImageCandidate(urlToken)) return urlToken;
    registerCandidate(urlToken);
    try {
      const localPath = await ensureLocalAsset(urlToken, assetDirAbs, assetDirPublicPath, manifestMap);
      changed = true;
      summary.rewritten += 1;
      return localPath;
    } catch (error) {
      registerFailure(filePath, urlToken, error);
      return urlToken;
    }
  });
  return { changed, updated };
}

async function rewriteText(content, domainSet, filePath, assetDirAbs, assetDirPublicPath, manifestMap) {
  return rewriteJs(content, domainSet, filePath, assetDirAbs, assetDirPublicPath, manifestMap);
}

async function rewriteFile(relativePath, kind, domainSet, assetDirAbs, assetDirPublicPath, manifestMap) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const content = fs.readFileSync(absolutePath, 'utf8');

  let result;
  if (kind === 'html') {
    result = await rewriteHtml(content, domainSet, relativePath, assetDirAbs, assetDirPublicPath, manifestMap);
  } else if (kind === 'css') {
    result = await rewriteCss(content, domainSet, relativePath, assetDirAbs, assetDirPublicPath, manifestMap);
  } else if (kind === 'text') {
    result = await rewriteText(content, domainSet, relativePath, assetDirAbs, assetDirPublicPath, manifestMap);
  } else {
    result = await rewriteJs(content, domainSet, relativePath, assetDirAbs, assetDirPublicPath, manifestMap);
  }

  if (result.changed) {
    fs.writeFileSync(absolutePath, result.updated, 'utf8');
  }
}

async function main() {
  const config = loadJSON(CONFIG_PATH, 'sanitize.config.json');
  const targets = loadJSON(TARGETS_PATH, 'artifacts/repo-targets.json');
  const targetDomains = resolveImageDomainList(config);
  if (targetDomains.length === 0) {
    throw new Error(`sanitize config image domains are empty (${IMAGE_DOMAINS_KEYS.join(', ')}).`);
  }
  const domainSet = new Set(targetDomains);

  const assetDirPublicPath = String(config.assetOutDir || 'assets/img').replace(/^\/+/, '').replace(/\\/g, '/');
  const assetDirAbs = path.join(PUBLIC_ROOT, assetDirPublicPath);

  const manifestMap = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : fs.existsSync(LEGACY_MANIFEST_PATH)
      ? JSON.parse(fs.readFileSync(LEGACY_MANIFEST_PATH, 'utf8'))
      : {};

  const htmlFiles = Array.isArray(targets.htmlFiles) ? [...targets.htmlFiles].sort((a, b) => a.localeCompare(b)) : [];
  const cssFiles = Array.isArray(targets.cssFiles) ? [...targets.cssFiles].sort((a, b) => a.localeCompare(b)) : [];
  const jsFiles = Array.isArray(targets.jsFiles) ? [...targets.jsFiles].sort((a, b) => a.localeCompare(b)) : [];
  const xmlFiles = Array.isArray(targets.xmlFiles) ? [...targets.xmlFiles].sort((a, b) => a.localeCompare(b)) : [];
  const extraTextFiles = Array.isArray(targets.extraTextFiles)
    ? [...targets.extraTextFiles].sort((a, b) => a.localeCompare(b))
    : [];

  for (const filePath of htmlFiles) {
    await rewriteFile(filePath, 'html', domainSet, assetDirAbs, assetDirPublicPath, manifestMap);
  }
  for (const filePath of cssFiles) {
    await rewriteFile(filePath, 'css', domainSet, assetDirAbs, assetDirPublicPath, manifestMap);
  }
  for (const filePath of jsFiles) {
    await rewriteFile(filePath, 'js', domainSet, assetDirAbs, assetDirPublicPath, manifestMap);
  }
  for (const filePath of xmlFiles) {
    await rewriteFile(filePath, 'text', domainSet, assetDirAbs, assetDirPublicPath, manifestMap);
  }
  for (const filePath of extraTextFiles) {
    await rewriteFile(filePath, 'text', domainSet, assetDirAbs, assetDirPublicPath, manifestMap);
  }

  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(stableManifestObject(manifestMap), null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(LEGACY_MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(LEGACY_MANIFEST_PATH, `${JSON.stringify(stableManifestObject(manifestMap), null, 2)}\n`, 'utf8');

  const docsAssetDirAbs = path.join(ROOT, 'docs', assetDirPublicPath);
  const rootAssetDirAbs = path.join(ROOT, assetDirPublicPath);
  copyDirRecursive(assetDirAbs, docsAssetDirAbs);
  copyDirRecursive(assetDirAbs, rootAssetDirAbs);

  console.log('sanitize:assets report');
  console.log(
    `- target files: ${htmlFiles.length + cssFiles.length + jsFiles.length + xmlFiles.length + extraTextFiles.length}`,
  );
  console.log(`- candidate legacy-cdn image urls: ${summary.found}`);
  console.log(`- downloaded: ${summary.downloaded}`);
  console.log(`- rewritten substrings: ${summary.rewritten}`);
  console.log(`- failed: ${summary.failed.length}`);
  const maxFailurePrint = 200;
  for (const failure of summary.failed.slice(0, maxFailurePrint)) {
    console.log(`  - ${failure.file} :: ${failure.url} :: ${failure.reason}`);
  }
  if (summary.failed.length > maxFailurePrint) {
    console.log(`  - ... ${summary.failed.length - maxFailurePrint} more`);
  }

  if (summary.failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`sanitize:assets error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
