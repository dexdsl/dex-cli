#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCallCommand } from './lib/calls-cli.mjs';
import { listCalls } from './lib/calls-store.mjs';

const ROOT = process.cwd();
const CALLS_PATH = path.join(ROOT, 'data', 'calls.registry.json');
const POLLS_PATH = path.join(ROOT, 'data', 'polls.json');
const TMP_CALLS_PATH = path.join(ROOT, 'tmp', `calls.registry.test.${process.pid}.${Date.now()}.json`);
const TMP_POLLS_PATH = path.join(ROOT, 'tmp', `polls.test.${process.pid}.${Date.now()}.json`);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  const safeList = listCalls({ calls: [] }, { status: 'all' });
  assert(Array.isArray(safeList), 'listCalls should accept partial registry inputs');
  assert.equal(safeList.length, 0, 'listCalls partial registry should return empty array');

  const originalCalls = await fs.readFile(CALLS_PATH, 'utf8');
  const originalPolls = await fs.readFile(POLLS_PATH, 'utf8');
  await fs.mkdir(path.dirname(TMP_CALLS_PATH), { recursive: true });
  await fs.writeFile(TMP_CALLS_PATH, originalCalls, 'utf8');
  await fs.writeFile(TMP_POLLS_PATH, originalPolls, 'utf8');

  try {
    await runCallCommand(['list', '--file', TMP_CALLS_PATH]);

    await runCallCommand([
      'add',
      '--file', TMP_CALLS_PATH,
      '--polls-file', TMP_POLLS_PATH,
      '--lane', 'in-dex-a',
      '--year', '2026',
      '--title', 'CLI Test Call',
      '--status', 'draft',
    ]);

    const afterAdd = await readJson(TMP_CALLS_PATH);
    const testCall = afterAdd.calls.find((call) => call.title === 'CLI Test Call');
    assert(testCall, 'call:add should persist new call');
    assert.equal(testCall.sequence, 9, 'call:add should allocate next global sequence after seeded calls+polls');

    await runCallCommand(['set-active', testCall.id, '--file', TMP_CALLS_PATH]);
    const afterSetActive = await readJson(TMP_CALLS_PATH);
    assert.equal(afterSetActive.activeCallId, testCall.id);
    assert.equal(afterSetActive.calls.find((call) => call.id === testCall.id)?.status, 'active');

    await runCallCommand(['clear-active', '--file', TMP_CALLS_PATH]);
    const afterClear = await readJson(TMP_CALLS_PATH);
    assert.equal(String(afterClear.activeCallId || ''), '');

    const polls = await readJson(TMP_POLLS_PATH);
    const firstPoll = polls.polls?.[0];
    delete firstPoll.callRef;
    await fs.writeFile(TMP_POLLS_PATH, `${JSON.stringify(polls, null, 2)}\n`, 'utf8');

    await runCallCommand(['sync-poll-lookups', '--file', TMP_CALLS_PATH, '--polls-file', TMP_POLLS_PATH]);
    const afterSyncPolls = await readJson(TMP_POLLS_PATH);
    assert(afterSyncPolls.polls.every((poll) => poll.callRef && poll.callRef.group === 'inDex'), 'sync-poll-lookups should assign missing callRef');

    console.log('test-dex-call-cli passed');
  } finally {
    await fs.rm(TMP_CALLS_PATH, { force: true });
    await fs.rm(TMP_POLLS_PATH, { force: true });
  }
}

main().catch((error) => {
  console.error(`test-dex-call-cli failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
