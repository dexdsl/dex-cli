import assert from 'node:assert/strict';
import { applySelectedSectionsToDraft } from './ui/update-wizard.mjs';

const baseEntry = {
  slug: 'demo',
  title: 'Original',
  video: { mode: 'url', dataUrl: 'https://example.com/old', dataHtml: '' },
  series: 'dex',
  selectedBuckets: ['A'],
  sidebarPageConfig: {
    lookupNumber: 'SUB01-P.Dru Un AV2026',
    buckets: ['A'],
    attributionSentence: 'Original license text',
    specialEventImage: '/assets/series/dex.png',
    credits: {
      artist: ['Old Artist'],
      artistAlt: null,
      instruments: ['drumkit'],
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
    metadata: { sampleLength: '', tags: ['ambient'] },
  },
  creditsData: {
    artist: ['Old Artist'],
    artistAlt: null,
    instruments: ['drumkit'],
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
  metadata: { tags: ['ambient'] },
};

const baseManifest = {
  audio: { A: { wav: 'old-a' } },
  video: { A: { '1080p': 'old-v' } },
};

const selectedSections = [
  'Lookup #',
  'Video URL',
  'Buckets',
  'Metadata',
  'Downloads',
  'File Specs',
  'Credits / People',
  'Credit Links',
  'Recording Index PDF',
];

const editorValues = {
  'Lookup #': 'SUB02-P.Dru Un AV2026',
  'Video URL': 'https://example.com/new-video',
  Buckets: 'A, B',
  Metadata: 'ambient, drumkit, sessions',
  Downloads: [
    'type,bucket,formatKey,driveId',
    'audio,A,wav,new-a',
    'video,A,1080p,new-v',
    'audio,B,wav,new-b',
    'video,B,1080p,new-vb',
  ].join('\n'),
  'File Specs': JSON.stringify({ bitDepth: 32, sampleRate: 96000, channels: 'mono' }),
  'Recording Index PDF': 'asset:rec-pdf-1',
  'Credits / People': JSON.stringify({
    artist: ['Updated Artist'],
    artistAlt: null,
    instruments: ['drumkit', 'percussion'],
    video: { director: ['New Dir'], cinematography: ['New Cin'], editing: ['New Edit'] },
    audio: { recording: ['New Rec'], mix: ['New Mix'], master: ['New Master'] },
    year: 2027,
    season: 'S3',
    location: 'Dex Hall',
  }),
  'Credit Links': JSON.stringify({
    instrumentLinksEnabled: true,
    linksByPerson: {
      'Updated Artist': [{ label: 'Site', href: 'https://example.com/artist' }],
      percussion: [{ label: 'Docs', href: 'https://example.com/percussion' }],
    },
  }),
};

const { entry, manifest, descriptionText } = applySelectedSectionsToDraft({
  entry: baseEntry,
  manifest: baseManifest,
  selectedSections,
  editorValues,
  formatKeys: { audio: ['wav'], video: ['1080p'] },
});

assert.equal(entry.sidebarPageConfig.lookupNumber, 'SUB02-P.Dru Un AV2026');
assert.equal(entry.video.dataUrl, 'https://example.com/new-video');
assert.deepEqual(entry.selectedBuckets, ['A', 'B']);
assert.deepEqual(entry.sidebarPageConfig.buckets, ['A', 'B']);
assert.deepEqual(entry.metadata.tags, ['ambient', 'drumkit', 'sessions']);
assert.deepEqual(entry.sidebarPageConfig.metadata.tags, ['ambient', 'drumkit', 'sessions']);
assert.equal(manifest.audio.A.wav, 'new-a');
assert.equal(manifest.video.A['1080p'], 'new-v');
assert.equal(manifest.audio.B.wav, 'new-b');
assert.equal(manifest.video.B['1080p'], 'new-vb');
assert.equal(entry.fileSpecs.bitDepth, 32);
assert.equal(entry.fileSpecs.sampleRate, 96000);
assert.equal(entry.fileSpecs.channels, 'mono');
assert.equal(entry.sidebarPageConfig.fileSpecs.channels, 'mono');
assert.deepEqual(entry.creditsData.artist, ['Updated Artist']);
assert.deepEqual(entry.sidebarPageConfig.credits.artist, ['Updated Artist']);
assert.deepEqual(entry.sidebarPageConfig.credits.audio.mix, ['New Mix']);
assert.equal(entry.sidebarPageConfig.credits.season, 'S3');
assert.equal(entry.sidebarPageConfig.credits.instrumentLinksEnabled, true);
assert.equal(entry.sidebarPageConfig.credits.linksByPerson['Updated Artist'][0].label, 'Site');
assert.equal(entry.sidebarPageConfig.downloads.recordingIndexPdfRef, 'asset:rec-pdf-1');
assert.equal(descriptionText, '');

const untouched = applySelectedSectionsToDraft({
  entry: baseEntry,
  manifest: baseManifest,
  selectedSections: ['Title'],
  editorValues: { Title: 'Retitled' },
  formatKeys: { audio: ['wav'], video: ['1080p'] },
});
assert.equal(untouched.entry.title, 'Retitled');
assert.equal(untouched.entry.sidebarPageConfig.lookupNumber, baseEntry.sidebarPageConfig.lookupNumber);

console.log('ok update flow');
