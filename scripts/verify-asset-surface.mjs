import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractFormatKeys, injectEntryHtml } from './lib/entry-html.mjs';
import { sanitizeGeneratedHtml } from './lib/sanitize-generated-html.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'entry-template', 'index.html');
const ENTRIES_DIR = path.join(PROJECT_ROOT, 'entries');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const PUBLIC_ORIGIN = 'https://dexdsl.github.io';
const BREADCRUMB_BUNDLE_RELATIVE_PATH = path.join('assets', 'js', 'dex-breadcrumb-motion.js');

const ATTR_RX = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi;
const CORE_RUNTIME = ['/assets/vendor/auth0-spa-js.umd.min.js', '/assets/dex-auth0-config.js', '/assets/dex-auth.js', '/assets/js/header-slot.js', '/assets/dex-sidebar.js', '/assets/js/dex-breadcrumb-motion.js'];
const BUCKETS = ['A', 'B', 'C', 'D', 'E', 'X'];
const FORBIDDEN_BUNDLE_PATTERNS = [
  { token: 'esm.sh import', regex: /esm\.sh/i },
  { token: 'dynamic import call', regex: /\bimport\s*\(/i },
];
const MIRROR_PARITY_GROUPS = [
  ['public/assets/css/dex.css', 'assets/css/dex.css', 'docs/assets/css/dex.css'],
  ['public/assets/dex-sidebar.js', 'assets/dex-sidebar.js', 'docs/assets/dex-sidebar.js'],
  ['public/assets/js/header-slot.js', 'assets/js/header-slot.js', 'docs/assets/js/header-slot.js'],
  ['public/assets/js/dex-breadcrumb-motion.js', 'assets/js/dex-breadcrumb-motion.js', 'docs/assets/js/dex-breadcrumb-motion.js'],
];

function extractRuntimePaths(html) {
  const paths = new Set();
  for (const match of String(html || '').matchAll(ATTR_RX)) {
    const value = String(match[2] || '').trim();
    if (/^\/(?:assets|scripts)\//.test(value)) {
      paths.add(value);
      continue;
    }
    if (/^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value);
        if (/^(?:www\.)?dexdsl\.(?:github\.io|org|com)$/i.test(parsed.hostname) && /^\/(?:assets|scripts)\//.test(parsed.pathname)) {
          paths.add(parsed.pathname);
        }
      } catch {}
    }
  }
  return paths;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha1(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash('sha1').update(buffer).digest('hex');
}

async function verifyMirrorParity() {
  for (const group of MIRROR_PARITY_GROUPS) {
    const absolutePaths = group.map((relativePath) => path.join(PROJECT_ROOT, relativePath));
    const existence = await Promise.all(absolutePaths.map((filePath) => fileExists(filePath)));
    const missing = group.filter((_, index) => !existence[index]);
    if (missing.length > 0) {
      throw new Error(`Asset mirror parity failed: missing file(s): ${missing.join(', ')}`);
    }
    const hashes = await Promise.all(absolutePaths.map((filePath) => sha1(filePath)));
    const first = hashes[0];
    const mismatch = hashes.find((hash) => hash !== first);
    if (mismatch) {
      const labeled = group.map((relativePath, index) => `${relativePath}=${hashes[index]}`).join(', ');
      throw new Error(`Asset mirror parity failed: checksum mismatch: ${labeled}`);
    }
  }
}

async function verifyBreadcrumbBundleIntegrity() {
  const runtimeTargets = [
    path.join(PROJECT_ROOT, BREADCRUMB_BUNDLE_RELATIVE_PATH),
    path.join(DOCS_DIR, BREADCRUMB_BUNDLE_RELATIVE_PATH),
  ];
  for (const filePath of runtimeTargets) {
    const source = await fs.readFile(filePath, 'utf8');
    for (const pattern of FORBIDDEN_BUNDLE_PATTERNS) {
      if (pattern.regex.test(source)) {
        throw new Error(`Breadcrumb runtime bundle contains forbidden ${pattern.token}: ${path.relative(PROJECT_ROOT, filePath)}`);
      }
    }
  }
}

async function pickGeneratedEntryHtml() {
  const dirents = await fs.readdir(ENTRIES_DIR, { withFileTypes: true }).catch(() => []);
  const slugs = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const slug of slugs) {
    const htmlPath = path.join(ENTRIES_DIR, slug, 'index.html');
    if (await fileExists(htmlPath)) return htmlPath;
  }
  return null;
}

function buildManifest(formatKeys) {
  const audioKeys = Array.isArray(formatKeys?.audio) ? formatKeys.audio : [];
  const videoKeys = Array.isArray(formatKeys?.video) ? formatKeys.video : [];
  const manifest = { audio: {}, video: {} };
  for (const bucket of BUCKETS) {
    manifest.audio[bucket] = Object.fromEntries(audioKeys.map((key) => [key, '']));
    manifest.video[bucket] = Object.fromEntries(videoKeys.map((key) => [key, '']));
  }
  return manifest;
}

function buildSidebarConfig() {
  return {
    lookupNumber: 'VERIFY-ASSET-SURFACE',
    buckets: ['A'],
    specialEventImage: '/assets/series/dex.png',
    attributionSentence: 'verify',
    credits: {
      artist: ['Artist'],
      artistAlt: null,
      instruments: ['Instrument'],
      video: { director: ['Director'], cinematography: ['Cinematography'], editing: ['Editing'] },
      audio: { recording: ['Recording'], mix: ['Mix'], master: ['Master'] },
      year: 2026,
      season: 'S1',
      location: 'Somewhere',
    },
    fileSpecs: {
      bitDepth: 24,
      sampleRate: 48000,
      channels: 'stereo',
      staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' },
    },
    metadata: { sampleLength: '', tags: [] },
  };
}

async function main() {
  const templateHtml = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const runtimePaths = new Set(extractRuntimePaths(templateHtml));
  const formatKeys = extractFormatKeys(templateHtml);

  const synthesized = injectEntryHtml(templateHtml, {
    descriptionText: 'verify',
    manifest: buildManifest(formatKeys),
    sidebarConfig: buildSidebarConfig(),
    canonical: { instrument: 'instrument', artistName: 'artist' },
    video: { mode: 'url', dataUrl: 'https://www.youtube.com/watch?v=CSFGiU1gg4g', dataHtml: '' },
    title: 'Verify Asset Surface',
    authEnabled: true,
  }).html;
  const sanitizedSynthesized = sanitizeGeneratedHtml(synthesized);
  for (const runtimePath of extractRuntimePaths(sanitizedSynthesized)) runtimePaths.add(runtimePath);
  console.log('Scanned synthesized entry from template anchors.');

  const generatedPath = await pickGeneratedEntryHtml();
  if (generatedPath) {
    const generatedHtml = await fs.readFile(generatedPath, 'utf8');
    for (const runtimePath of extractRuntimePaths(generatedHtml)) runtimePaths.add(runtimePath);
    console.log(`Scanned generated entry: ${path.relative(PROJECT_ROOT, generatedPath)}`);
  } else {
    console.log('No generated entries/*/index.html found; scanned template only.');
  }

  for (const runtimePath of CORE_RUNTIME) {
    if (!runtimePaths.has(runtimePath)) {
      throw new Error(`Runtime contract mismatch: missing expected runtime path in template/generated scan: ${runtimePath}`);
    }
  }

  const orderedPaths = [...runtimePaths].sort();
  if (!orderedPaths.length) throw new Error('No /assets/* or /scripts/* runtime links found in template/generated scan.');

  let missing = 0;
  console.log('Runtime asset surface:');
  for (const runtimePath of orderedPaths) {
    const docsPath = path.join(DOCS_DIR, runtimePath.slice(1));
    const publicUrl = `${PUBLIC_ORIGIN}${runtimePath}`;
    const exists = await fileExists(docsPath);
    if (!exists) {
      missing += 1;
      console.error(`  MISSING  docs/${runtimePath.slice(1)}  -> ${publicUrl}`);
      continue;
    }
    console.log(`  OK       docs/${runtimePath.slice(1)}  -> ${publicUrl}`);
  }

  if (missing > 0) {
    throw new Error(`Asset surface verification failed: ${missing} required runtime file(s) missing from docs/.`);
  }

  await verifyBreadcrumbBundleIntegrity();
  await verifyMirrorParity();

  console.log('Asset surface verification passed.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
