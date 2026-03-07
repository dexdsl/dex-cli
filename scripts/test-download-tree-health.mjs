import assert from 'node:assert/strict';
import { buildDownloadTreeHealth } from './lib/download-tree-health.mjs';

const health = buildDownloadTreeHealth({
  lookupNumber: 'P.Pto. Fe AV2024 S2',
  buckets: ['A', 'B'],
  formatKeys: {
    audio: ['wav'],
    video: ['4k'],
  },
  downloadData: {
    audio: {
      A: { wav: 'bundle:lookup:P.Pto. Fe AV2024 S2:A:audio' },
      B: { wav: 'bundle:lookup:P.Pto. Fe AV2024 S2:B:audio' },
    },
    video: {
      A: { '4k': 'bundle:lookup:P.Pto. Fe AV2024 S2:A:video' },
      B: { '4k': 'bundle:lookup:P.Pto. Fe AV2024 S2:B:video' },
    },
    recordingIndexPdfRef: 'asset:pto-recording-index-pdf',
    recordingIndexBundleRef: 'bundle:recording-index:P.Pto. Fe AV2024 S2:all',
    importSummary: {
      rootFolderUrl: 'https://drive.google.com/drive/folders/root',
      bucketFolderUrls: {
        A: 'https://drive.google.com/drive/folders/a',
        B: 'https://drive.google.com/drive/folders/b',
      },
    },
    importedSegments: [
      {
        bucket: 'A',
        bucketNumber: 'A.1',
        type: 'audio',
        fileId: 'a-001',
        driveFileId: 'aaaaaaaaaaa',
        mime: 'audio/wav',
        enabled: true,
      },
      {
        bucket: 'A',
        bucketNumber: 'A.2',
        type: 'video',
        fileId: 'a-002',
        driveFileId: 'bbbbbbbbbbb',
        mime: 'video/quicktime',
        enabled: true,
      },
      {
        bucket: 'B',
        bucketNumber: 'B.1',
        type: 'audio',
        fileId: 'b-001',
        driveFileId: 'ccccccccccc',
        mime: 'audio/wav',
        enabled: true,
      },
      {
        bucket: 'B',
        bucketNumber: 'B.2',
        type: 'video',
        fileId: 'b-002',
        driveFileId: 'ddddddddddd',
        mime: 'video/quicktime',
        enabled: true,
      },
    ],
  },
});

assert.equal(health.summary.ok, true, 'health should pass with complete bundle mapping');
assert.equal(health.summary.criticalCount, 0, 'expected zero critical issues');
assert.equal(health.summary.warnCount, 0, 'expected zero warnings');

const missingRoot = buildDownloadTreeHealth({
  lookupNumber: 'P.Pto. Fe AV2024 S2',
  buckets: ['A'],
  formatKeys: { audio: ['wav'], video: [] },
  downloadData: {
    audio: { A: { wav: 'bundle:lookup:P.Pto. Fe AV2024 S2:A:audio' } },
    video: {},
    recordingIndexPdfRef: 'asset:pto-recording-index-pdf',
    recordingIndexBundleRef: 'bundle:recording-index:P.Pto. Fe AV2024 S2:all',
    importSummary: {
      rootFolderUrl: '',
      bucketFolderUrls: {},
    },
    importedSegments: [{ bucket: 'A', bucketNumber: 'A.1', type: 'audio', fileId: 'a-001', driveFileId: 'aaaaaaaaaaa', enabled: true }],
  },
});

assert.equal(missingRoot.summary.ok, false, 'health should fail when root folder is missing');
assert.ok(
  missingRoot.criticalIssues.some((issue) => issue.includes('A1')),
  'missing root should mention A1',
);

console.log('ok download-tree-health');
