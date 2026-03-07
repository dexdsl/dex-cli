#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');
const SLOT_SCRIPT_TAG = '<script defer src="/assets/js/header-slot.js"></script>';
const DOT_SCRIPT_TAG = '<script defer src="/assets/js/dx-scroll-dot.js"></script>';
const INTERACTIVE_HOVER_SCRIPT_TAG = '<script defer src="/assets/js/interactive-hover.js"></script>';
const RUNTIME_CONFIG_TAG = '<script defer src="/assets/dex-runtime-config.js"></script>';
const AUTH0_VENDOR_TAG = '<script src="/assets/vendor/auth0-spa-js.umd.min.js"></script>';
const AUTH0_CONFIG_TAG = '<script src="/assets/dex-auth0-config.js"></script>';
const AUTH_RUNTIME_TAG = '<script src="/assets/dex-auth.js"></script>';

const PROTECTED_AUTH_PATHS = new Set([
  'entry/favorites/index.html',
  'entry/submit/index.html',
  'entry/messages/index.html',
  'entry/pressroom/index.html',
  'entry/settings/index.html',
  'entry/achievements/index.html',
  'press/index.html',
  'messages.html',
]);

const FORCE_INCLUDE_PATHS = new Set([
  '404.html',
  'catalog/lookup/index.html',
  'dexfest/2024/day1/index.html',
  'entry/submit/index.html',
  'entry/test-entry/index.html',
  'messages.html',
  'test-title/description.html',
]);

const CONTENT_HINTS = [
  '<main id="page"',
  'id="siteWrapper"',
  'data-page-sections=',
  'data-footer-sections',
  'header-announcement-bar-wrapper',
];
const MOBILE_META_TAGS = [
  { name: 'theme-color', content: '#e8ebf1' },
  { name: 'mobile-web-app-capable', content: 'yes' },
  { name: 'apple-mobile-web-app-capable', content: 'yes' },
  { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
];

function stripLeadingMetaTag(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leadingRegex = new RegExp(`^\\s*<meta\\s+name=(['"])${escapedName}\\1[^>]*>\\s*`, 'i');
  let next = html;
  let changed = true;
  while (changed) {
    changed = false;
    const replaced = next.replace(leadingRegex, '');
    if (replaced !== next) {
      next = replaced;
      changed = true;
    }
  }
  return next;
}

function stripLeadingViewportAndMobileMeta(html) {
  let next = html;
  let changed = true;
  while (changed) {
    changed = false;
    const before = next;
    next = stripLeadingMetaTag(next, 'viewport');
    for (const tag of MOBILE_META_TAGS) {
      next = stripLeadingMetaTag(next, tag.name);
    }
    if (next !== before) changed = true;
  }
  return next;
}

function stripMetaTagEverywhere(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const globalMetaRegex = new RegExp(`\\s*<meta\\s+name=(['"])${escapedName}\\1[^>]*>\\s*`, 'ig');
  return html.replace(globalMetaRegex, '\n');
}

function stripViewportAndMobileMetaEverywhere(html) {
  let next = stripMetaTagEverywhere(html, 'viewport');
  for (const tag of MOBILE_META_TAGS) {
    next = stripMetaTagEverywhere(next, tag.name);
  }
  return next;
}

function normalizeViewportMetaContent(content) {
  const raw = String(content || '').trim();
  if (!raw) return 'width=device-width, initial-scale=1, viewport-fit=cover';
  const segments = raw
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !/^viewport-fit\s*=/i.test(segment));
  if (!segments.some((segment) => /^width\s*=/i.test(segment))) {
    segments.unshift('width=device-width');
  }
  if (!segments.some((segment) => /^initial-scale\s*=/i.test(segment))) {
    segments.push('initial-scale=1');
  }
  segments.push('viewport-fit=cover');
  return segments.join(', ');
}

function ensureViewportFitCoverMeta(html) {
  const viewportRegex = /<meta\s+name=(['"])viewport\1\s+content=(['"])([^'"]*)\2\s*\/?>/i;
  const match = html.match(viewportRegex);
  if (!match) {
    const tag = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
    const headOpenMatch = html.match(/<head\b[^>]*>/i);
    if (headOpenMatch && typeof headOpenMatch.index === 'number') {
      const insertIndex = headOpenMatch.index + headOpenMatch[0].length;
      return `${html.slice(0, insertIndex)}\n${tag}${html.slice(insertIndex)}`;
    }
    const headCloseIndex = html.indexOf('</head>');
    if (headCloseIndex >= 0) {
      return `${html.slice(0, headCloseIndex)}${tag}\n${html.slice(headCloseIndex)}`;
    }
    const bodyOpenMatch = html.match(/<body\b/i);
    if (bodyOpenMatch && typeof bodyOpenMatch.index === 'number') {
      const insertIndex = bodyOpenMatch.index;
      return `${html.slice(0, insertIndex)}${tag}\n${html.slice(insertIndex)}`;
    }
    const htmlOpenMatch = html.match(/<html\b[^>]*>/i);
    if (htmlOpenMatch && typeof htmlOpenMatch.index === 'number') {
      const insertIndex = htmlOpenMatch.index + htmlOpenMatch[0].length;
      return `${html.slice(0, insertIndex)}\n<head>\n${tag}\n</head>\n${html.slice(insertIndex)}`;
    }
    return `${tag}\n${html}`;
  }

  const [full, nameQuote, contentQuote, content] = match;
  const normalized = normalizeViewportMetaContent(content);
  const normalizedTag = `<meta name=${nameQuote}viewport${nameQuote} content=${contentQuote}${normalized}${contentQuote}>`;
  if (full === normalizedTag) return html;
  return html.replace(full, normalizedTag);
}

function ensureNamedMetaTag(html, name, content) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const metaRegex = new RegExp(`<meta\\s+name=(['"])${escapedName}\\1[^>]*>`, 'i');
  const match = html.match(metaRegex);
  const canonicalTag = `<meta name="${name}" content="${content}">`;
  if (!match) {
    const headOpenMatch = html.match(/<head\b[^>]*>/i);
    if (headOpenMatch && typeof headOpenMatch.index === 'number') {
      const insertIndex = headOpenMatch.index + headOpenMatch[0].length;
      return `${html.slice(0, insertIndex)}\n${canonicalTag}${html.slice(insertIndex)}`;
    }
    const headCloseIndex = html.indexOf('</head>');
    if (headCloseIndex >= 0) {
      return `${html.slice(0, headCloseIndex)}${canonicalTag}\n${html.slice(headCloseIndex)}`;
    }
    const bodyOpenMatch = html.match(/<body\b/i);
    if (bodyOpenMatch && typeof bodyOpenMatch.index === 'number') {
      const insertIndex = bodyOpenMatch.index;
      return `${html.slice(0, insertIndex)}${canonicalTag}\n${html.slice(insertIndex)}`;
    }
    return `${canonicalTag}\n${html}`;
  }

  const currentTag = match[0];
  const contentMatch = currentTag.match(/content=(['"])([^'"]*)\1/i);
  const currentContent = contentMatch ? String(contentMatch[2] || '').trim() : '';
  if (currentContent === content) return html;
  return html.replace(currentTag, canonicalTag);
}

function ensureMobileMetaTags(html) {
  let next = html;
  for (const tag of MOBILE_META_TAGS) {
    next = ensureNamedMetaTag(next, tag.name, tag.content);
  }
  return next;
}

function listHtmlFiles(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listHtmlFiles(absolutePath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(absolutePath);
    }
  }
  return out;
}

function shouldInject(relativePath, html) {
  const requiresRuntime = FORCE_INCLUDE_PATHS.has(relativePath) || CONTENT_HINTS.some((hint) => html.includes(hint));
  const requiresProtectedAuth = PROTECTED_AUTH_PATHS.has(relativePath);
  if (!requiresRuntime && !requiresProtectedAuth) return false;
  if (!html.includes(RUNTIME_CONFIG_TAG)) return true;
  if (requiresProtectedAuth) {
    if (!html.includes(AUTH0_VENDOR_TAG) || !html.includes(AUTH0_CONFIG_TAG) || !html.includes(AUTH_RUNTIME_TAG)) {
      return true;
    }
  }
  if (!requiresRuntime) return false;
  return !html.includes(SLOT_SCRIPT_TAG) || !html.includes(DOT_SCRIPT_TAG) || !html.includes(INTERACTIVE_HOVER_SCRIPT_TAG);
}

function injectSingleTag(html, tag, anchors = []) {
  if (html.includes(tag)) return html;

  for (const anchor of anchors) {
    if (html.includes(anchor)) {
      return html.replace(anchor, `${anchor}\n${tag}`);
    }
  }

  const headCloseIndex = html.indexOf('</head>');
  if (headCloseIndex >= 0) {
    return `${html.slice(0, headCloseIndex)}${tag}\n${html.slice(headCloseIndex)}`;
  }

  const dropzoneMatch = html.match(/<div class="(?:dx|sqs)-announcement-bar-dropzone">/i);
  if (dropzoneMatch) {
    const dropzoneMarker = dropzoneMatch[0];
    return html.replace(dropzoneMarker, `${tag}\n${dropzoneMarker}`);
  }

  const firstScriptIndex = html.indexOf('<script');
  if (firstScriptIndex >= 0) {
    return `${html.slice(0, firstScriptIndex)}${tag}\n${html.slice(firstScriptIndex)}`;
  }

  const titleCloseIndex = html.indexOf('</title>');
  if (titleCloseIndex >= 0) {
    const insertAt = titleCloseIndex + '</title>'.length;
    return `${html.slice(0, insertAt)}\n${tag}${html.slice(insertAt)}`;
  }

  return `${html}\n${tag}\n`;
}

function injectSingleTagBefore(html, tag, anchors = []) {
  if (html.includes(tag)) return html;

  for (const anchor of anchors) {
    if (html.includes(anchor)) {
      return html.replace(anchor, `${tag}\n${anchor}`);
    }
  }
  return injectSingleTag(html, tag, anchors);
}

function injectTag(html, relativePath) {
  let next = html;
  if (PROTECTED_AUTH_PATHS.has(relativePath)) {
    next = injectSingleTagBefore(next, AUTH0_VENDOR_TAG, [SLOT_SCRIPT_TAG, DOT_SCRIPT_TAG, '</head>']);
    next = injectSingleTagBefore(next, AUTH0_CONFIG_TAG, [SLOT_SCRIPT_TAG, DOT_SCRIPT_TAG, '</head>']);
    next = injectSingleTagBefore(next, AUTH_RUNTIME_TAG, [SLOT_SCRIPT_TAG, DOT_SCRIPT_TAG, '</head>']);
  }
  const authAnchor = '<script defer src="/assets/dex-auth.js"></script>';
  const authConfigAnchor = '<script defer src="/assets/dex-auth0-config.js"></script>';
  const authVendorAnchor = '<script defer src="/assets/vendor/auth0-spa-js.umd.min.js"></script>';

  next = injectSingleTag(next, SLOT_SCRIPT_TAG, [authAnchor, authConfigAnchor]);
  next = injectSingleTag(next, DOT_SCRIPT_TAG, [SLOT_SCRIPT_TAG, authAnchor, authConfigAnchor]);
  next = injectSingleTag(next, INTERACTIVE_HOVER_SCRIPT_TAG, [DOT_SCRIPT_TAG, SLOT_SCRIPT_TAG, authAnchor, authConfigAnchor]);
  next = injectSingleTagBefore(next, RUNTIME_CONFIG_TAG, [
    AUTH_RUNTIME_TAG,
    AUTH0_CONFIG_TAG,
    AUTH0_VENDOR_TAG,
    authAnchor,
    authConfigAnchor,
    authVendorAnchor,
    SLOT_SCRIPT_TAG,
    DOT_SCRIPT_TAG,
    INTERACTIVE_HOVER_SCRIPT_TAG,
    '</head>',
  ]);
  return next;
}

function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    throw new Error(`Missing docs directory: ${path.relative(ROOT, DOCS_DIR)}`);
  }

  const htmlFiles = listHtmlFiles(DOCS_DIR);
  let updated = 0;

  for (const absolutePath of htmlFiles) {
    const relativePath = path.relative(DOCS_DIR, absolutePath);
    const html = fs.readFileSync(absolutePath, 'utf8');
    let next = stripLeadingViewportAndMobileMeta(html);
    next = stripViewportAndMobileMetaEverywhere(next);
    next = ensureViewportFitCoverMeta(next);
    next = ensureMobileMetaTags(next);
    const requiresInjection = shouldInject(relativePath, next);
    if (!requiresInjection && next === html) continue;

    if (requiresInjection) {
      next = injectTag(next, relativePath);
    }
    if (next === html) continue;

    fs.writeFileSync(absolutePath, next, 'utf8');
    updated += 1;
    console.log(`header-slot: injected script into docs/${relativePath}`);
  }

  console.log(`header-slot: injection pass complete (${updated} files updated, ${htmlFiles.length} html files scanned).`);
}

try {
  main();
} catch (error) {
  console.error(`header-slot: injection failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
