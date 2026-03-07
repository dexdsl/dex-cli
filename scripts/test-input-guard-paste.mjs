import assert from 'node:assert/strict';
import { extractGoogleSheetsUrlFromChunk, isPlainEscapeKey, sanitizePastedInputChunk } from './lib/input-guard.mjs';
import { applyKeyToInputState } from './ui/init-wizard.mjs';

assert.equal(sanitizePastedInputChunk('hello', { allowMultiline: false }), 'hello');
assert.equal(sanitizePastedInputChunk('hello\nworld', { allowMultiline: false }), 'hello world');
assert.equal(sanitizePastedInputChunk('hello\nworld', { allowMultiline: true }), 'hello\nworld');
assert.equal(sanitizePastedInputChunk('\x1b[200~hello\nworld\x1b[201~', { allowMultiline: true }), 'hello\nworld');
assert.equal(sanitizePastedInputChunk('\x1b[31mhello\x1b[0m', { allowMultiline: false }), 'hello');
assert.equal(sanitizePastedInputChunk('A\tB', { allowMultiline: false }), 'A B');
assert.equal(sanitizePastedInputChunk('A\tB', { allowMultiline: true }), 'A\tB');
assert.equal(isPlainEscapeKey('\x1b', { escape: true }), true);
assert.equal(isPlainEscapeKey('\x1b[200~https://docs.google.com\x1b[201~', { escape: true }), false);
assert.equal(
  extractGoogleSheetsUrlFromChunk('\x1b[200~https://docs.google.com/spreadsheets/d/abc123/edit?gid=0#gid=0\x1b[201~'),
  'https://docs.google.com/spreadsheets/d/abc123/edit?gid=0#gid=0',
);
assert.equal(
  extractGoogleSheetsUrlFromChunk('docs.google.com/spreadsheets/d/abc123'),
  'https://docs.google.com/spreadsheets/d/abc123',
);

{
  const next = applyKeyToInputState({ value: 'hello', cursor: 5 }, '\x7f', {});
  assert.equal(next.value, 'hell');
  assert.equal(next.cursor, 4);
}

{
  const next = applyKeyToInputState({ value: 'hello', cursor: 2 }, '\x1b[3~', {});
  assert.equal(next.value, 'helo');
  assert.equal(next.cursor, 2);
}

{
  const next = applyKeyToInputState({ value: 'hello', cursor: 5 }, '', { delete: true });
  assert.equal(next.value, 'hell');
  assert.equal(next.cursor, 4);
}

{
  const next = applyKeyToInputState({ value: 'hello', cursor: 2 }, '', { delete: true });
  assert.equal(next.value, 'helo');
  assert.equal(next.cursor, 2);
}

{
  const next = applyKeyToInputState({ value: 'hello', cursor: 5 }, '\x1b[127;5u', {});
  assert.equal(next.value, 'hell');
  assert.equal(next.cursor, 4);
}

console.log('ok input-guard paste');
