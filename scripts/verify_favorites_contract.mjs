#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FAILURES = [];

function readText(relPath) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    FAILURES.push(`Missing required file: ${relPath}`);
    return '';
  }
  return fs.readFileSync(absPath, 'utf8');
}

function assertIncludes(relPath, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) {
      FAILURES.push(`${relPath} missing marker: ${marker}`);
    }
  }
}

function verifyRuntimeContract() {
  const sourceRel = 'scripts/src/favorites.runtime.entry.mjs';
  const sourceText = readText(sourceRel);

  assertIncludes(sourceRel, sourceText, [
    'window.__dxFavorites',
    'dex:favorites:v2:',
    'dx:favorites:changed',
    'resolveScope',
    'list(',
    'isFavorite',
    'toggle(',
    'subscribe(',
    'migrateLegacy',
  ]);

  for (const relPath of [
    'public/assets/js/dx-favorites.js',
    'assets/js/dx-favorites.js',
    'docs/assets/js/dx-favorites.js',
  ]) {
    const text = readText(relPath);
    assertIncludes(relPath, text, [
      '__dxFavorites',
      'dx:favorites:changed',
      'dex:favorites:v2:',
    ]);
  }
}

function verifyCatalogContract() {
  const sourceRel = 'scripts/src/catalog.index.entry.mjs';
  const sourceText = readText(sourceRel);
  assertIncludes(sourceRel, sourceText, [
    'createEntryFavoriteButton',
    'data-dx-fav-kind',
    "data-dx-fav-kind', 'entry'",
    'data-dx-fav-lookup',
    'dx:favorites:changed',
  ]);

  const routeRel = 'docs/catalog/index.html';
  const routeText = readText(routeRel);
  assertIncludes(routeRel, routeText, [
    '/assets/js/dx-favorites.js',
    '/assets/js/catalog.index.js',
  ]);

  for (const relPath of [
    'public/assets/js/catalog.index.js',
    'assets/js/catalog.index.js',
    'docs/assets/js/catalog.index.js',
  ]) {
    const text = readText(relPath);
    assertIncludes(relPath, text, [
      'data-dx-fav-kind',
      'dx:favorites:changed',
    ]);
  }
}

function verifySidebarContract() {
  for (const relPath of [
    'assets/dex-sidebar.js',
    'public/assets/dex-sidebar.js',
    'docs/assets/dex-sidebar.js',
  ]) {
    const text = readText(relPath);
    assertIncludes(relPath, text, [
      'dx-fav-entry-toggle',
      'dx-fav-bucket-toggle',
      'dx-fav-file-toggle',
      'buildEntryFavoriteRecord',
      'buildBucketFavoriteRecord',
      'buildFileFavoriteRecord',
      'data-dx-fav-lookup',
      'dx:favorites:changed',
    ]);
  }
}

function verifyFavoritesPageContract() {
  const relPath = 'docs/entry/favorites/index.html';
  const text = readText(relPath);
  assertIncludes(relPath, text, [
    '/assets/js/dx-favorites.js',
    'data-tab="entries"',
    'data-tab="buckets"',
    'data-tab="files"',
    'Lookup #',
    'favoritesApi.list',
    'favoritesApi.toggle',
  ]);
}

function verifyTestRouteContract() {
  const routeFiles = [
    'docs/entries/test-9/index.html',
    'docs/entries/test-9/entry.json',
    'docs/entries/test-9/manifest.json',
  ];
  for (const relPath of routeFiles) {
    readText(relPath);
  }

  const indexRel = 'docs/entries/test-9/index.html';
  const indexText = readText(indexRel);
  assertIncludes(indexRel, indexText, [
    'id="dex-sidebar-config"',
    'id="dex-sidebar-page-config"',
    'id="dex-manifest"',
    '/assets/dex-sidebar.js',
    'Lookup #',
  ]);
}

function main() {
  verifyRuntimeContract();
  verifyCatalogContract();
  verifySidebarContract();
  verifyFavoritesPageContract();
  verifyTestRouteContract();

  if (FAILURES.length > 0) {
    console.error(`verify:favorites failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:favorites passed.');
}

main();
