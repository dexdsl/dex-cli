import assert from 'node:assert/strict';
import {
  assertAssetReferenceToken,
  isAssetReferenceToken,
  parseAssetReferenceToken,
} from './lib/asset-ref.mjs';

const valid = [
  'lookup:A.01',
  'lookup:SUB01-P.Dru Un AV2026',
  'lookup:X.Gtr. Ch AV2024 S1',
  'asset:file_A.01',
  'bundle:starter_pack_v1',
  'bundle:recording-index:SUB01-P.Dru Un AV2026:all',
];

for (const token of valid) {
  assert.equal(isAssetReferenceToken(token), true, `token should be valid: ${token}`);
  const parsed = parseAssetReferenceToken(token);
  assert.equal(typeof parsed.kind, 'string');
  assert.equal(typeof parsed.normalized, 'string');
}

const invalid = [
  '',
  '  ',
  'https://drive.google.com/file/d/abc',
  '1AbcDEfGhIJkLmNopqR',
  'lookup:',
  'asset:',
  'bundle:',
  'lookup:bad value with spaces',
  'lookup:foo',
  'asset:??',
  'bundle:??',
  'raw:abc',
];

for (const token of invalid) {
  assert.equal(isAssetReferenceToken(token), false, `token should be invalid: ${token}`);
  assert.throws(() => assertAssetReferenceToken(token), /token|asset reference|lookup|unsupported/i);
}

console.log('test-asset-ref passed');
