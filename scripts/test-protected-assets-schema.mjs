import assert from 'node:assert/strict';
import {
  PROTECTED_ASSETS_VERSION,
  normalizeProtectedAssetsFile,
} from './lib/protected-assets-schema.mjs';

function makeValidFixture() {
  return {
    version: PROTECTED_ASSETS_VERSION,
    updatedAt: '2026-02-27T00:00:00.000Z',
    settings: {
      storageBucket: 'dex-protected-assets',
      allowedBuckets: ['A', 'B', 'C', 'D', 'E', 'X'],
      syncStrategy: 'manifest-publish',
    },
    lookups: [
      {
        lookupNumber: 'SUB01-P.Dru Un AV2026',
        title: 'Drumkit Grooves',
        status: 'pending',
        season: 'S2',
        files: [
          {
            bucketNumber: 'A.01',
            bucket: 'A',
            r2Key: 'lookups/SUB01-P.Dru Un AV2026/A.01.wav',
            driveFileId: '1AbcDEfGhIJkLmNopqR',
            sizeBytes: 1024,
            mime: 'audio/wav',
            position: 1,
            type: 'audio',
            availableTypes: ['audio'],
            role: 'media',
            sourceLabel: 'A.01 ste',
          },
        ],
        entitlements: [
          { type: 'auth0_sub', value: 'google-oauth2|101997826000077737521' },
        ],
      },
    ],
  };
}

const valid = normalizeProtectedAssetsFile(makeValidFixture());
assert.equal(valid.version, PROTECTED_ASSETS_VERSION);
assert.equal(valid.lookups.length, 1);
assert.equal(valid.lookups[0].files[0].bucketNumber, 'A.01');
assert.equal(valid.lookups[0].files[0].fileId, 'A.01');
assert.deepEqual(valid.lookups[0].files[0].availableTypes, ['audio']);
assert.equal(valid.lookups[0].files[0].role, 'media');

const catalogLookupFixture = makeValidFixture();
catalogLookupFixture.lookups[0].lookupNumber = 'X.Gtr. Ch AV2024 S1';
const catalogLookup = normalizeProtectedAssetsFile(catalogLookupFixture);
assert.equal(catalogLookup.lookups[0].lookupNumber, 'X.Gtr. Ch AV2024 S1');

const duplicateLookup = makeValidFixture();
duplicateLookup.lookups.push({ ...duplicateLookup.lookups[0] });
assert.throws(() => normalizeProtectedAssetsFile(duplicateLookup), /Duplicate lookupNumber/);

const emptyFiles = makeValidFixture();
emptyFiles.lookups[0].files = [];
assert.throws(() => normalizeProtectedAssetsFile(emptyFiles), /must include at least one file|Array must contain at least 1 element/);

const badBucket = makeValidFixture();
badBucket.lookups[0].files[0].bucket = 'Z';
assert.throws(() => normalizeProtectedAssetsFile(badBucket), /not allowed/);

const duplicateR2 = makeValidFixture();
duplicateR2.lookups[0].files.push({
  bucketNumber: 'A.02',
  bucket: 'A',
  r2Key: 'lookups/SUB01-P.Dru Un AV2026/A.01.wav',
  driveFileId: '1ZyxWVutSRqPonMLkJi',
  sizeBytes: 1024,
  mime: 'audio/wav',
  position: 2,
});
assert.throws(() => normalizeProtectedAssetsFile(duplicateR2), /duplicate r2Key/i);

const badDriveId = makeValidFixture();
badDriveId.lookups[0].files[0].driveFileId = 'bad';
assert.throws(() => normalizeProtectedAssetsFile(badDriveId), /Invalid driveFileId|at least 10 character/);

const blankDriveId = makeValidFixture();
blankDriveId.lookups[0].files.push({
  bucketNumber: 'X.01',
  bucket: 'X',
  fileId: 'recording-index-pdf',
  r2Key: 'lookups/SUB01-P.Dru Un AV2026/recording-index.pdf',
  driveFileId: '',
  sizeBytes: 0,
  mime: 'application/pdf',
  position: 2,
  role: 'recording_index_pdf',
  availableTypes: ['pdf'],
  type: 'pdf',
});
const normalizedBlankDriveId = normalizeProtectedAssetsFile(blankDriveId);
assert.equal(normalizedBlankDriveId.lookups[0].files[1].driveFileId, '');
assert.equal(normalizedBlankDriveId.lookups[0].files[1].role, 'recording_index_pdf');
assert.deepEqual(normalizedBlankDriveId.lookups[0].files[1].availableTypes, ['pdf']);

const badAvailableType = makeValidFixture();
badAvailableType.lookups[0].files[0].availableTypes = ['video', 'guitar'];
assert.throws(() => normalizeProtectedAssetsFile(badAvailableType), /Unsupported availableTypes value/);

console.log('ok protected assets schema');
