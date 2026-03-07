#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readPollsFile } from './lib/polls-store.mjs';

const ROOT = process.cwd();
const FAILURES = [];

const POLLS_GAS_MARKERS = [
  'script.google.com/macros',
  'WEBAPP=',
  'POLLS_API',
];

const POLLS_SCAN_FILES = [
  'docs/polls/index.html',
  'polls/index.html',
  'public/assets/js/polls.app.js',
  'docs/assets/js/polls.app.js',
  'assets/js/polls.app.js',
];

function readText(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    FAILURES.push(`Missing required file: ${relPath}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

function assert(condition, message) {
  if (!condition) FAILURES.push(message);
}

function verifyGasRemoval() {
  for (const relPath of POLLS_SCAN_FILES) {
    const text = readText(relPath);
    for (const marker of POLLS_GAS_MARKERS) {
      if (text.includes(marker)) {
        FAILURES.push(`${relPath} still contains GAS marker: ${marker}`);
      }
    }
  }

  const achievements = readText('docs/entry/achievements/index.html');
  const achievementsPollMarkers = [
    'const POLLS_API',
    'sheet=Votes',
    'AKfycbw0XIM4rK9siLvy4iGCE0aVcL',
  ];
  for (const marker of achievementsPollMarkers) {
    if (achievements.includes(marker)) {
      FAILURES.push(`docs/entry/achievements/index.html still contains legacy polls marker: ${marker}`);
    }
  }

  const achievementsRuntime = readText('scripts/src/achievements.entry.mjs');
  if (!achievementsRuntime.includes('/me/achievements/summary')) {
    FAILURES.push('scripts/src/achievements.entry.mjs missing /me/achievements/summary integration marker');
  }
  if (!achievementsRuntime.includes('pollVotes')) {
    FAILURES.push('scripts/src/achievements.entry.mjs missing pollVotes metric consumption marker');
  }
}

function verifyGeneratedDetailPages(pollIds) {
  for (const pollId of pollIds) {
    const docsPath = `docs/polls/${pollId}/index.html`;
    const rootPath = `polls/${pollId}/index.html`;
    assert(fs.existsSync(path.join(ROOT, docsPath)), `Missing generated detail route: ${docsPath}`);
    assert(fs.existsSync(path.join(ROOT, rootPath)), `Missing generated detail route: ${rootPath}`);
  }
}

function verifyPublicPollRouteNotProtected() {
  const authText = readText('public/assets/dex-auth.js');
  const headerText = readText('public/assets/js/header-slot.js');
  const protectedVerifyText = readText('scripts/verify_protected_auth_contract.mjs');

  assert(!authText.includes('"/polls": true'), 'dex-auth protected map should not include /polls');
  assert(!headerText.includes("'/polls'"), 'header-slot protected route set should not include /polls');
  assert(!protectedVerifyText.includes("'/polls'"), 'verify_protected_auth_contract should not require /polls protected');
}

function verifyRuntimeMarkers() {
  const sourceRel = 'scripts/src/polls.app.entry.mjs';
  const source = readText(sourceRel);
  const required = [
    "const TAB_SET = new Set(['open', 'results', 'archive'])",
    '/polls/published',
    '/trend?bucket=day&window=90d',
    'data-dx-polls-tab="open"',
    'buildPollsHref',
  ];
  for (const marker of required) {
    if (!source.includes(marker)) {
      FAILURES.push(`${sourceRel} missing marker: ${marker}`);
    }
  }
}

async function main() {
  const { data } = await readPollsFile();
  const pollIds = Array.isArray(data.polls)
    ? data.polls.map((poll) => String(poll.id || '').trim()).filter(Boolean)
    : [];

  for (const poll of Array.isArray(data.polls) ? data.polls : []) {
    const callRef = poll && typeof poll.callRef === 'object' ? poll.callRef : null;
    assert(!!callRef, `poll ${poll.id} missing callRef`);
    assert(String(callRef?.group || '') === 'inDex', `poll ${poll.id} callRef.group must be inDex`);
    assert(String(callRef?.lane || '') === 'in-dex-c', `poll ${poll.id} callRef.lane must be in-dex-c`);
    assert(Number.isFinite(Number(callRef?.year || 0)), `poll ${poll.id} callRef.year must be numeric`);
    assert(Number.isFinite(Number(callRef?.sequence || 0)) && Number(callRef?.sequence || 0) > 0, `poll ${poll.id} callRef.sequence must be > 0`);
    assert(String(callRef?.cycleCode || '').startsWith('C'), `poll ${poll.id} callRef.cycleCode must start with C`);
    assert(String(callRef?.cycleLabel || '').startsWith('IN DEX C'), `poll ${poll.id} callRef.cycleLabel must start with IN DEX C`);
  }

  verifyGasRemoval();
  verifyGeneratedDetailPages(pollIds);
  verifyPublicPollRouteNotProtected();
  verifyRuntimeMarkers();

  if (FAILURES.length > 0) {
    console.error(`verify:polls failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:polls passed.');
}

main().catch((error) => {
  console.error(`verify:polls error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
