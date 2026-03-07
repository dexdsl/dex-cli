#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const DIST_DIR = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PREFIXES = ['/css/', '/assets/', '/static/'];

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function walkHtmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.html')) continue;
    out.push(toPosix(path.relative(ROOT, abs)));
  }
  return out;
}

function resolveHtmlFiles() {
  const targets = loadJson(TARGETS_PATH);
  if (targets && Array.isArray(targets.htmlFiles) && targets.htmlFiles.length > 0) {
    return Array.from(new Set(targets.htmlFiles.map((filePath) => String(filePath)))).sort((a, b) => a.localeCompare(b));
  }

  const fallback = new Set();
  if (fs.existsSync(path.join(ROOT, 'index.html'))) fallback.add('index.html');
  if (fs.existsSync(path.join(ROOT, 'docs', 'index.html'))) fallback.add('docs/index.html');
  for (const relativePath of walkHtmlFiles(path.join(ROOT, 'docs'))) fallback.add(relativePath);
  for (const relativePath of walkHtmlFiles(path.join(ROOT, 'entries'))) fallback.add(relativePath);
  if (fs.existsSync(path.join(ROOT, 'entry-template', 'index.html'))) fallback.add('entry-template/index.html');
  return Array.from(fallback).sort((a, b) => a.localeCompare(b));
}

function stripQueryAndHash(urlValue) {
  const hashIndex = urlValue.indexOf('#');
  const queryIndex = urlValue.indexOf('?');
  const endIndex = Math.min(
    hashIndex === -1 ? urlValue.length : hashIndex,
    queryIndex === -1 ? urlValue.length : queryIndex,
  );
  return urlValue.slice(0, endIndex);
}

function isTrackedRootRelative(urlValue) {
  return PREFIXES.some((prefix) => urlValue.startsWith(prefix));
}

function extractFromSrcset(rawValue, addUrl) {
  const parts = String(rawValue || '').split(',');
  for (const part of parts) {
    const candidate = part.trim().split(/\s+/)[0] || '';
    if (candidate && isTrackedRootRelative(candidate)) addUrl(candidate);
  }
}

function extractUrlsFromHtml(content, addUrl) {
  const attrPattern = /\b(?:href|src|content)\s*=\s*(["'])([^"']+)\1/gi;
  const srcsetPattern = /\bsrcset\s*=\s*(["'])([^"']+)\1/gi;
  const cssUrlPattern = /url\(\s*(["']?)([^"')\s]+)\1\s*\)/gi;

  let match = attrPattern.exec(content);
  while (match) {
    const value = String(match[2] || '').trim();
    if (isTrackedRootRelative(value)) addUrl(value);
    match = attrPattern.exec(content);
  }

  match = srcsetPattern.exec(content);
  while (match) {
    extractFromSrcset(match[2], addUrl);
    match = srcsetPattern.exec(content);
  }

  match = cssUrlPattern.exec(content);
  while (match) {
    const value = String(match[2] || '').trim();
    if (isTrackedRootRelative(value)) addUrl(value);
    match = cssUrlPattern.exec(content);
  }
}

function existsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function recommendationFor(urlValue, existsRoot, existsPublic, existsDist) {
  if (urlValue.startsWith('/static/vta/')) return 'delete reference';
  if (existsPublic) return 'ok';
  if (existsRoot) return 'move to public';
  if (existsDist) return 'update link';
  return 'update link';
}

function main() {
  const htmlFiles = resolveHtmlFiles();
  const urlToFiles = new Map();

  for (const relativePath of htmlFiles) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');
    extractUrlsFromHtml(content, (urlValue) => {
      if (!urlToFiles.has(urlValue)) urlToFiles.set(urlValue, new Set());
      urlToFiles.get(urlValue).add(relativePath);
    });
  }

  const urls = Array.from(urlToFiles.keys()).sort((a, b) => a.localeCompare(b));
  const hasDist = fs.existsSync(DIST_DIR);

  console.log('diag:assets');
  console.log(`- html files scanned: ${htmlFiles.length}`);
  console.log(`- unique /css|/assets|/static refs: ${urls.length}`);
  console.log(`- checked roots: root=${ROOT}, public=${PUBLIC_DIR}, dist=${hasDist ? DIST_DIR : 'absent'}`);
  console.log('');

  for (const urlValue of urls) {
    const normalized = stripQueryAndHash(urlValue).replace(/^\/+/, '');
    const inRoot = existsFile(path.join(ROOT, normalized));
    const inPublic = existsFile(path.join(PUBLIC_DIR, normalized));
    const inDist = hasDist ? existsFile(path.join(DIST_DIR, normalized)) : false;
    const recommend = recommendationFor(urlValue, inRoot, inPublic, inDist);
    const sampleFile = Array.from(urlToFiles.get(urlValue)).sort((a, b) => a.localeCompare(b))[0] || '';

    console.log(`${urlValue}`);
    console.log(`  exists: root=${inRoot} public=${inPublic} dist=${inDist}`);
    console.log(`  recommend: ${recommend}`);
    if (sampleFile) console.log(`  sample: ${sampleFile}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`diag:assets error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
