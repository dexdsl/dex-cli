#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertAssetReferenceTokenKinds } from './lib/asset-ref.mjs';
import { parseRecordingIndexSheetUrl } from './lib/recording-index-import.mjs';
import { sidebarConfigSchema } from './lib/entry-schema.mjs';

function assertThrows(fn, messageFragment) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    const message = String(error?.message || error || '');
    if (messageFragment && !message.includes(messageFragment)) {
      throw new Error(`Expected error to include "${messageFragment}", received "${message}"`);
    }
  }
  if (!threw) throw new Error('Expected function to throw');
}

function makeSidebar(downloads = {}) {
  return {
    lookupNumber: 'SUB01-P.Dru Un AV2026',
    buckets: ['A'],
    specialEventImage: '/assets/series/dex.png',
    attributionSentence: 'attrib',
    credits: {
      artist: ['Artist'],
      artistAlt: null,
      instruments: ['Drumkit'],
      video: { director: ['Dir'], cinematography: ['Cin'], editing: ['Edit'] },
      audio: { recording: ['Rec'], mix: ['Mix'], master: ['Master'] },
      year: 2026,
      season: 'S2',
      location: 'Somewhere',
    },
    fileSpecs: {
      bitDepth: 24,
      sampleRate: 48000,
      channels: 'stereo',
      staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' },
    },
    metadata: {
      sampleLength: '',
      tags: [],
    },
    downloads,
  };
}

try {
  const lookupParsed = assertAssetReferenceTokenKinds(
    'lookup:X.99',
    ['lookup', 'asset'],
    'recording index',
  );
  assert.equal(lookupParsed.kind, 'lookup');
  assert.equal(lookupParsed.value, 'X.99');

  const assetParsed = assertAssetReferenceTokenKinds(
    'asset:recording-index-pdf',
    ['lookup', 'asset'],
    'recording index',
  );
  assert.equal(assetParsed.kind, 'asset');
  assert.equal(assetParsed.value, 'recording-index-pdf');

  assertThrows(() => {
    assertAssetReferenceTokenKinds('bundle:ri-pdf', ['lookup', 'asset'], 'recording index');
  }, 'unsupported token kind');

  assertThrows(() => {
    assertAssetReferenceTokenKinds('https://drive.google.com/file/d/abc', ['lookup', 'asset'], 'recording index');
  }, 'cannot be a URL');

  const validSidebar = sidebarConfigSchema.parse(
    makeSidebar({
      recordingIndexPdfRef: 'lookup:X.99',
      recordingIndexBundleRef: 'bundle:recording-index:SUB01-P.Dru Un AV2026:all',
      recordingIndexSourceUrl: 'https://docs.google.com/spreadsheets/d/example/edit?gid=0#gid=0',
    }),
  );
  assert.equal(validSidebar.downloads.recordingIndexPdfRef, 'lookup:X.99');
  assert.equal(validSidebar.downloads.recordingIndexBundleRef, 'bundle:recording-index:SUB01-P.Dru Un AV2026:all');
  assert.equal(
    validSidebar.downloads.recordingIndexSourceUrl,
    'https://docs.google.com/spreadsheets/d/example/edit?gid=0#gid=0',
  );

  const normalizedDirect = parseRecordingIndexSheetUrl('https://docs.google.com/spreadsheets/d/1jWq1mToYB0exyQTDshjBV2TVCDOLD6epceXWpqJ117Q');
  const normalizedEdit = parseRecordingIndexSheetUrl('https://docs.google.com/spreadsheets/d/1jWq1mToYB0exyQTDshjBV2TVCDOLD6epceXWpqJ117Q/edit');
  assert.equal(
    normalizedDirect.sheetUrl,
    'https://docs.google.com/spreadsheets/d/1jWq1mToYB0exyQTDshjBV2TVCDOLD6epceXWpqJ117Q/edit?gid=0#gid=0',
  );
  assert.equal(normalizedEdit.sheetUrl, normalizedDirect.sheetUrl);

  assertThrows(() => {
    sidebarConfigSchema.parse(
      makeSidebar({ recordingIndexPdfRef: 'bundle:ri-pdf' }),
    );
  }, 'recordingIndexPdfRef must be lookup: or asset: token');

  assertThrows(() => {
    sidebarConfigSchema.parse(
      makeSidebar({ recordingIndexBundleRef: 'asset:rec-pdf-asset' }),
    );
  }, 'recordingIndexBundleRef must be bundle: token');

  assertThrows(() => {
    sidebarConfigSchema.parse(
      makeSidebar({ recordingIndexSourceUrl: 'file:///tmp/recording-index.xlsx' }),
    );
  }, 'recordingIndexSourceUrl must be an http(s) URL');

  assertThrows(() => {
    sidebarConfigSchema.parse(
      makeSidebar({ recordingIndexPdfRef: 'https://drive.google.com/file/d/abc' }),
    );
  }, 'recordingIndexPdfRef must be lookup: or asset: token');

  console.log('test-recording-index-token passed');
} catch (error) {
  console.error(`test-recording-index-token failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
