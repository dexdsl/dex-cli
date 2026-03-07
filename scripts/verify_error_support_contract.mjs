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

function verifyRoutes() {
  const errorRel = 'docs/error/index.html';
  const errorText = readText(errorRel);
  assertIncludes(errorRel, errorText, [
    'id="dx-error"',
    'data-dx-fetch-state="loading"',
    'data-dx-auth-mount',
    'data-dx-error-action="retry"',
    'data-dx-error-action="home"',
    'data-dx-error-action="support"',
    'data-dx-error-action="copy-report"',
    '<meta name="robots" content="noindex, nofollow"',
    '/assets/js/support-status.js',
  ]);

  const supportRel = 'docs/support/index.html';
  const supportText = readText(supportRel);
  assertIncludes(supportRel, supportText, [
    'id="dx-support"',
    'data-dx-fetch-state="loading"',
    'id="dx-support-status"',
    'id="dx-support-account"',
    'data-dx-support-refresh',
    'dx-support-shell',
    'dx-support-card--body',
    'dx-support-card--bottom',
    '<meta name="robots" content="index, follow"',
    '/assets/js/support-status.js',
    'href="/contact/"',
  ]);

  const errorStubRel = 'docs/error.html';
  const errorStubText = readText(errorStubRel);
  assertIncludes(errorStubRel, errorStubText, [
    'url=./error/',
    "location.replace('./error/' + location.search + location.hash);",
  ]);

  const supportStubRel = 'docs/support.html';
  const supportStubText = readText(supportStubRel);
  assertIncludes(supportStubRel, supportStubText, [
    'url=./support/',
    "location.replace('./support/' + location.search + location.hash);",
  ]);
}

function verifyRuntime() {
  const sourceRel = 'scripts/src/support.status.entry.mjs';
  const sourceText = readText(sourceRel);
  assertIncludes(sourceRel, sourceText, [
    'window.DX_STATUS_ENDPOINT',
    'window.__DX_STATUS_POLL_MS',
    "'/data/status.live.json'",
    "'/data/status.fallback.json'",
    'withTimeout(',
    'renderErrorPage(',
    'renderSupportPage(',
    'dx-support-sparkline-block',
    'incidentStateToBadgeState',
    'data-dx-fetch-state',
    'copy-report',
  ]);

  for (const relPath of [
    'public/assets/js/support-status.js',
    'assets/js/support-status.js',
    'docs/assets/js/support-status.js',
  ]) {
    const text = readText(relPath);
    assertIncludes(relPath, text, [
      'DX_STATUS_ENDPOINT',
      '__DX_STATUS_POLL_MS',
      'dx-support-status',
      'dx-error',
    ]);
  }
}

function verifyStatusData() {
  const requiredTopLevel = ['generatedAt', 'overall', 'components', 'incidents'];

  for (const relPath of ['docs/data/status.live.json', 'docs/data/status.fallback.json']) {
    const text = readText(relPath);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      FAILURES.push(`${relPath} is not valid JSON`);
      continue;
    }

    for (const key of requiredTopLevel) {
      if (!(key in parsed)) {
        FAILURES.push(`${relPath} missing key: ${key}`);
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      FAILURES.push(`${relPath} should parse to an object`);
      continue;
    }

    if (!parsed.overall || typeof parsed.overall !== 'object') {
      FAILURES.push(`${relPath} missing overall object`);
    } else {
      if (!('state' in parsed.overall)) FAILURES.push(`${relPath} overall missing state`);
      if (!('message' in parsed.overall)) FAILURES.push(`${relPath} overall missing message`);
    }

    if (!Array.isArray(parsed.components)) {
      FAILURES.push(`${relPath} components must be an array`);
    }

    if (!Array.isArray(parsed.incidents)) {
      FAILURES.push(`${relPath} incidents must be an array`);
    }
  }
}

function main() {
  verifyRoutes();
  verifyRuntime();
  verifyStatusData();

  if (FAILURES.length > 0) {
    console.error(`verify:error-support failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:error-support passed.');
}

main();
