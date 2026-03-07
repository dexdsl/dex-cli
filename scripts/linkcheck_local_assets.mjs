#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const PUBLIC_ROOT = path.join(ROOT, 'public');
const PREFIXES = ['/css/', '/assets/'];

function loadTargets() {
  if (!fs.existsSync(TARGETS_PATH)) {
    throw new Error('Missing artifacts/repo-targets.json. Run `npm run repo:discover` first.');
  }
  return JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf8'));
}

function isTrackedUrl(urlValue) {
  return PREFIXES.some((prefix) => urlValue.startsWith(prefix));
}

function stripQueryAndHash(urlValue) {
  let value = urlValue;
  const hashIndex = value.indexOf('#');
  if (hashIndex !== -1) value = value.slice(0, hashIndex);
  const queryIndex = value.indexOf('?');
  if (queryIndex !== -1) value = value.slice(0, queryIndex);
  return value;
}

function collectFromSrcset(srcsetValue, callback) {
  const parts = String(srcsetValue || '').split(',');
  for (const part of parts) {
    const candidate = part.trim().split(/\s+/)[0] || '';
    if (candidate && isTrackedUrl(candidate)) callback(candidate);
  }
}

function collectUrls(content, callback) {
  const attrPattern = /\b(?:href|src|content)\s*=\s*(["'])([^"']+)\1/gi;
  const srcsetPattern = /\bsrcset\s*=\s*(["'])([^"']+)\1/gi;

  let match = attrPattern.exec(content);
  while (match) {
    const value = String(match[2] || '').trim();
    if (isTrackedUrl(value)) callback(value);
    match = attrPattern.exec(content);
  }

  match = srcsetPattern.exec(content);
  while (match) {
    collectFromSrcset(match[2], callback);
    match = srcsetPattern.exec(content);
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function main() {
  const targets = loadTargets();
  const htmlFiles = Array.isArray(targets.htmlFiles) ? targets.htmlFiles : [];
  const routes = Array.isArray(targets.routes) ? targets.routes : [];
  const missing = [];

  for (const relativePath of htmlFiles) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');

    collectUrls(content, (urlValue) => {
      const relativeAssetPath = stripQueryAndHash(urlValue).replace(/^\/+/, '');
      const publicPath = path.join(PUBLIC_ROOT, relativeAssetPath);
      if (!fileExists(publicPath)) {
        missing.push({ file: relativePath, url: urlValue });
      }
    });
  }

  if (missing.length > 0) {
    console.error(`verify:assets failed. Missing ${missing.length} local asset references under public/:`);
    for (const item of missing) {
      console.error(`- ${item.file} :: ${item.url}`);
    }
    process.exit(1);
  }

  console.log(`verify:assets passed (${htmlFiles.length} html files, ${routes.length} routes).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:assets error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
