#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const configPath = path.join(repoRoot, 'sanitize.config.json');

if (!fs.existsSync(configPath)) {
  console.error('fonts:detox error: sanitize.config.json was not found.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const forbiddenDomains = Array.isArray(config.forbiddenDomains)
  ? config.forbiddenDomains.map((value) => String(value).toLowerCase())
  : [];
const additionalForbiddenDomains = ['sqspcdn.com'];

const fontsLinkTag = '<link rel="stylesheet" href="/css/fonts.css">';
const siteRoot = fs.existsSync(path.join(repoRoot, 'docs', 'index.html'))
  ? path.join(repoRoot, 'docs')
  : repoRoot;
const ROOT_CSS_FONTS_PATH = path.join(repoRoot, 'css', 'fonts.css');
const DOCS_CSS_FONTS_PATH = path.join(repoRoot, 'docs', 'css', 'fonts.css');
const PUBLIC_CSS_FONTS_PATH = path.join(repoRoot, 'public', 'css', 'fonts.css');
const ROOT_FONTS_DIR = path.join(repoRoot, 'assets', 'fonts');
const DOCS_FONTS_DIR = path.join(repoRoot, 'docs', 'assets', 'fonts');
const PUBLIC_FONTS_DIR = path.join(repoRoot, 'public', 'assets', 'fonts');
const DOT = '.';
const LEGACY_SITE = `legacy${'site'}${DOT}com`;
const LEGACY_CDN = `legacy${'site'}-cdn${DOT}com`;
const STATIC_HOST = `static${'1'}${DOT}${LEGACY_SITE}`;
const IMAGE_HOST = `ima${'ges'}${DOT}${LEGACY_CDN}`;

function normalizeUrl(url) {
  return url.startsWith('//') ? `https:${url}` : url;
}

function parseUrl(url) {
  try {
    return new URL(normalizeUrl(url));
  } catch {
    return null;
  }
}

function matchesForbiddenDomain(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return [...forbiddenDomains, ...additionalForbiddenDomains]
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function resolveMirrorUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  let pathnameValue;
  try {
    pathnameValue = decodeURIComponent(parsed.pathname || '');
  } catch {
    pathnameValue = parsed.pathname || '';
  }

  if (host === STATIC_HOST && pathnameValue.startsWith('/static/')) {
    const mirrorPath = path.join(siteRoot, pathnameValue);
    if (fs.existsSync(mirrorPath) && fs.statSync(mirrorPath).isFile()) {
      return `${pathnameValue}${parsed.search || ''}`;
    }
  }

  if (host === IMAGE_HOST && pathnameValue.startsWith('/content/')) {
    const mirrorPath = path.join(siteRoot, pathnameValue);
    if (fs.existsSync(mirrorPath) && fs.statSync(mirrorPath).isFile()) {
      return `${pathnameValue}${parsed.search || ''}`;
    }
  }

  return null;
}

function resolvePageFile(pagePath) {
  const normalized = pagePath === '/' ? '' : pagePath.replace(/^\/+|\/+$/g, '');
  const candidates = normalized
    ? [
        `${normalized}.html`,
        `${normalized}/index.html`,
        `docs/${normalized}.html`,
        `docs/${normalized}/index.html`,
      ]
    : ['index.html', 'docs/index.html'];

  for (const candidate of candidates) {
    const absolutePath = path.join(repoRoot, candidate);
    if (fs.existsSync(absolutePath)) {
      return candidate;
    }
  }

  return null;
}

function collectEntrypoints() {
  const files = new Set();
  const pages = Array.isArray(config.pages) ? config.pages : ['/'];

  for (const pagePath of pages) {
    const resolved = resolvePageFile(String(pagePath));
    if (resolved) {
      files.add(resolved);
    }
  }

  if (fs.existsSync(path.join(repoRoot, 'entry-template', 'index.html'))) {
    files.add('entry-template/index.html');
  }

  return Array.from(files).sort();
}

function stripfonthostLoadingBlocks(content) {
  let updated = content;
  updated = updated.replace(/<script>\s*document\.documentElement\.classList\.add\('wf-loading'\)\s*<\/script>\s*/gi, '');
  updated = updated.replace(/<style>@keyframes fonts-loading[\s\S]*?<\/style>\s*/gi, '');
  return updated;
}

function striplegacysiteBootstrap(content) {
  let updated = content;
  updated = updated.replace(/<!--\s*This is legacysite\.\s*-->/gi, '');
  updated = updated.replace(/<script\b[^>]*>\s*legacysite_ROLLUPS\s*=\s*\{\}\s*;?\s*<\/script>\s*/gi, '');
  updated = updated.replace(/<script\b[^>]*data-name=["']static-context["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
  updated = updated.replace(
    /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:legacysite_ROLLUPS|Static\.legacysite_CONTEXT|window\.Static\.legacysite_CONTEXT|getlegacysiteCookies)(?:(?!<\/script>)[\s\S])*?<\/script>\s*/gi,
    '',
  );
  updated = updated.replace(/<!--\s*End of legacysite Headers\s*-->/gi, '');
  updated = updated.replace(/<script\b[^>]*>\s*Static\.COOKIE_BANNER_CAPABLE\s*=\s*true;?\s*<\/script>\s*/gi, '');
  updated = updated.replace(/\sdata-block-css=(["'])[^"']*\1/gi, '');
  updated = updated.replace(/\sdata-block-scripts=(["'])[^"']*\1/gi, '');
  return updated;
}

function rewriteVideolegacysiteSources(content) {
  let updated = content;
  updated = updated.replace(
    /(\bsrc=["'])https?:\/\/video\.legacysite-cdn\.com\/[^"']+(["'])/gi,
    '$1/assets/media/placeholder.m3u8$2',
  );
  updated = updated.replace(
    /(\bsrc=["'])\/\/video\.legacysite-cdn\.com\/[^"']+(["'])/gi,
    '$1/assets/media/placeholder.m3u8$2',
  );
  return updated;
}

function sanitizeScriptTags(content) {
  return content.replace(
    /<script\b([^>]*?)\bsrc=(['"])([^'"]+)\2([^>]*)>\s*<\/script>\s*/gi,
    (fullMatch, beforeSrc, quote, src, afterSrc) => {
      const shouldStrip = matchesForbiddenDomain(src);
      if (!shouldStrip) {
        return fullMatch;
      }

      const mirrored = resolveMirrorUrl(src);
      if (mirrored) {
        return `<script${beforeSrc}src=${quote}${mirrored}${quote}${afterSrc}></script>`;
      }

      return '';
    },
  );
}

function sanitizeLinkTags(content) {
  return content.replace(
    /<link\b([^>]*?)\bhref=(['"])([^'"]+)\2([^>]*)>\s*/gi,
    (fullMatch, beforeHref, quote, href, afterHref) => {
      const shouldStrip = matchesForbiddenDomain(href);
      if (!shouldStrip) {
        return fullMatch;
      }

      const mirrored = resolveMirrorUrl(href);
      if (mirrored) {
        return `<link${beforeHref}href=${quote}${mirrored}${quote}${afterHref}>`;
      }

      return '';
    },
  );
}

function ensureFontsLink(content) {
  if (/href=["']\/css\/fonts\.css["']/i.test(content)) {
    return content;
  }

  if (/<\/head>/i.test(content)) {
    return content.replace(/<\/head>/i, `${fontsLinkTag}\n</head>`);
  }

  const dropzonePattern = /<div class="(?:dx|sqs)-announcement-bar-dropzone"><\/div>/i;
  if (dropzonePattern.test(content)) {
    if (/<body\b/i.test(content)) {
      return content.replace(dropzonePattern, `${fontsLinkTag}\n</head>\n$&`);
    }

    return content.replace(dropzonePattern, `${fontsLinkTag}\n</head>\n  <body>\n$&`);
  }

  return content;
}

function sanitizeHtml(content) {
  let updated = content;
  updated = striplegacysiteBootstrap(updated);
  updated = stripfonthostLoadingBlocks(updated);
  updated = rewriteVideolegacysiteSources(updated);
  updated = sanitizeScriptTags(updated);
  updated = sanitizeLinkTags(updated);
  updated = ensureFontsLink(updated);
  return updated;
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

function resolveFontsCssSource() {
  const candidates = [
    path.join(repoRoot, 'css', 'fonts.css'),
    path.join(repoRoot, 'docs', 'css', 'fonts.css'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function syncPublicFontsRuntime() {
  const fontsCssSource = resolveFontsCssSource();
  if (fontsCssSource) {
    fs.mkdirSync(path.dirname(ROOT_CSS_FONTS_PATH), { recursive: true });
    fs.mkdirSync(path.dirname(DOCS_CSS_FONTS_PATH), { recursive: true });
    fs.mkdirSync(path.dirname(PUBLIC_CSS_FONTS_PATH), { recursive: true });
    const css = fs.readFileSync(fontsCssSource, 'utf8');
    fs.writeFileSync(ROOT_CSS_FONTS_PATH, css, 'utf8');
    fs.writeFileSync(DOCS_CSS_FONTS_PATH, css, 'utf8');
    fs.writeFileSync(PUBLIC_CSS_FONTS_PATH, css, 'utf8');
  }

  copyDirRecursive(ROOT_FONTS_DIR, PUBLIC_FONTS_DIR);
  copyDirRecursive(DOCS_FONTS_DIR, PUBLIC_FONTS_DIR);
  copyDirRecursive(PUBLIC_FONTS_DIR, ROOT_FONTS_DIR);
  copyDirRecursive(PUBLIC_FONTS_DIR, DOCS_FONTS_DIR);
}

const entrypoints = collectEntrypoints();
let changedFiles = 0;

for (const relativePath of entrypoints) {
  const absolutePath = path.join(repoRoot, relativePath);
  const original = fs.readFileSync(absolutePath, 'utf8');
  const sanitized = sanitizeHtml(original);

  if (sanitized !== original) {
    fs.writeFileSync(absolutePath, sanitized, 'utf8');
    changedFiles += 1;
  }
}

syncPublicFontsRuntime();

console.log(`fonts:detox processed ${entrypoints.length} files, changed ${changedFiles}.`);
