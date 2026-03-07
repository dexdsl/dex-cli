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

function verifySubmissionRuntime() {
  const sourceRel = 'scripts/src/messages.submission.entry.mjs';
  const sourceText = readText(sourceRel);
  assertIncludes(sourceRel, sourceText, [
    'window.__dxSubmissionTimelineRuntimeLoaded',
    '/me/submissions/',
    '/ack',
    'stageRail',
    'PRESSROOM_SHEET_API',
    'events_for_request',
    'normalizePressroomStageRail',
    'data-dx-fetch-state',
    'data-dx-sub-stage-rail',
  ]);
  if (sourceText.includes('dx-submission-runtime-style')) {
    FAILURES.push(`${sourceRel} should not inject runtime style blocks anymore`);
  }

  const inboxSource = readText('scripts/src/messages.inbox.entry.mjs');
  assertIncludes('scripts/src/messages.inbox.entry.mjs', inboxSource, [
    '/me/submissions?limit=200&state=all',
    '/entry/messages/submission/?sid=',
    '/entry/messages/submission/?kind=pressroom&rid=',
    'sourceType: \'pressroom\'',
    '/me/submissions/',
    '/ack',
  ]);

  for (const relPath of [
    'public/assets/js/messages.submission.js',
    'assets/js/messages.submission.js',
    'docs/assets/js/messages.submission.js',
  ]) {
    const text = readText(relPath);
    assertIncludes(relPath, text, [
      '__dxSubmissionTimelineRuntimeLoaded',
      'me/submissions/',
      'events_for_request',
      'entry/messages/',
    ]);
  }
}

function verifySubmissionRoute() {
  const routeRel = 'docs/entry/messages/submission/index.html';
  const routeText = readText(routeRel);
  assertIncludes(routeRel, routeText, [
    'id="dex-submission"',
    'data-dx-fetch-state="loading"',
    'data-api="https://dex-api.spring-fog-8edd.workers.dev"',
    '/css/components/dx-submission-tracker.css',
    '/assets/js/messages.submission.js',
  ]);

  const stubRel = 'docs/entry/messages/submission.html';
  const stubText = readText(stubRel);
  assertIncludes(stubRel, stubText, [
    'url=./submission/',
    "location.replace(next);",
  ]);
}

function verifyProtectedRoutes() {
  const authRuntime = readText('public/assets/dex-auth.js');
  assertIncludes('public/assets/dex-auth.js', authRuntime, [
    '"/entry/messages/submission": true',
  ]);

  const headerRuntime = readText('public/assets/js/header-slot.js');
  assertIncludes('public/assets/js/header-slot.js', headerRuntime, [
    "'/entry/messages',",
    'const PROFILE_STANDARD_CHROME_ROUTES = new Set([',
    "'/entry/messages/submission',",
    'PROFILE_STANDARD_CHROME_ROUTE_CLASS',
    'isProfileStandardChromePath(',
    'document.body.classList.toggle(PROFILE_STANDARD_CHROME_ROUTE_CLASS, isStandardChrome);',
  ]);
}

function main() {
  verifySubmissionRuntime();
  verifySubmissionRoute();
  verifyProtectedRoutes();

  if (FAILURES.length > 0) {
    console.error(`verify:submission-tracker failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:submission-tracker passed.');
}

main();
