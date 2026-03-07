#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditEntryRuntime } from './lib/entry-runtime-audit.mjs';

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-entry-audit-'));
  const entriesDir = path.join(tempRoot, 'entries');
  const dataDir = path.join(tempRoot, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(entriesDir, 'valid'), { recursive: true });
  await fs.mkdir(path.join(entriesDir, 'invalid'), { recursive: true });
  await fs.mkdir(path.join(entriesDir, 'missing-rec'), { recursive: true });

  const validHtml = `<!doctype html><html><head>
  <script defer src="/assets/vendor/auth0-spa-js.umd.min.js"></script>
  <script defer src="/assets/dex-auth0-config.js"></script>
  <script defer src="/assets/dex-auth.js"></script>
  </head><body>
  <div id="scroll-gradient-bg"></div>
  <div id="gooey-mesh-wrapper"></div>
  <div class="dex-breadcrumb"></div>
  <script id="dex-sidebar-config" type="application/json">{ "downloads": {} }</script>
  <script id="dex-sidebar-page-config" type="application/json">{ "downloads": { "recordingIndexPdfRef": "asset:rec-pdf-1", "recordingIndexBundleRef": "bundle:recording-index:SUB01-P.Dru Un AV2026:all", "recordingIndexSourceUrl": "https://docs.google.com/spreadsheets/d/example/edit?gid=0#gid=0" } }</script>
  <script id="dex-manifest" type="application/json">{ "audio": { "A": { "wav": "lookup:A.01" } }, "video": {} }</script>
  </body></html>`;

  const invalidHtml = `<!doctype html><html><head>
  <script defer src="/assets/vendor/auth0-spa-js.umd.min.js"></script>
  </head><body>
  <script id="dex-manifest" type="application/json">{ "audio": { "A": { "wav": "1AbcDEfGhIJkLmNopqR" } } }</script>
  <script id="dex-sidebar-config" type="application/json">{ "downloads": { "driveBase": "https://drive.google.com/drive/u/0/folders" } }</script>
  </body></html>`;

  const missingRecordingHtml = `<!doctype html><html><head>
  <script defer src="/assets/vendor/auth0-spa-js.umd.min.js"></script>
  <script defer src="/assets/dex-auth0-config.js"></script>
  <script defer src="/assets/dex-auth.js"></script>
  </head><body>
  <div id="scroll-gradient-bg"></div>
  <div id="gooey-mesh-wrapper"></div>
  <div class="dex-breadcrumb"></div>
  <script id="dex-sidebar-config" type="application/json">{ "downloads": {} }</script>
  <script id="dex-sidebar-page-config" type="application/json">{}</script>
  <script id="dex-manifest" type="application/json">{ "audio": { "A": { "wav": "lookup:A.01" } }, "video": {} }</script>
  </body></html>`;

  await fs.writeFile(path.join(entriesDir, 'valid', 'index.html'), validHtml, 'utf8');
  await fs.writeFile(path.join(entriesDir, 'invalid', 'index.html'), invalidHtml, 'utf8');
  await fs.writeFile(path.join(entriesDir, 'missing-rec', 'index.html'), missingRecordingHtml, 'utf8');

  await fs.writeFile(path.join(dataDir, 'catalog.entries.json'), JSON.stringify({
    entries: [
      {
        id: 'valid',
        entry_href: '/entry/valid/',
        lookup_raw: 'SUB01-P.Dru Un AV2026',
        season: 'S2',
        performer_raw: 'Test Artist',
        instrument_labels: ['Drumkit'],
      },
      {
        id: 'catalog-only',
        entry_href: '/entry/catalog-only/',
        lookup_raw: 'SUB02-P.Dru Un AV2026',
        season: 'S2',
        performer_raw: 'Catalog Only',
        instrument_labels: ['Drumkit'],
      },
      {
        id: 'missing-rec',
        entry_href: '/entry/missing-rec/',
        lookup_raw: 'SUB03-P.Dru Un AV2026',
        season: 'S2',
        performer_raw: 'Missing Recording PDF',
        instrument_labels: ['Drumkit'],
      },
    ],
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(dataDir, 'catalog.editorial.json'), JSON.stringify({
    version: 'catalog-editorial-v1',
    updatedAt: new Date().toISOString(),
    manifest: [],
    spotlight: {},
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(dataDir, 'protected.assets.json'), JSON.stringify({
    version: 'protected-assets-v1',
    updatedAt: new Date().toISOString(),
    settings: {
      storageBucket: 'dex-protected-assets',
      allowedBuckets: ['A', 'B', 'C', 'D', 'E', 'X'],
      syncStrategy: 'manifest-publish',
    },
    lookups: [
      {
        lookupNumber: 'SUB01-P.Dru Un AV2026',
        status: 'active',
        season: 'S2',
        files: [
          {
            bucketNumber: 'A.1',
            fileId: 'A.1',
            bucket: 'A',
            r2Key: 'sub01/a1.mov',
            driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
            mime: 'video/*',
            type: 'video',
            availableTypes: ['audio', 'video'],
            sourceLabel: 'A.1 4K | 1080p | ste',
            position: 1,
          },
          {
            bucketNumber: 'X.1',
            fileId: 'rec-pdf-1',
            bucket: 'X',
            r2Key: 'sub01/recording-index.pdf',
            mime: 'application/pdf',
            driveFileId: '1ZZZdEfGhIjKlMnOpQrStUvWxYz',
            role: 'recording_index_pdf',
            availableTypes: ['pdf'],
            type: 'pdf',
            position: 2,
          },
        ],
        entitlements: [{ type: 'public', value: 'true' }],
        recordingIndex: {
          sheetUrl: 'https://docs.google.com/spreadsheets/d/example/edit?gid=0#gid=0',
          sheetId: 'example',
          gid: '0',
          pdfAssetId: 'rec-pdf-1',
          bundleAllToken: 'bundle:recording-index:SUB01-P.Dru Un AV2026:all',
        },
      },
      {
        lookupNumber: 'SUB03-P.Dru Un AV2026',
        status: 'active',
        season: 'S2',
        files: [
          {
            bucketNumber: 'A.2',
            fileId: 'A.2',
            bucket: 'A',
            r2Key: 'sub03/a2.wav',
            driveFileId: '1MNZdEfGhIjKlMnOpQrStUvWxYz',
            position: 1,
          },
        ],
        entitlements: [{ type: 'public', value: 'true' }],
      },
    ],
    exemptions: [],
  }, null, 2), 'utf8');

  const result = await auditEntryRuntime({
    entriesDir,
    all: true,
    includeLegacy: true,
    catalogEntriesFile: path.join(dataDir, 'catalog.entries.json'),
    catalogEditorialFile: path.join(dataDir, 'catalog.editorial.json'),
    protectedAssetsFile: path.join(dataDir, 'protected.assets.json'),
  });

  const valid = result.reports.find((row) => row.slug === 'valid');
  const invalid = result.reports.find((row) => row.slug === 'invalid');
  const missingRecording = result.reports.find((row) => row.slug === 'missing-rec');
  assert(valid && valid.ok, 'valid entry should pass audit');
  assert(invalid && !invalid.ok, 'invalid entry should fail audit');
  assert(missingRecording && !missingRecording.ok, 'missing-rec entry should fail audit');
  assert(invalid.issues.some((issue) => issue.includes('unsupported token')), 'invalid entry should report unsupported token');
  assert(invalid.issues.some((issue) => issue.includes('driveBase')), 'invalid entry should report driveBase');
  assert(
    missingRecording.issues.some((issue) => issue.includes('recording index pdf token is required')),
    'missing-rec entry should report missing recording index requirement',
  );
  const inventoryRows = result.inventory.rows;
  const validInventory = inventoryRows.find((row) => row.entryId === 'valid');
  const catalogOnlyInventory = inventoryRows.find((row) => row.entryId === 'catalog-only');
  assert(validInventory, 'valid inventory row should exist');
  assert(catalogOnlyInventory, 'catalog-only inventory row should exist');
  assert.equal(validInventory.state, 'linked', 'valid should be linked because entry page and catalog row exist');
  assert.equal(catalogOnlyInventory.state, 'catalog-only', 'catalog-only row should be catalog-only');
  assert.deepEqual(validInventory.assets.buckets, ['A.1'], 'valid row should include mapped media buckets only');
  assert.deepEqual(validInventory.assets.fileIds, ['A.1', 'rec-pdf-1'], 'valid row should include mapped file ids');
  assert.equal(validInventory.recordingIndex.pdfValid, true, 'valid row should keep recording pdf token');
  assert.equal(validInventory.recordingIndex.bundleValid, true, 'valid row should keep recording bundle token');
  assert.equal(validInventory.recordingIndex.resolved, true, 'valid row should resolve recording token');
  assert.equal(validInventory.recordingIndex.pdfLike, true, 'valid row recording asset should be pdf-like');
  assert.equal(validInventory.recordingIndex.bundleResolved, true, 'valid row should resolve recording bundle token');
  assert(Array.isArray(validInventory.downloadTree.files), 'valid row should include download tree file rows');
  assert(validInventory.downloadTree.files.some((file) => file.type === 'pdf'), 'download tree should include pdf family');
  assert(Array.isArray(validInventory.downloadTree.bundleRows), 'download tree should include bundle rows');
  assert(validInventory.downloadTree.bundleRows.some((row) => row.bucket === 'A'), 'download tree bundle rows should include bucket A');
  assert(!validInventory.downloadTree.bundleRows.some((row) => row.bucket === 'X'), 'download tree bundle rows should exclude recording-index bucket');
  assert((validInventory.downloadTree.associatedTypeCounts?.audio || 0) >= 1, 'associated type counts should include audio from availableTypes');
  console.log('test-entry-runtime-audit passed');
}

main().catch((error) => {
  console.error(`test-entry-runtime-audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
