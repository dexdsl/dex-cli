import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveLifecycleForInit, resolveLifecycleForWrite } from './lib/entry-lifecycle.mjs';

function iso(value) {
  return new Date(value).toISOString();
}

async function setMtime(filePath, value) {
  const date = new Date(value);
  await fs.utimes(filePath, date, date);
}

const initLifecycle = resolveLifecycleForInit('2026-02-21T12:00:00.000Z');
assert.equal(initLifecycle.publishedAt, '2026-02-21T12:00:00.000Z');
assert.equal(initLifecycle.updatedAt, '2026-02-21T12:00:00.000Z');

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-lifecycle-'));
const entryPath = path.join(tempRoot, 'entry.json');
const descPath = path.join(tempRoot, 'description.txt');
const manifestPath = path.join(tempRoot, 'manifest.json');
const indexPath = path.join(tempRoot, 'index.html');
await fs.writeFile(entryPath, '{}\n', 'utf8');
await fs.writeFile(descPath, 'desc\n', 'utf8');
await fs.writeFile(manifestPath, '{}\n', 'utf8');
await fs.writeFile(indexPath, '<html></html>\n', 'utf8');

await setMtime(entryPath, '2024-01-03T08:00:00.000Z');
await setMtime(descPath, '2024-01-01T08:00:00.000Z');
await setMtime(manifestPath, '2024-01-02T08:00:00.000Z');
await setMtime(indexPath, '2024-01-04T08:00:00.000Z');

const preserved = await resolveLifecycleForWrite({
  existingLifecycle: {
    publishedAt: '2023-06-15T11:30:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  entryFolder: tempRoot,
  now: '2026-03-01T05:00:00.000Z',
});
assert.equal(preserved.publishedAt, '2023-06-15T11:30:00.000Z');
assert.equal(preserved.updatedAt, '2026-03-01T05:00:00.000Z');

const backfilled = await resolveLifecycleForWrite({
  existingLifecycle: {},
  entryFolder: tempRoot,
  now: '2026-03-02T05:00:00.000Z',
});
assert.equal(backfilled.publishedAt, iso('2024-01-01T08:00:00.000Z'));
assert.equal(backfilled.updatedAt, '2026-03-02T05:00:00.000Z');

const invalidLifecycle = await resolveLifecycleForWrite({
  existingLifecycle: { publishedAt: 'not-a-date' },
  entryFolder: tempRoot,
  now: '2026-03-03T05:00:00.000Z',
});
assert.equal(invalidLifecycle.publishedAt, iso('2024-01-01T08:00:00.000Z'));
assert.equal(invalidLifecycle.updatedAt, '2026-03-03T05:00:00.000Z');

const missingFolder = await resolveLifecycleForWrite({
  existingLifecycle: {},
  entryFolder: path.join(tempRoot, 'missing'),
  now: '2026-03-04T05:00:00.000Z',
});
assert.equal(missingFolder.publishedAt, '2026-03-04T05:00:00.000Z');
assert.equal(missingFolder.updatedAt, '2026-03-04T05:00:00.000Z');

console.log('test-entry-lifecycle ok');
