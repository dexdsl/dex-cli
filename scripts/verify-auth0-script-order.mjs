#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'artifacts', '.git']);
const PROTECTED_AUTH_REL_PATHS = new Set([
  'docs/entry/favorites/index.html',
  'docs/entry/submit/index.html',
  'docs/entry/messages/index.html',
  'docs/entry/pressroom/index.html',
  'docs/entry/settings/index.html',
  'docs/entry/achievements/index.html',
  'docs/press/index.html',
  'docs/messages.html',
]);

function listHtmlFilesFallback(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listHtmlFilesFallback(path.join(dirPath, entry.name), out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(path.join(dirPath, entry.name));
    }
  }
  return out;
}

function resolveHtmlFiles() {
  if (fs.existsSync(TARGETS_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf8'));
    const files = Array.isArray(parsed.htmlFiles)
      ? parsed.htmlFiles.map((file) => path.join(ROOT, String(file))).filter((file) => fs.existsSync(file))
      : [];
    if (files.length > 0) return Array.from(new Set(files));
  }
  return listHtmlFilesFallback(ROOT);
}

function toCanonicalPath(src) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.pathname;
    } catch {
      return value;
    }
  }
  if (value.startsWith('//')) {
    try {
      const parsed = new URL(`https:${value}`);
      return parsed.pathname;
    } catch {
      return value;
    }
  }
  return value.split('?')[0].split('#')[0];
}

function indexToLine(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function collectScriptRefs(text) {
  const refs = [];
  const regex = /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  for (const match of text.matchAll(regex)) {
    const src = String(match[2] || '').trim();
    refs.push({
      src,
      path: toCanonicalPath(src),
      index: match.index ?? -1,
      line: indexToLine(text, match.index ?? 0),
    });
  }
  return refs;
}

function firstIndexByPath(refs, candidates) {
  for (let i = 0; i < refs.length; i += 1) {
    if (candidates.includes(refs[i].path)) return i;
  }
  return -1;
}

function buildOrderSnippet(refs, fromIndex, toIndex) {
  const start = Math.max(0, fromIndex - 3);
  const end = Math.min(refs.length, toIndex + 4);
  return refs
    .slice(start, end)
    .map((ref) => `${ref.line}: ${ref.path || ref.src}`)
    .join('\n');
}

function main() {
  const htmlFiles = resolveHtmlFiles();
  const violations = [];

  for (const filePath of htmlFiles) {
    const html = fs.readFileSync(filePath, 'utf8');
    const refs = collectScriptRefs(html);
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const requiresProtectedAuth = PROTECTED_AUTH_REL_PATHS.has(relPath);

    const externalAuth0 = refs.filter((ref) => /auth0-spa-js/i.test(ref.src) && ref.path !== '/assets/vendor/auth0-spa-js.umd.min.js');
    if (externalAuth0.length > 0) {
      const sample = externalAuth0[0];
      violations.push({
        file: path.relative(ROOT, filePath),
        message: `contains non-self-hosted Auth0 SPA script: ${sample.src}`,
        snippet: buildOrderSnippet(refs, refs.indexOf(sample), refs.indexOf(sample)),
      });
      continue;
    }

    const authIndex = firstIndexByPath(refs, ['/assets/dex-auth.js']);
    if (authIndex < 0 && !requiresProtectedAuth) continue;

    const vendorIndex = firstIndexByPath(refs, ['/assets/vendor/auth0-spa-js.umd.min.js']);
    const configIndex = firstIndexByPath(refs, ['/assets/dex-auth0-config.js', '/assets/dex-auth-config.js']);
    if (requiresProtectedAuth && authIndex < 0) {
      violations.push({
        file: relPath,
        message: 'protected route is missing /assets/dex-auth.js',
        snippet: refs.length > 0 ? buildOrderSnippet(refs, 0, Math.min(4, refs.length - 1)) : '(no script tags found)',
      });
      continue;
    }

    const hasOrder = vendorIndex >= 0 && configIndex >= 0 && vendorIndex < configIndex && configIndex < authIndex;
    if (!hasOrder) {
      const relevant = [vendorIndex, configIndex, authIndex].filter((index) => index >= 0);
      const start = relevant.length > 0 ? Math.min(...relevant) : 0;
      const end = relevant.length > 0 ? Math.max(...relevant) : Math.min(refs.length - 1, 0);
      violations.push({
        file: path.relative(ROOT, filePath),
        message: `script order must be vendor -> config -> dex-auth (indexes vendor=${vendorIndex}, config=${configIndex}, auth=${authIndex})`,
        snippet: refs.length > 0 ? buildOrderSnippet(refs, start, end) : '(no script tags found)',
      });
    }
  }

  if (violations.length > 0) {
    console.error(`verify-auth0-script-order failed with ${violations.length} issue(s):`);
    for (const violation of violations) {
      console.error(`\n- ${violation.file}: ${violation.message}`);
      if (violation.snippet) {
        console.error(violation.snippet);
      }
    }
    process.exit(1);
  }

  console.log(`verify-auth0-script-order passed (${htmlFiles.length} HTML files scanned).`);
}

main();
