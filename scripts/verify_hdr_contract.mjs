#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASE_CSS_PATH = path.join(ROOT, 'public', 'css', 'base.css');
const DEX_CSS_PATH = path.join(ROOT, 'public', 'assets', 'css', 'dex.css');
const DOCS_DIR = path.join(ROOT, 'docs');
const MANIFEST_PATH = path.join(ROOT, 'public', 'data', 'hdr.media-manifest.json');

const REQUIRED_TOKENS = [
  '--dx-accent-solid-sdr',
  '--dx-accent-solid-p3',
  '--dx-accent-solid-hdr',
  '--dx-accent-grad-start-sdr',
  '--dx-accent-grad-end-sdr',
  '--dx-accent-grad-start-p3',
  '--dx-accent-grad-end-p3',
  '--dx-accent-grad-start-hdr',
  '--dx-accent-grad-end-hdr',
  '--dx-glass-highlight-sdr',
  '--dx-glass-highlight-p3',
  '--dx-glass-highlight-hdr',
  '--dx-accent-solid',
  '--dx-accent-gradient',
  '--dx-glass-highlight',
];

const REQUIRED_MEDIA_MARKERS = [
  '@media (color-gamut: p3)',
  '@media (dynamic-range: high) and (color-gamut: p3)',
  '@supports (dynamic-range-limit: standard)',
];

const BANNED_ACCENT_LITERALS = [
  '#ff1910',
  '#ff9810',
  '#ff6a00',
  '#ff2d13',
  '#ff7a1a',
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenValue(css, token) {
  const re = new RegExp(`${escapeRegExp(token)}\\s*:\\s*([^;]+);`);
  const match = css.match(re);
  return match ? match[1].trim().replace(/\s+/g, ' ') : '';
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
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

function assertTokenParity(baseCss, dexCss, failures) {
  for (const token of REQUIRED_TOKENS) {
    const baseValue = tokenValue(baseCss, token);
    const dexValue = tokenValue(dexCss, token);
    if (!baseValue) failures.push(`base.css missing token ${token}`);
    if (!dexValue) failures.push(`dex.css missing token ${token}`);
    if (baseValue && dexValue && baseValue !== dexValue) {
      failures.push(`token mismatch for ${token}: base.css="${baseValue}" dex.css="${dexValue}"`);
    }
  }

  for (const marker of REQUIRED_MEDIA_MARKERS) {
    if (!baseCss.includes(marker)) failures.push(`base.css missing HDR media marker: ${marker}`);
    if (!dexCss.includes(marker)) failures.push(`dex.css missing HDR media marker: ${marker}`);
  }
}

function assertNoBannedAccents(fileLabel, css, failures) {
  const cleanCss = stripCssComments(css);
  for (const literal of BANNED_ACCENT_LITERALS) {
    const re = new RegExp(escapeRegExp(literal), 'ig');
    let match = null;
    while ((match = re.exec(cleanCss)) !== null) {
      const line = lineNumberAt(cleanCss, match.index);
      failures.push(`${fileLabel} contains banned accent literal ${literal} at line ${line}`);
    }
  }
}

function collectAssetRefsFromManifest(failures) {
  if (!fs.existsSync(MANIFEST_PATH)) {
    failures.push(`missing manifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(readText(MANIFEST_PATH));
  } catch (error) {
    failures.push(`invalid manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  const refs = new Set();
  for (const image of parsed.images || []) {
    if (typeof image.source === 'string') refs.add(image.source);
    if (typeof image.sdrAvif === 'string') refs.add(image.sdrAvif);
    if (typeof image.hdrAvif === 'string') refs.add(image.hdrAvif);
  }
  for (const video of parsed.videos || []) {
    if (typeof video.legacySource === 'string') refs.add(video.legacySource);
    if (typeof video.sdrMp4 === 'string') refs.add(video.sdrMp4);
    if (typeof video.hdrMp4 === 'string') refs.add(video.hdrMp4);
  }
  return Array.from(refs);
}

function collectAssetRefsFromMarkup(htmlText) {
  const refs = [];
  const attrRe = /(?:src|srcset)="([^"]+)"/g;
  let match = null;
  while ((match = attrRe.exec(htmlText)) !== null) {
    const raw = String(match[1] || '').trim();
    const first = raw.split(',')[0]?.trim().split(/\s+/)[0] || '';
    if (!first.startsWith('/assets/')) continue;
    if (!/\.(?:avif|mp4)$/i.test(first)) continue;
    refs.push(first);
  }
  return refs;
}

function assertPictureFallbacksAndAssetRefs(failures) {
  if (!fs.existsSync(DOCS_DIR)) {
    failures.push('docs directory missing');
    return;
  }

  const assetRefs = new Set(collectAssetRefsFromManifest(failures));
  const htmlFiles = listHtmlFiles(DOCS_DIR);
  const pictureRe = /<picture\b[^>]*class="[^"]*dx-hdr-picture[^"]*"[^>]*>([\s\S]*?)<\/picture>/gi;

  for (const absolutePath of htmlFiles) {
    const relPath = path.relative(ROOT, absolutePath);
    const html = readText(absolutePath);

    for (const ref of collectAssetRefsFromMarkup(html)) {
      assetRefs.add(ref);
    }

    let match = null;
    while ((match = pictureRe.exec(html)) !== null) {
      const body = match[1] || '';
      if (!/<img\b/i.test(body)) {
        failures.push(`${relPath} has .dx-hdr-picture without <img> fallback`);
      }
    }
  }

  const componentSignupPath = path.join(ROOT, 'components', 'home', 'signup.js');
  if (fs.existsSync(componentSignupPath)) {
    const signupSource = readText(componentSignupPath);
    for (const ref of collectAssetRefsFromMarkup(signupSource)) {
      assetRefs.add(ref);
    }
  }

  for (const ref of assetRefs) {
    if (!ref.startsWith('/assets/')) continue;
    const rel = ref.slice(1);
    const candidates = [
      path.join(ROOT, 'public', rel),
      path.join(ROOT, rel),
      path.join(ROOT, 'docs', rel),
    ];
    if (!candidates.some((candidatePath) => fs.existsSync(candidatePath))) {
      failures.push(`missing HDR/media asset ref ${ref}`);
    }
  }
}

function main() {
  const failures = [];
  const baseCss = readText(BASE_CSS_PATH);
  const dexCss = readText(DEX_CSS_PATH);

  assertTokenParity(baseCss, dexCss, failures);
  assertNoBannedAccents('public/css/base.css', baseCss, failures);
  assertNoBannedAccents('public/assets/css/dex.css', dexCss, failures);
  assertPictureFallbacksAndAssetRefs(failures);

  if (failures.length > 0) {
    console.error(`verify:hdr failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:hdr passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:hdr error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
