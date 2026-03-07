#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FAILURES = [];

const AUTHORED_ZWNJ_PATTERN = /&zwnj;|\u200c/i;
const SCAN_ROOTS = [
  'docs',
  'content',
  'components',
  'data',
  'scripts/fixtures/about-reference',
];
const SCAN_FILE_EXT = /\.(?:html|md|json|js|mjs|ts|tsx|css)$/i;

function readText(relPath) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    FAILURES.push(`Missing required file: ${relPath}`);
    return '';
  }
  return fs.readFileSync(absPath, 'utf8');
}

function walkFiles(absPath, out) {
  const stat = fs.statSync(absPath);
  if (stat.isFile()) {
    if (SCAN_FILE_EXT.test(absPath)) out.push(absPath);
    return;
  }

  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  for (const entry of entries) {
    const nextAbsPath = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      walkFiles(nextAbsPath, out);
      continue;
    }
    if (entry.isFile() && SCAN_FILE_EXT.test(nextAbsPath)) {
      out.push(nextAbsPath);
    }
  }
}

function verifyNoAuthoredZwnj() {
  const files = [];
  for (const relRoot of SCAN_ROOTS) {
    const absRoot = path.join(ROOT, relRoot);
    if (!fs.existsSync(absRoot)) continue;
    walkFiles(absRoot, files);
  }

  for (const absPath of files) {
    const relPath = path.relative(ROOT, absPath);
    const text = fs.readFileSync(absPath, 'utf8');
    if (AUTHORED_ZWNJ_PATTERN.test(text)) {
      FAILURES.push(`authored ZWNJ token found in ${relPath}`);
    }
  }
}

function assertIncludes(relPath, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) {
      FAILURES.push(`${relPath} missing marker: ${marker}`);
    }
  }
}

function verifyHeadingRuntime() {
  const relPath = 'public/assets/js/header-slot.js';
  const text = readText(relPath);
  assertIncludes(relPath, text, [
    'HEADING_TYPOGRAPHY_SELECTOR',
    "const STRETCH_PRO_CANONICAL_SEPARATOR = '\\u200C';",
    "const STRETCH_PRO_DUPLICATED_SEPARATOR = '\\u200D';",
    'isStretchDuplicateSeparator',
    'HEADING_DUPLICATE_LIGATURE_SUPPORTED',
    'insertCanonicalDoubleLetterSeparators',
    'normalizeRenderedDuplicateSeparators',
    'stripCanonicalHeadingSeparators',
    'pickProbabilisticDuplicateCount',
    'window.__DX_HEADING_RANDOM_SEED',
    'window.__dxHeadingFx',
    'duplicateLigatureLetters',
    'HEADING_DUPLICATE_EXCLUDE_WORDS_ATTR',
    'parseHeadingDuplicateExcludedWords',
    'HEADING_DUPLICATE_EXCLUDE_LETTERS_ATTR',
    'parseHeadingDuplicateExcludedLetters',
    'DONATE_LABEL_CANONICAL',
    'normalizeDonateActionLabels',
    'data-dx-donate-normalized',
    "data-dx-heading-canonical",
    "data-dx-heading-rendered",
    'applyHeadingTypographyAndSupportHooks',
  ]);

  if (!/return\s+stripCanonicalHeadingSeparators\(rendered\s*\|\|\s*separated\);/.test(text)) {
    FAILURES.push(`${relPath} must normalize visible render output via stripCanonicalHeadingSeparators(rendered || separated)`);
  }
  if (/return\s+rendered\s*\|\|\s*separated\s*;/.test(text)) {
    FAILURES.push(`${relPath} must not return raw rendered/separated heading output`);
  }
}

function verifySidebarHeadingSeparatorPolicy() {
  const relPath = 'public/assets/dex-sidebar.js';
  const text = readText(relPath);
  if (/replace\(\s*\/\[\s*\\u200C\\u200D\s*\]\/g,\s*''\s*\)/.test(text)) {
    FAILURES.push(`${relPath} must not strip U+200D from visible randomizeTitle output`);
  }
  if (!/replace\(\s*\/\\u200C\/g,\s*''\s*\)/.test(text)) {
    FAILURES.push(`${relPath} missing canonical separator strip for heading pass-through`);
  }
}

function verifyNoInlineHeadingRandomizers() {
  const indexRel = 'docs/index.html';
  const indexText = readText(indexRel);
  const indexBlocked = [
    /<h[12][^>]*>\s*<script[^>]*>\s*document\.write\s*\(\s*randomizeTitle\(/i,
    /const\s+h1\s*=\s*document\.createElement\(['"]h1['"]\)[\s\S]{0,600}?randomizeTitle\s*\(/i,
    /insertBlanks\s*\(\s*['"]Sign up for Free Access['"]\s*\)/i,
  ];
  for (const pattern of indexBlocked) {
    if (pattern.test(indexText)) {
      FAILURES.push(`${indexRel} contains inline h1/h2 randomization pattern: ${pattern}`);
    }
  }
  if (!indexText.includes('data-dx-heading-duplicate-exclude-words="RECORDING"')) {
    FAILURES.push(`${indexRel} missing hero duplicate exclusion marker for RECORDING`);
  }

  const boardRel = 'docs/board/index.html';
  const boardText = readText(boardRel);
  if (/textContent\s*=\s*randomizeTitle\s*\(\s*el\.textContent\s*\)/i.test(boardText)) {
    FAILURES.push(`${boardRel} still randomizes existing heading text nodes inline`);
  }

  const heroRel = 'docs/hero.html';
  const heroText = readText(heroRel);
  if (/el\s*\(\s*['"]h1['"][\s\S]{0,250}?randomizeTitle\s*\(/i.test(heroText)) {
    FAILURES.push(`${heroRel} still randomizes h1 text inline`);
  }
}

function verifySupportFooterPadding() {
  const relPath = 'docs/support/index.html';
  const text = readText(relPath);
  assertIncludes(relPath, text, [
    'padding-bottom: calc(0.8rem + var(--dx-fixed-header-top, 12px));',
    'padding-bottom: calc(0.62rem + var(--dx-fixed-header-top, 12px));',
    'class="dx-support-title"',
  ]);
}

function verifySettingsHeadingExclusion() {
  const relPath = 'docs/entry/settings/index.html';
  const text = readText(relPath);
  if (!text.includes('id="dexs-title"')) {
    FAILURES.push(`${relPath} missing settings title heading marker`);
  }
  if (/id="dexs-title"[^>]*data-dx-heading-duplicate-exclude-words=/i.test(text)) {
    FAILURES.push(`${relPath} must not exclude #dexs-title from probabilistic heading duplication`);
  }
  if (!/id="dexs-title"[^>]*data-dx-heading-duplicate-exclude-letters=/i.test(text)) {
    FAILURES.push(`${relPath} missing duplicate-letter guard for #dexs-title`);
  }
  assertIncludes(relPath, text, [
    '#dex-settings .hdr h1',
    'letter-spacing: 0;',
    'font-feature-settings: "liga" 1, "clig" 1, "calt" 1;',
  ]);
}

function verifySupportErrorHeadingHooks() {
  const runtimeRel = 'scripts/src/support.status.entry.mjs';
  const runtimeText = readText(runtimeRel);
  assertIncludes(runtimeRel, runtimeText, [
    'decorateHeadingIfAvailable',
    "dispatchHeadingRenderEvent('dx:support-status:rendered')",
    "dispatchHeadingRenderEvent('dx:error-status:rendered')",
    "routeKey: 'support:title'",
    "routeKey: 'error:title'",
  ]);

  const errorRel = 'docs/error/index.html';
  const errorText = readText(errorRel);
  assertIncludes(errorRel, errorText, [
    'id="dx-error-title"',
  ]);
}

function main() {
  verifyNoAuthoredZwnj();
  verifyHeadingRuntime();
  verifySidebarHeadingSeparatorPolicy();
  verifyNoInlineHeadingRandomizers();
  verifySupportFooterPadding();
  verifySettingsHeadingExclusion();
  verifySupportErrorHeadingHooks();

  if (FAILURES.length > 0) {
    console.error(`verify:heading-zwnj failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:heading-zwnj passed.');
}

main();
