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
      FAILURES.push(`${relPath} contains forbidden marker: ${marker}`);
    }
  }
}

function verifySubmitRuntimeLookup() {
  const relPath = 'scripts/src/submit.samples.entry.mjs';
  const text = readText(relPath);
  assertIncludes(relPath, text, [
    'buildGeneratedSubmissionLookup',
    'resolveLookupFromSubmitResponse',
    'SUB${counter}-',
    'performerToken',
  ]);
  assertExcludes(relPath, text, [
    'Sub. ${',
    'SUB01-K.Pre Su AV2026',
  ]);
}

function verifyInboxRuntimeLookup() {
  const relPath = 'scripts/src/messages.inbox.entry.mjs';
  const text = readText(relPath);
  assertIncludes(relPath, text, [
    'resolveSubmissionLookup',
    'effectiveLookupNumber',
    'submissionLookupGenerated',
    'SUB${counter}-',
  ]);
  assertExcludes(relPath, text, [
    'Sub. ${',
    'SUB01-K.Pre Su AV2026',
  ]);
}

function verifyTestsCoverRegex() {
  const relPath = 'tests/submit-samples-ux.spec.ts';
  const text = readText(relPath);
  assertIncludes(relPath, text, [
    'GENERATED_LOOKUP_REGEX',
    'toMatch(GENERATED_LOOKUP_REGEX)',
  ]);
}

function main() {
  verifySubmitRuntimeLookup();
  verifyInboxRuntimeLookup();
  verifyTestsCoverRegex();

  if (FAILURES.length > 0) {
    console.error(`verify:submission-lookup failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:submission-lookup passed.');
}

main();

