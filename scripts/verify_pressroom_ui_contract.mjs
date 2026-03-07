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

function verifyPressroomRoute() {
  const routeRel = 'docs/entry/pressroom/index.html';
  const route = readText(routeRel);

  assertIncludes(routeRel, route, [
    'id="dex-press"',
    'data-dx-fetch-state="loading"',
    'data-monthly-limit="1"',
    '/css/components/dx-pressroom.css',
    '/assets/js/pressroom.js',
  ]);

  const banned = [
    'DexDSL ▶ Press Room Submission (glassmorphic wizard)',
    'window.pressCallback',
    'const WEBAPP_URL =',
    'One submission per calendar month.',
  ];

  for (const marker of banned) {
    if (route.includes(marker)) {
      FAILURES.push(`${routeRel} still contains legacy inline pressroom marker: ${marker}`);
    }
  }
}

function verifyPressroomRuntime() {
  const sourceRel = 'scripts/src/pressroom.entry.mjs';
  const source = readText(sourceRel);

  assertIncludes(sourceRel, source, [
    'window.__dxPressroomRuntimeLoaded',
    'DX_MIN_SHEEN_MS = 120',
    "action: 'quota'",
    "action: 'list'",
    "action: 'append'",
    "action: 'events_for_request'",
    'data-dx-press-shell',
    'data-dx-press-step',
    'data-dx-press-history',
    'data-dx-press-timeline',
    'data-dx-press-quota-source',
    'Monthly requests available',
    'Open inbox',
    'Open this timeline',
    'kind=pressroom&rid=',
  ]);

  for (const relPath of [
    'public/assets/js/pressroom.js',
    'assets/js/pressroom.js',
    'docs/assets/js/pressroom.js',
  ]) {
    const text = readText(relPath);
    assertIncludes(relPath, text, [
      '__dxPressroomRuntimeLoaded',
      'data-dx-press-shell',
      'events_for_request',
    ]);
  }
}

function verifyCssContracts() {
  const cssRel = 'public/css/components/dx-pressroom.css';
  const cssText = readText(cssRel);

  assertIncludes(cssRel, cssText, [
    '.dx-press-shell',
    '.dx-press-main',
    '.dx-press-command',
    '.dx-press-progress-fill',
    '.dx-press-history',
    '.dx-press-timeline',
    '.dx-press-step-card',
  ]);

  for (const relPath of [
    'css/components/dx-pressroom.css',
    'docs/css/components/dx-pressroom.css',
  ]) {
    const text = readText(relPath);
    assertIncludes(relPath, text, [
      '.dx-press-shell',
      '.dx-press-command',
      '.dx-press-history',
    ]);
  }
}

function main() {
  verifyPressroomRoute();
  verifyPressroomRuntime();
  verifyCssContracts();

  if (FAILURES.length > 0) {
    console.error(`verify:pressroom-ui failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:pressroom-ui passed.');
}

main();
