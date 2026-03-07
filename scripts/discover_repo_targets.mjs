#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_PATH = path.join(ARTIFACT_DIR, 'repo-targets.json');

const EXCLUDED_PREFIXES = [
  'node_modules/',
  'dist/',
  'build/',
  'artifacts/',
  '.git/',
  '.github/',
  'playwright-report/',
  'test-results/',
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split('\0')
    .filter(Boolean)
    .map(toPosix);
}

function isExcluded(filePath) {
  return EXCLUDED_PREFIXES.some((prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix));
}

function hasExt(filePath, exts) {
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

function routeFromHtmlFile(relativePath) {
  let normalized = relativePath.replace(/^\.\/+/, '').replace(/\\/g, '/');
  if (normalized === 'index.html') {
    return '/';
  }
  if (normalized.endsWith('/index.html')) {
    const base = normalized.slice(0, -'index.html'.length);
    return `/${base}`;
  }
  if (normalized.endsWith('.html')) {
    return `/${normalized.slice(0, -'.html'.length)}`;
  }
  return null;
}

function deriveRoutes(htmlFiles) {
  const hasDocsRoot = htmlFiles.includes('docs/index.html');
  const routeInputs = hasDocsRoot
    ? htmlFiles.filter((filePath) => filePath.startsWith('docs/')).map((filePath) => filePath.slice('docs/'.length))
    : [...htmlFiles];

  const routeSet = new Set();
  for (const input of routeInputs) {
    const route = routeFromHtmlFile(input);
    if (!route) continue;
    const normalized = route.replace(/\/+/g, '/');
    routeSet.add(normalized);
  }
  return Array.from(routeSet).sort((a, b) => a.localeCompare(b));
}

function main() {
  const tracked = listTrackedFiles().filter((filePath) => !isExcluded(filePath));

  const htmlFiles = tracked.filter((filePath) => hasExt(filePath, ['.html'])).sort((a, b) => a.localeCompare(b));
  const cssFiles = tracked.filter((filePath) => hasExt(filePath, ['.css'])).sort((a, b) => a.localeCompare(b));
  const jsFiles = tracked.filter((filePath) => hasExt(filePath, ['.js', '.mjs'])).sort((a, b) => a.localeCompare(b));
  const xmlFiles = tracked.filter((filePath) => hasExt(filePath, ['.xml'])).sort((a, b) => a.localeCompare(b));
  const extraTextFiles = tracked
    .filter(
      (filePath) => !hasExt(filePath, ['.html', '.css', '.js', '.mjs', '.xml']) && /\?format=rss$/i.test(filePath),
    )
    .sort((a, b) => a.localeCompare(b));
  const routes = deriveRoutes(htmlFiles);

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    `${JSON.stringify({ htmlFiles, cssFiles, jsFiles, xmlFiles, extraTextFiles, routes }, null, 2)}\n`,
    'utf8',
  );

  console.log('repo:discover complete');
  console.log(`- html files: ${htmlFiles.length}`);
  console.log(`- css files: ${cssFiles.length}`);
  console.log(`- js files: ${jsFiles.length}`);
  console.log(`- xml files: ${xmlFiles.length}`);
  console.log(`- extra text files: ${extraTextFiles.length}`);
  console.log(`- routes: ${routes.length}`);
  console.log(`- first routes: ${routes.slice(0, 10).join(', ')}`);
}

main();
