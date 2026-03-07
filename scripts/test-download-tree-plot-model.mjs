#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildDownloadTreePlotModelFromHealth,
  buildDownloadTreePlotModelFromInventory,
} from './lib/download-tree-plot-model.mjs';

function main() {
  const healthModel = buildDownloadTreePlotModelFromHealth({
    summary: {
      criticalCount: 1,
      warnCount: 2,
      totalFiles: 4,
      enabledFiles: 4,
      bucketCount: 2,
    },
    root: { ok: true },
    buckets: [
      { bucket: 'A', fileCount: 2, audioCount: 1, videoCount: 1, pdfCount: 0, unknownCount: 0, folderLinkOk: true },
      { bucket: 'X', fileCount: 2, audioCount: 0, videoCount: 0, pdfCount: 1, unknownCount: 1, folderLinkOk: false },
    ],
    files: [
      { bucket: 'A', type: 'audio', availableTypes: ['audio', 'video'], mime: 'audio/wav', r2Key: 'a/001.wav', fileId: 'A.1' },
      { bucket: 'A', type: 'video', mime: 'video/quicktime', r2Key: 'a/001.mov', fileId: 'A.2' },
      { bucket: 'X', type: 'pdf', role: 'recording_index_pdf', mime: 'application/pdf', r2Key: 'x/index.pdf', fileId: 'X.1' },
      { bucket: 'X', type: 'unknown', mime: '', r2Key: 'x/data.bin', fileId: 'X.2' },
    ],
    bundles: [
      { bucket: 'A', type: 'audio', hasSegments: true, ok: true },
      { bucket: 'A', type: 'video', hasSegments: true, ok: false },
    ],
    recordingIndex: {
      pdf: { ok: true, raw: 'asset:rec-index' },
      bundle: { ok: false, raw: 'bundle:recording-index:foo:all' },
    },
    criticalIssues: ['missing bundle token'],
    warnIssues: ['missing folder link'],
  });

  assert.equal(healthModel.summary.totalFiles, 4);
  assert.equal(healthModel.root.ok, true);
  assert(healthModel.associatedTypes.families.some((row) => row.label === 'audio' && row.count === 1));
  assert(healthModel.associatedTypes.families.some((row) => row.label === 'video' && row.count === 2));
  assert(healthModel.associatedTypes.families.some((row) => row.label === 'pdf' && row.count === 1));
  assert(healthModel.physicalTypes.families.some((row) => row.label === 'video' && row.count === 1));
  assert.equal(healthModel.bundleRows.length, 1);
  assert.equal(healthModel.bundleRows[0].bucket, 'A');

  const inventoryModel = buildDownloadTreePlotModelFromInventory({
    recordingIndex: {
      pdfTokenRaw: 'asset:pdf-file',
      bundleTokenRaw: 'bundle:recording-index:lookup:all',
    },
    downloadTree: {
      rootFolderUrl: 'https://drive.google.com/folders/root',
      criticalCount: 0,
      warnCount: 1,
      fileCount: 3,
      pdfCoverage: 'ok',
      bundleCoverage: 'partial',
      bucketFolderLinks: [
        { bucket: 'A', ok: true },
      ],
      files: [
        { bucket: 'A', type: 'audio', availableTypes: ['audio', 'video'], mime: 'audio/mpeg', r2Key: 'a/001.mp3' },
        { bucket: 'A', type: 'video', mime: 'video/quicktime', r2Key: 'a/001.mov' },
        { bucket: 'X', type: 'pdf', role: 'recording_index_pdf', mime: 'application/pdf', r2Key: 'a/index.pdf' },
      ],
      criticalIssues: [],
      warnIssues: ['1 file(s) missing driveFileId'],
    },
  });

  assert.equal(inventoryModel.root.ok, true);
  assert.equal(inventoryModel.recording.pdf.ok, true);
  assert.equal(inventoryModel.recording.bundle.ok, false);
  assert(inventoryModel.associatedTypes.subtypes.some((row) => row.label === 'mp3'));
  assert(inventoryModel.physicalTypes.families.some((row) => row.label === 'pdf' && row.count === 1));
  assert.equal(inventoryModel.bundleRows.length, 1);
  assert.equal(inventoryModel.bundleRows[0].audio.present, true);
  assert.equal(inventoryModel.bundleRows[0].video.present, true);

  console.log('test-download-tree-plot-model passed');
}

try {
  main();
} catch (error) {
  console.error(`test-download-tree-plot-model failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
