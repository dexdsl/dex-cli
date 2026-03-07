#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'sanitize.config.json');
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const URL_PATTERN = /https?:\/\/[^\s"'`<>()]+|\/\/[^\s"'`<>()]+/gi;
const MAX_SAMPLES = 200;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.avif', '.ico', '.gif']);
const IMAGE_HOST_PREFIX = `ima${'ges'}.`;
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
const IMAGE_DOMAINS_KEY = 'legacyImageDomains';
const LEGACY_IMAGE_ALLOWLIST_KEY = 'legacyImageAllowlistFiles';

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeDomains(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
}

function normalizePathList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, ''))
    .filter(Boolean);
}

function parseUrl(rawUrl) {
  try {
    const normalized = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isLegacyImageUrl(parsed) {
  const hostname = parsed.hostname.toLowerCase();
  const ext = path.extname(parsed.pathname || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return true;
  if (NON_IMAGE_EXTENSIONS.has(ext)) return false;
  if (hostname.startsWith(IMAGE_HOST_PREFIX) && hostname.includes('cdn')) return true;
  return (parsed.search || '').toLowerCase().includes('format=');
}

function collectMatches(content, domainSet) {
  const matches = [];
  URL_PATTERN.lastIndex = 0;
  let match = URL_PATTERN.exec(content);
  while (match) {
    const rawUrl = match[0];
    const parsed = parseUrl(rawUrl);
    if (parsed && domainSet.has(parsed.hostname.toLowerCase()) && isLegacyImageUrl(parsed)) {
      matches.push(rawUrl);
      if (matches.length >= MAX_SAMPLES) break;
    }
    match = URL_PATTERN.exec(content);
  }
  return matches;
}

function main() {
  const config = loadJSON(CONFIG_PATH, 'sanitize.config.json');
  const targets = loadJSON(TARGETS_PATH, 'artifacts/repo-targets.json');
  const domains = normalizeDomains(config[IMAGE_DOMAINS_KEY]);
  const allowlistedFiles = new Set(normalizePathList(config[LEGACY_IMAGE_ALLOWLIST_KEY]));
  if (domains.length === 0) {
    throw new Error(`sanitize config image domains are empty (${IMAGE_DOMAINS_KEY}).`);
  }
  const domainSet = new Set(domains);

  const files = Array.from(
    new Set([
      ...(Array.isArray(targets.htmlFiles) ? targets.htmlFiles : []),
      ...(Array.isArray(targets.cssFiles) ? targets.cssFiles : []),
      ...(Array.isArray(targets.jsFiles) ? targets.jsFiles : []),
      ...(Array.isArray(targets.xmlFiles) ? targets.xmlFiles : []),
      ...(Array.isArray(targets.extraTextFiles) ? targets.extraTextFiles : []),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const findings = [];
  for (const relativePath of files) {
    if (allowlistedFiles.has(relativePath)) continue;
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');
    const matches = collectMatches(content, domainSet);
    for (const matched of matches) {
      findings.push({ file: relativePath, url: matched });
      if (findings.length >= MAX_SAMPLES) break;
    }
    if (findings.length >= MAX_SAMPLES) break;
  }

  if (findings.length > 0) {
    console.error(`verify:no-legacy-cdn-images failed. Found ${findings.length} offending URLs.`);
    for (const finding of findings) {
      console.error(`- ${finding.file} :: ${finding.url}`);
    }
    process.exit(1);
  }

  console.log(`verify:no-legacy-cdn-images passed (${files.length} files scanned).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:no-legacy-cdn-images error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
