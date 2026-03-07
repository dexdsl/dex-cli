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

function assertExcludes(relPath, text, markers) {
  for (const marker of markers) {
    if (text.includes(marker)) {
      FAILURES.push(`${relPath} contains banned marker: ${marker}`);
    }
  }
}

function verifySubmitRuntime() {
  const rel = 'scripts/src/submit.samples.entry.mjs';
  const text = readText(rel);
  assertIncludes(rel, text, [
    'parseRouteFlowState',
    "data-dx-submit-flow",
    "data-dx-submit-lane",
    "data-dx-submit-has-active-call",
    "data-dx-submit-active-call-count",
    'quota_call',
    'submit_call',
    'CALLS_REGISTRY_URL',
    'applyCallsRegistryContract',
    'buildCallMetadataStep',
  ]);
}

function verifyCallRuntime() {
  const rel = 'scripts/src/call.editorial.entry.mjs';
  const text = readText(rel);
  assertIncludes(rel, text, [
    'buildSubmitCallHref',
    '/entry/submit/?',
    'call-subcall',
    'call-active',
    'call-mini',
  ]);
  assertExcludes(rel, text, [
    'createLinkButton(active.submit_cta.label_raw, active.submit_cta.href',
    'createLinkButton(mini.submit_cta.label_raw, mini.submit_cta.href',
  ]);
}

function verifySubmitRoute() {
  const rel = 'docs/entry/submit/index.html';
  const text = readText(rel);
  assertIncludes(rel, text, [
    'id="dex-submit"',
    'data-dx-fetch-state="loading"',
    '/assets/js/submit.samples.js',
  ]);
}

function main() {
  verifySubmitRuntime();
  verifyCallRuntime();
  verifySubmitRoute();

  if (FAILURES.length > 0) {
    console.error(`verify:call-submit failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:call-submit passed.');
}

main();
