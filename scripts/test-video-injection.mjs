import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatBreadcrumbCurrentLabel, injectEntryHtml, resolveBreadcrumbBackStrategy } from './lib/entry-html.mjs';

const root = process.cwd();
const templatePath = path.join(root, 'entry-template', 'index.html');
const templateHtml = await fs.readFile(templatePath, 'utf8');

const videoUrl = 'https://www.youtube.com/watch?v=CSFGiU1gg4g';
const schemelessVideoUrl = 'www.youtube.com/watch?v=CSFGiU1gg4g';
const lifecycle = {
  publishedAt: '2024-01-07T00:00:00.000Z',
  updatedAt: '2026-02-21T00:00:00.000Z',
};

const injected = injectEntryHtml(templateHtml, {
  descriptionText: 'Video injection test',
  descriptionHtml: '',
  manifest: {
    audio: {
      A: { wav: '' },
      B: { wav: '' },
      C: { wav: '' },
      D: { wav: '' },
      E: { wav: '' },
      X: { wav: '' },
    },
    video: {
      A: { '1080p': '' },
      B: { '1080p': '' },
      C: { '1080p': '' },
      D: { '1080p': '' },
      E: { '1080p': '' },
      X: { '1080p': '' },
    },
  },
  sidebarConfig: {
    lookupNumber: 'LOOKUP-TEST',
    attributionSentence: 'Attribution',
    buckets: ['A'],
    specialEventImage: '/assets/series/dex.png',
    credits: {
      artist: ['Artist'],
      artistAlt: null,
      instruments: ['Instrument'],
      video: { director: ['Director'], cinematography: ['Cinematography'], editing: ['Editing'] },
      audio: { recording: ['Recording'], mix: ['Mix'], master: ['Master'] },
      year: 2026,
      season: 'S1',
      location: 'Somewhere',
    },
    fileSpecs: {
      bitDepth: 24,
      sampleRate: 48000,
      channels: 'stereo',
      staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' },
    },
    metadata: { sampleLength: '', tags: [] },
  },
  lifecycle,
  video: { mode: 'url', dataUrl: videoUrl, dataHtml: '' },
  title: 'Video Test',
  authEnabled: false,
}).html;

const videoRegionMatch = injected.match(/<!-- DEX:VIDEO_START -->([\s\S]*?)<!-- DEX:VIDEO_END -->/);
assert.ok(videoRegionMatch, 'DEX:VIDEO region missing');
const videoRegion = videoRegionMatch[1];
const descRegionMatch = injected.match(/<!-- DEX:DESC_START -->([\s\S]*?)<!-- DEX:DESC_END -->/);
assert.ok(descRegionMatch, 'DEX:DESC region missing');
const descRegion = descRegionMatch[1];
const titleRegionMatch = injected.match(/<!-- DEX:TITLE_START -->([\s\S]*?)<!-- DEX:TITLE_END -->/);
assert.ok(titleRegionMatch, 'DEX:TITLE region missing');
const titleRegion = titleRegionMatch[1];

assert.match(videoRegion, /class="dex-video-shell"/);
assert.match(videoRegion, /class="dex-video"/);
assert.match(videoRegion, /data-video-url="https:\/\/www\.youtube\.com\/watch\?v=CSFGiU1gg4g"/);
assert.match(videoRegion, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/CSFGiU1gg4g"/);
assert.match(videoRegion, /loading="lazy"/);
assert.match(videoRegion, /referrerpolicy="strict-origin-when-cross-origin"/);
assert.doesNotMatch(videoRegion, /\bstyle=/i);
assert.doesNotMatch(videoRegion, /source_ve_path/i);
assert.doesNotMatch(videoRegion, /class="dex-breadcrumb"/);
assert.match(titleRegion, /class="dex-entry-header"/);
assert.match(titleRegion, /class="dex-breadcrumb-overlay"/);
assert.match(titleRegion, /class="dex-breadcrumb"/);
assert.match(titleRegion, /class="dex-breadcrumb-current">instrument, artist<\/span>/);
assert.match(titleRegion, /class="dex-breadcrumb-delimiter"[^>]*>/);
assert.match(titleRegion, /class="dex-breadcrumb-icon"/);
assert.match(titleRegion, /data-dex-breadcrumb-path/);
assert.match(titleRegion, /id="dex-breadcrumb-back-script"/);
assert.match(titleRegion, /id="dex-breadcrumb-motion-bootstrap"/);
assert.match(titleRegion, /id="dex-breadcrumb-motion-runtime"/);
assert.match(titleRegion, /__dexBreadcrumbMotionRuntimeRequested/);
assert.match(titleRegion, /https:\/\/dexdsl\.github\.io\/assets\/js\/dex-breadcrumb-motion\.js/);
assert.match(titleRegion, /\/assets\/js\/dex-breadcrumb-motion\.js/);
assert.match(titleRegion, /window\.history\.back\(\)/);
assert.match(titleRegion, /href="\/catalog"/);
assert.match(titleRegion, /class="dex-entry-page-title"/);
assert.match(titleRegion, /data-dex-entry-page-title/);
assert.match(titleRegion, />instrument, artist</);
assert.match(titleRegion, /class="dex-entry-subtitle"/);
assert.match(titleRegion, /class="dex-entry-subtitle-label">published</);
assert.match(titleRegion, /class="dex-entry-subtitle-label">updated</);
assert.match(titleRegion, /class="dex-entry-subtitle-label">location</);
assert.match(titleRegion, /datetime="2024-01-07T00:00:00.000Z">jan 7, 2024</);
assert.match(titleRegion, /datetime="2026-02-21T00:00:00.000Z">feb 21, 2026</);
assert.match(titleRegion, />Somewhere</);
assert.match(injected, /<title>instrument, artist<\/title>/i);
assert.match(descRegion, /class="dex-entry-desc-scroll"/);
assert.match(descRegion, /class="dex-entry-desc-heading"/);
assert.match(descRegion, /class="dex-entry-desc-heading-label dex-entry-desc-heading-label--base">description<\/span>/);
assert.match(descRegion, /class="dex-entry-desc-heading-label dex-entry-desc-heading-label--hover"[^>]*>dexcription<\/span>/);
assert.match(descRegion, /class="dex-entry-desc-heading-gap"/);
assert.match(descRegion, /data-dex-scroll-dot="y"/);
assert.match(descRegion, /class="dex-entry-desc-content"/);
assert.match(descRegion, /id="dex-entry-desc-sync"/);

assert.doesNotMatch(videoRegion, /dx-video-wrapper/i);
assert.doesNotMatch(videoRegion, /data-html="&lt;iframe/i);

const injectedSchemeless = injectEntryHtml(templateHtml, {
  descriptionText: 'Video injection test',
  descriptionHtml: '',
  manifest: {
    audio: { A: { wav: '' }, B: { wav: '' }, C: { wav: '' }, D: { wav: '' }, E: { wav: '' }, X: { wav: '' } },
    video: { A: { '1080p': '' }, B: { '1080p': '' }, C: { '1080p': '' }, D: { '1080p': '' }, E: { '1080p': '' }, X: { '1080p': '' } },
  },
  sidebarConfig: {
    lookupNumber: 'LOOKUP-TEST',
    attributionSentence: 'Attribution',
    buckets: ['A'],
    specialEventImage: '/assets/series/dex.png',
    credits: {
      artist: ['Artist'],
      artistAlt: null,
      instruments: ['Instrument'],
      video: { director: ['Director'], cinematography: ['Cinematography'], editing: ['Editing'] },
      audio: { recording: ['Recording'], mix: ['Mix'], master: ['Master'] },
      year: 2026,
      season: 'S1',
      location: 'Somewhere',
    },
    fileSpecs: { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } },
    metadata: { sampleLength: '', tags: [] },
  },
  lifecycle,
  video: { mode: 'url', dataUrl: schemelessVideoUrl, dataHtml: '' },
  title: 'Video Test',
  authEnabled: false,
}).html;
assert.match(injectedSchemeless, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/CSFGiU1gg4g"/);
assert.match(injectedSchemeless, /<title>instrument, artist<\/title>/i);

const injectedTitleFallback = injectEntryHtml(tmplWithoutTitleAnchor(templateHtml), {
  descriptionText: 'Video injection test',
  descriptionHtml: '',
  manifest: {
    audio: { A: { wav: '' }, B: { wav: '' }, C: { wav: '' }, D: { wav: '' }, E: { wav: '' }, X: { wav: '' } },
    video: { A: { '1080p': '' }, B: { '1080p': '' }, C: { '1080p': '' }, D: { '1080p': '' }, E: { '1080p': '' }, X: { '1080p': '' } },
  },
  sidebarConfig: {
    lookupNumber: 'LOOKUP-TEST',
    attributionSentence: 'Attribution',
    buckets: ['A'],
    specialEventImage: '/assets/series/dex.png',
    credits: {
      artist: ['Artist'],
      artistAlt: null,
      instruments: ['Instrument'],
      video: { director: ['Director'], cinematography: ['Cinematography'], editing: ['Editing'] },
      audio: { recording: ['Recording'], mix: ['Mix'], master: ['Master'] },
      year: 2026,
      season: 'S1',
      location: 'Somewhere',
    },
    fileSpecs: { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } },
    metadata: { sampleLength: '', tags: [] },
  },
  lifecycle,
  video: { mode: 'url', dataUrl: schemelessVideoUrl, dataHtml: '' },
  title: 'Fallback Nav Title',
  authEnabled: false,
}).html;
assert.match(injectedTitleFallback, /class="dex-entry-header"[^>]*>[\s\S]*class="dex-entry-page-title" data-dex-entry-page-title>instrument, artist<\/h1>[\s\S]*<div class="dex-entry-layout">/i);
assert.match(injectedTitleFallback, /<title>instrument, artist<\/title>/i);

const injectedCanonicalFallback = injectEntryHtml(tmplWithoutTitleAnchor(templateHtml), {
  descriptionText: 'Video injection test',
  descriptionHtml: '',
  manifest: {
    audio: { A: { wav: '' }, B: { wav: '' }, C: { wav: '' }, D: { wav: '' }, E: { wav: '' }, X: { wav: '' } },
    video: { A: { '1080p': '' }, B: { '1080p': '' }, C: { '1080p': '' }, D: { '1080p': '' }, E: { '1080p': '' }, X: { '1080p': '' } },
  },
  sidebarConfig: {
    lookupNumber: 'LOOKUP-TEST',
    attributionSentence: 'Attribution',
    buckets: ['A'],
    specialEventImage: '/assets/series/dex.png',
    credits: {
      artist: [''],
      artistAlt: null,
      instruments: [''],
      video: { director: ['Director'], cinematography: ['Cinematography'], editing: ['Editing'] },
      audio: { recording: ['Recording'], mix: ['Mix'], master: ['Master'] },
      year: 2026,
      season: 'S1',
      location: 'Somewhere',
    },
    fileSpecs: { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } },
    metadata: { sampleLength: '', tags: [] },
  },
  canonical: { instrument: '', artistName: '' },
  creditsData: { artist: [''], instruments: [''], video: { director: ['D'], cinematography: ['C'], editing: ['E'] }, audio: { recording: ['R'], mix: ['M'], master: ['M'] }, year: 2026, season: 'S1', location: 'Somewhere', artistAlt: null },
  lifecycle,
  video: { mode: 'url', dataUrl: schemelessVideoUrl, dataHtml: '' },
  title: 'Fallback Nav Title',
  authEnabled: false,
}).html;
assert.match(injectedCanonicalFallback, /<title>fallback nav title<\/title>/i);

const videoEndIx = injected.indexOf('<!-- DEX:VIDEO_END -->');
const descStartIx = injected.indexOf('<!-- DEX:DESC_START -->');
const asideCloseIx = injected.indexOf('</aside>');
assert.ok(videoEndIx >= 0 && descStartIx >= 0 && videoEndIx < descStartIx, 'DEX:VIDEO must come before DEX:DESC');
assert.ok(videoEndIx >= 0 && asideCloseIx >= 0 && videoEndIx < asideCloseIx, 'DEX:VIDEO must be inside main column before closing </aside>');
assert.ok(titleRegion.indexOf('class="dex-breadcrumb"') >= 0, 'breadcrumb should render in title region');
assert.ok(titleRegion.indexOf('class="dex-entry-page-title"') > titleRegion.indexOf('class="dex-breadcrumb"'), 'title should render after breadcrumb');
assert.ok(titleRegion.indexOf('class="dex-entry-subtitle"') > titleRegion.indexOf('class="dex-entry-page-title"'), 'subtitle should render after title');

assert.equal(formatBreadcrumbCurrentLabel({ instrument: 'GUITAR AND VOICE', artistName: 'Aidan Yeats' }), 'guitar and voice, aidan yeats');
assert.deepEqual(
  resolveBreadcrumbBackStrategy({
    referrer: 'http://localhost:4173/catalog',
    locationOrigin: 'http://localhost:4173',
    locationPath: '/view/123',
    historyLength: 2,
  }),
  { useHistoryBack: true, fallbackHref: '/catalog' },
);
assert.deepEqual(
  resolveBreadcrumbBackStrategy({
    referrer: 'https://dexdsl.github.io/catalog',
    locationOrigin: 'http://localhost:4173',
    locationPath: '/view/123',
    historyLength: 2,
  }),
  { useHistoryBack: false, fallbackHref: '/catalog' },
);

console.log('test-video-injection ok');

function tmplWithoutTitleAnchor(html) {
  return String(html || '').replace(/<!-- DEX:TITLE_START -->[\s\S]*?<!-- DEX:TITLE_END -->\s*/i, '');
}
