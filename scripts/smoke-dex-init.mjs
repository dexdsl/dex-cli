import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isBackspaceKey, sanitizePastedInputChunk, shouldAppendWizardChar } from './lib/input-guard.mjs';
import { applyKeyToInputState } from './ui/init-wizard.mjs';
import { DEFAULT_ASSET_ORIGIN } from './lib/asset-origin.mjs';
import { assertAnchorOnlyChanges as assertTemplateDrift, injectEntryHtml } from './lib/entry-html.mjs';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-smoke-'));
const tmpl = `<!doctype html><html><head><title>Template</title><link rel="stylesheet" href="/assets/css/dex.css"><script defer src="/assets/vendor/auth0-spa-js.umd.min.js"></script><script defer src="/assets/dex-auth0-config.js"></script></head><body>
<script id="dex-sidebar-config" type="application/json">{"downloads":{"formats":{"audio":[{"key":"wav"}],"video":[{"key":"1080p"}]}}}</script>
<!-- DEX:SIDEBAR_PAGE_CONFIG_START --><script id="dex-sidebar-page-config" type="application/json">{}</script><!-- DEX:SIDEBAR_PAGE_CONFIG_END -->
<!-- DEX:TITLE_START --><h1 class="dex-entry-page-title" data-dex-entry-page-title></h1><!-- DEX:TITLE_END -->
<!-- DEX:VIDEO_START --><div class="dex-video" data-video-url=""><div class="dex-video-aspect"></div></div><!-- DEX:VIDEO_END -->
<!-- DEX:DESC_START --><p>lorem ipsum</p><!-- DEX:DESC_END -->
<script id="dex-manifest" type="application/json">{}</script>
</body></html>`;
await fs.writeFile(path.join(temp, 'index.html'), tmpl, 'utf8');
await fs.writeFile(path.join(temp, 'seed.json'), JSON.stringify({
  title: 'Smoke Title',
  slug: 'smoke-title',
  descriptionText: 'desc',
  video: { dataUrl: 'https://youtu.be/CSFGiU1gg4g?si=x' },
  creditsData: { artist:['Artist'], artistAlt:null, instruments:['Synth'], video:{director:['Dir'],cinematography:['Cin'],editing:['Edit']}, audio:{recording:['Rec'],mix:['Mix'],master:['Master']}, year:2026, season:'S2', location:'Somewhere' },
  manifest: { audio: { A: { wav: 'a1' } }, video: { A: { '1080p': 'v1' } } },
  sidebarPageConfig: { lookupNumber: 'LOOKUP-1', attributionSentence: 'attrib', buckets: ['A','B'], specialEventImage: '/assets/series/dex.png', downloads: { recordingIndexPdfRef: 'lookup:X.99' }, credits: { artist: ['Artist'], instruments: ['Synth'], instrumentLinksEnabled: true, linksByPerson: { Artist: [{ label: 'Site', href: 'https://example.com' }] }, year: 2026, season: 'S2', location: 'Somewhere', video: { director: ['Dir'], cinematography: ['Cin'], editing: ['Edit'] }, audio: { recording: ['Rec'], mix: ['Mix'], master: ['Master'] } } },
}), 'utf8');


const ytInjected = injectEntryHtml(tmpl, {
  descriptionText: 'desc',
  manifest: { audio: { A: { wav: '' }, B: { wav: '' }, C: { wav: '' }, D: { wav: '' }, E: { wav: '' }, X: { wav: '' } }, video: { A: { '1080p': '' }, B: { '1080p': '' }, C: { '1080p': '' }, D: { '1080p': '' }, E: { '1080p': '' }, X: { '1080p': '' } } },
  sidebarConfig: { lookupNumber: 'LOOKUP-1', attributionSentence: 'attrib', buckets: ['A'], specialEventImage: null, credits: { artist: ['Artist'], instruments: ['Synth'], year: 2026, season: 'S2', location: 'Somewhere', video: { director: ['Dir'], cinematography: ['Cin'], editing: ['Edit'] }, audio: { recording: ['Rec'], mix: ['Mix'], master: ['Master'] } }, fileSpecs: { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } }, metadata: { sampleLength: '', tags: [] } },
  lifecycle: { publishedAt: '2024-01-07T00:00:00.000Z', updatedAt: '2026-02-21T00:00:00.000Z' },
  video: { mode: 'url', dataUrl: 'https://youtu.be/CSFGiU1gg4g?si=x', dataHtml: '' },
  title: 'Yt Test',
  authEnabled: true,
});
if (!ytInjected.html.includes('src="https://www.youtube-nocookie.com/embed/CSFGiU1gg4g"')) throw new Error('youtube normalization failed');
if (!ytInjected.html.includes('data-person') || !ytInjected.html.includes('person-pin')) throw new Error('compiled credits pins missing');
const run = (args) => spawnSync('node', [path.join(root, 'scripts/dex.mjs'), ...args], {
  cwd: temp,
  encoding: 'utf8',
  env: {
    ...process.env,
    DEX_WORKSPACE_FILE: path.join(temp, '.dex-workspace-test.json'),
  },
});
const dry = run(['init', '--quick', '--template', './index.html', '--out', './entries', '--from', './seed.json', '--dry-run']);
if (dry.status !== 0) throw new Error(`dry-run failed: ${dry.stderr}\n${dry.stdout}`);
const real = run(['init', '--quick', '--template', './index.html', '--out', './entries', '--from', './seed.json']);
if (real.status !== 0) throw new Error(`write run failed: ${real.stderr}\n${real.stdout}`);

await fs.writeFile(path.join(temp, 'seed-missing-catalog.json'), JSON.stringify({
  title: 'No Linkage',
  slug: 'no-linkage',
  video: { dataUrl: 'https://youtu.be/CSFGiU1gg4g?si=x' },
  sidebarPageConfig: { lookupNumber: '' },
}), 'utf8');
const missingLinkage = run(['init', '--quick', '--template', './index.html', '--out', './entries', '--from', './seed-missing-catalog.json']);
if (missingLinkage.status === 0) throw new Error('init should fail when required catalog linkage fields are missing');
if (!/Catalog linkage requires/i.test(`${missingLinkage.stderr}\n${missingLinkage.stdout}`)) {
  throw new Error('init missing-linkage failure should mention catalog linkage requirements');
}

await fs.writeFile(path.join(temp, 'seed-invalid-recording-index.json'), JSON.stringify({
  title: 'Bad Recording Index',
  slug: 'bad-recording-index',
  video: { dataUrl: 'https://youtu.be/CSFGiU1gg4g?si=x' },
  creditsData: {
    artist: ['Artist'],
    artistAlt: null,
    instruments: ['Synth'],
    video: { director: ['Dir'], cinematography: ['Cin'], editing: ['Edit'] },
    audio: { recording: ['Rec'], mix: ['Mix'], master: ['Master'] },
    year: 2026,
    season: 'S2',
    location: 'Somewhere',
  },
  sidebarPageConfig: {
    lookupNumber: 'LOOKUP-BAD',
    attributionSentence: 'attrib',
    buckets: ['A'],
    credits: {
      artist: ['Artist'],
      instruments: ['Synth'],
      year: 2026,
      season: 'S2',
      location: 'Somewhere',
      video: { director: ['Dir'], cinematography: ['Cin'], editing: ['Edit'] },
      audio: { recording: ['Rec'], mix: ['Mix'], master: ['Master'] },
    },
    downloads: { recordingIndexPdfRef: 'https://drive.google.com/file/d/abc' },
  },
}), 'utf8');
const invalidRecordingIndex = run(['init', '--quick', '--template', './index.html', '--out', './entries', '--from', './seed-invalid-recording-index.json']);
if (invalidRecordingIndex.status === 0) throw new Error('init should fail when recording index token is a URL');
if (!/recording\s*index|recordingIndexPdfRef|asset reference token/i.test(`${invalidRecordingIndex.stderr}\n${invalidRecordingIndex.stdout}`)) {
  throw new Error('init invalid recording-index failure should mention recording-index token validation');
}

const generatedDirs = (await fs.readdir(path.join(temp, 'entries'), { withFileTypes: true })).filter((d) => d.isDirectory());
if (!generatedDirs.length) throw new Error('no generated entry dir');
const generatedSlug = generatedDirs[0].name;
const outHtml = await fs.readFile(path.join(temp, 'entries', generatedSlug, 'index.html'), 'utf8');
assertTemplateDrift(tmpl, outHtml);
for (const needle of [
  'src="https://www.youtube-nocookie.com/embed/CSFGiU1gg4g"',
  'data-video-url="https://youtu.be/CSFGiU1gg4g?si=x"',
  'desc</p>',
  'class="dex-entry-desc-scroll"',
  'id="dex-entry-desc-sync"',
  '<title>synth, artist</title>',
  'LOOKUP-1',
  `${DEFAULT_ASSET_ORIGIN}/assets/css/dex.css`,
  `${DEFAULT_ASSET_ORIGIN}/assets/vendor/auth0-spa-js.umd.min.js`,
  `${DEFAULT_ASSET_ORIGIN}/assets/dex-auth0-config.js`,
  `${DEFAULT_ASSET_ORIGIN}/assets/dex-auth.js`,
  '<script id="dex-sidebar-page-config" type="application/json">',
  'window.dexSidebarPageConfig = JSON.parse(',
  '<script id="dex-manifest" type="application/json">',
]) {
  if (!outHtml.includes(needle)) throw new Error(`missing in output html: ${needle}`);
}

const regionMatch = outHtml.match(/<!-- DEX:VIDEO_START -->([\s\S]*?)<!-- DEX:VIDEO_END -->/);
if (!regionMatch) throw new Error('missing DEX:VIDEO region');
if (!regionMatch[1].includes('<iframe')) throw new Error('DEX:VIDEO region missing iframe');
if (!regionMatch[1].includes('https://www.youtube-nocookie.com/embed/CSFGiU1gg4g')) {
  throw new Error('DEX:VIDEO region missing normalized YouTube embed URL');
}
if (!regionMatch[1].includes('class="dex-video-shell"')) throw new Error('DEX:VIDEO region missing video shell wrapper');
if (regionMatch[1].includes('class="dex-breadcrumb"')) throw new Error('DEX:VIDEO region should not include breadcrumb component');
if (/source_ve_path/i.test(regionMatch[1])) {
  throw new Error('DEX:VIDEO region should not include source_ve_path');
}
const breadcrumbCount = (outHtml.match(/class="dex-breadcrumb"/g) || []).length;
if (breadcrumbCount !== 1) throw new Error(`expected 1 breadcrumb component, found ${breadcrumbCount}`);
const titleRegion = outHtml.match(/<!-- DEX:TITLE_START -->([\s\S]*?)<!-- DEX:TITLE_END -->/);
if (!titleRegion) throw new Error('missing DEX:TITLE region');
if (!titleRegion[1].includes('class="dex-entry-header"')) throw new Error('DEX:TITLE region missing entry header wrapper');
if (!titleRegion[1].includes('class="dex-breadcrumb"')) throw new Error('DEX:TITLE region missing breadcrumb component');
if (!titleRegion[1].includes('class="dex-entry-page-title"')) throw new Error('DEX:TITLE region missing entry page title');
if (!titleRegion[1].includes('synth, artist')) throw new Error('DEX:TITLE region should render canonical display title');
if (!titleRegion[1].includes('class="dex-entry-subtitle"')) throw new Error('DEX:TITLE region missing subtitle row');
if (!titleRegion[1].includes('class="dex-entry-subtitle-label">published')) throw new Error('DEX:TITLE region missing published subtitle item');
if (!titleRegion[1].includes('class="dex-entry-subtitle-label">updated')) throw new Error('DEX:TITLE region missing updated subtitle item');
if (!titleRegion[1].includes('class="dex-entry-subtitle-label">location')) throw new Error('DEX:TITLE region missing location subtitle item');
if (!titleRegion[1].includes('id="dex-breadcrumb-motion-runtime"')) throw new Error('DEX:TITLE region missing breadcrumb motion runtime loader');
if (!titleRegion[1].includes('__dexBreadcrumbMotionRuntimeRequested')) throw new Error('DEX:TITLE region missing breadcrumb motion runtime loader guard');
if (!titleRegion[1].includes('https://dexdsl.github.io/assets/js/dex-breadcrumb-motion.js')) throw new Error('DEX:TITLE region missing breadcrumb motion runtime fallback URL');
if (!titleRegion[1].includes('/assets/js/dex-breadcrumb-motion.js')) throw new Error('DEX:TITLE region missing breadcrumb motion local runtime path');
const descRegion = outHtml.match(/<!-- DEX:DESC_START -->([\s\S]*?)<!-- DEX:DESC_END -->/);
if (!descRegion) throw new Error('missing DEX:DESC region');
if (!descRegion[1].includes('class="dex-entry-desc-scroll"')) throw new Error('DEX:DESC region missing scroll wrapper');
if (!descRegion[1].includes('class="dex-entry-desc-heading"')) throw new Error('DEX:DESC region missing description heading');
if (!descRegion[1].includes('dex-entry-desc-heading-label--base')) throw new Error('DEX:DESC region missing base heading label');
if (!descRegion[1].includes('dex-entry-desc-heading-label--hover')) throw new Error('DEX:DESC region missing hover heading label');
if (!descRegion[1].includes('data-dex-scroll-dot="y"')) throw new Error('DEX:DESC region missing dot-scroll marker');

const outEntry = JSON.parse(await fs.readFile(path.join(temp, 'entries', generatedSlug, 'entry.json'), 'utf8'));
if (!outEntry.lifecycle?.publishedAt || !outEntry.lifecycle?.updatedAt) throw new Error('entry.json missing lifecycle timestamps');
if (!/^\d{4}-\d{2}-\d{2}T/.test(outEntry.lifecycle.publishedAt)) throw new Error('entry.json lifecycle.publishedAt should be ISO datetime');
if (!/^\d{4}-\d{2}-\d{2}T/.test(outEntry.lifecycle.updatedAt)) throw new Error('entry.json lifecycle.updatedAt should be ISO datetime');
if (outEntry.sidebarPageConfig?.downloads?.recordingIndexPdfRef !== 'lookup:X.99') {
  throw new Error('entry.json missing recordingIndexPdfRef in canonical downloads path');
}
if ('recordingIndexPdfRef' in (outEntry.sidebarPageConfig || {})) {
  throw new Error('entry.json should not use legacy sidebarPageConfig.recordingIndexPdfRef field');
}
const initWizardSource = await fs.readFile(path.join(root, 'scripts/ui/init-wizard.mjs'), 'utf8');
if (!initWizardSource.includes("id: 'creditLinks'")) {
  throw new Error('init wizard missing creditLinks step');
}
if (!initWizardSource.includes('linksByPerson') || !initWizardSource.includes('instrumentLinksEnabled')) {
  throw new Error('init wizard missing credit links persistence markers');
}

const catalogPath = path.join(temp, 'data', 'catalog.editorial.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const linkedRow = (catalog.manifest || []).find((row) => row.entry_id === generatedSlug);
if (!linkedRow) throw new Error('dex init should create a linked catalog manifest row');
if (!String(linkedRow.lookup_number || '').trim()) throw new Error('linked catalog row missing lookup_number');
if (!String(linkedRow.entry_href || '').startsWith('/entry/')) throw new Error('linked catalog row missing canonical entry_href');

const cfgMatch = outHtml.match(/<script id="dex-sidebar-config" type="application\/json">([\s\S]*?)<\/script>/);
if (!cfgMatch) throw new Error('missing #dex-sidebar-config script node in output html');
const cfg = JSON.parse(cfgMatch[1]);
const audioKeys = (cfg.downloads?.formats?.audio || []).map((item) => item.key);
const videoKeys = (cfg.downloads?.formats?.video || []).map((item) => item.key);

const manifestNodeMatch = outHtml.match(/<script id="dex-manifest" type="application\/json">([\s\S]*?)<\/script>/);
if (!manifestNodeMatch || !manifestNodeMatch[1].trim()) throw new Error('missing #dex-manifest script node in output html');
const htmlManifest = JSON.parse(manifestNodeMatch[1]);
const pageCfgMatch = outHtml.match(/<script id="dex-sidebar-page-config" type="application\/json">([\s\S]*?)<\/script>/);
if (!pageCfgMatch || !pageCfgMatch[1].trim()) throw new Error('missing #dex-sidebar-page-config script node in output html');
const pageCfg = JSON.parse(pageCfgMatch[1]);
if (String(pageCfg?.downloads?.recordingIndexPdfRef || '') !== 'lookup:X.99') {
  throw new Error('output html missing canonical recordingIndexPdfRef');
}
if ('recordingIndexPdfRef' in (pageCfg || {})) {
  throw new Error('output html should not include legacy top-level recordingIndexPdfRef');
}
for (const bucket of ['A', 'B', 'C', 'D', 'E', 'X']) {
  if (!(bucket in htmlManifest.audio)) throw new Error(`missing html audio bucket: ${bucket}`);
  if (!(bucket in htmlManifest.video)) throw new Error(`missing html video bucket: ${bucket}`);
  for (const key of audioKeys) {
    if (htmlManifest.audio?.[bucket]?.[key] !== '') throw new Error(`expected empty audio manifest value for ${bucket}.${key}`);
  }
  for (const key of videoKeys) {
    if (htmlManifest.video?.[bucket]?.[key] !== '') throw new Error(`expected empty video manifest value for ${bucket}.${key}`);
  }
}

const outManifest = JSON.parse(await fs.readFile(path.join(temp, 'entries', generatedSlug, 'manifest.json'), 'utf8'));
for (const bucket of ['A', 'B', 'C', 'D', 'E', 'X']) {
  if (!(bucket in outManifest.audio)) throw new Error(`missing audio bucket: ${bucket}`);
  if (!(bucket in outManifest.video)) throw new Error(`missing video bucket: ${bucket}`);
}

if (shouldAppendWizardChar('a', { ctrl: false, meta: false }) !== true) throw new Error('input guard should accept printable char');
if (shouldAppendWizardChar('\x1b', { ctrl: false, meta: false }) !== false) throw new Error('input guard should reject ESC char');
if (shouldAppendWizardChar('\x1b[27;5;13~', { ctrl: false, meta: false }) !== false) throw new Error('input guard should reject escape sequences');

if (isBackspaceKey('', { backspace: true }) !== true) throw new Error('backspace helper should accept key.backspace');
if (isBackspaceKey('\x7f', {}) !== true) throw new Error('backspace helper should accept DEL input');
if (isBackspaceKey('a', {}) !== false) throw new Error('backspace helper should reject non-backspace input');
if (isBackspaceKey('\x08', {}) !== true) throw new Error('backspace helper should accept BS input');

{
  const next = applyKeyToInputState({ value: 'abc', cursor: 3 }, '', { backspace: true });
  if (next.value !== 'ab' || next.cursor !== 2) throw new Error('backspace should delete char before cursor');
}
{
  const next = applyKeyToInputState({ value: 'abc', cursor: 3 }, ' pasted text', {}, { allowMultiline: false });
  if (next.value !== 'abc pasted text') throw new Error('single-line paste chunk should insert at cursor');
}
{
  const next = applyKeyToInputState(
    { value: 'abc', cursor: 3 },
    'line1\nline2',
    {},
    { allowMultiline: true },
  );
  if (next.value !== 'abcline1\nline2') throw new Error('multiline paste chunk should preserve newlines');
}
{
  const parsed = sanitizePastedInputChunk('\x1b[200~line1\nline2\x1b[201~', { allowMultiline: true });
  if (parsed !== 'line1\nline2') throw new Error('bracketed paste markers should be removed');
}

const portableTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-smoke-portable-'));
const runPortable = (args) => spawnSync('node', [path.join(root, 'scripts/dex.mjs'), ...args], {
  cwd: portableTemp,
  encoding: 'utf8',
  env: {
    ...process.env,
    DEX_WORKSPACE_FILE: path.join(portableTemp, '.dex-workspace-test.json'),
  },
});
const portable = runPortable(['init', '--quick', '--template', path.join(root, 'entry-template', 'index.html'), '--out', './entries', '--from', path.join(temp, 'seed.json')]);
if (portable.status !== 0) throw new Error(`portable write run failed: ${portable.stderr}\n${portable.stdout}`);
const portableDirs = (await fs.readdir(path.join(portableTemp, 'entries'), { withFileTypes: true })).filter((d) => d.isDirectory());
if (!portableDirs.length) throw new Error('no generated portable entry dir');
const portableHtml = await fs.readFile(path.join(portableTemp, 'entries', portableDirs[0].name, 'index.html'), 'utf8');
for (const needle of [
  `${DEFAULT_ASSET_ORIGIN}/assets/css/dex.css`,
  `${DEFAULT_ASSET_ORIGIN}/assets/vendor/auth0-spa-js.umd.min.js`,
  `${DEFAULT_ASSET_ORIGIN}/assets/dex-auth0-config.js`,
  `${DEFAULT_ASSET_ORIGIN}/assets/dex-auth.js`,
  `${DEFAULT_ASSET_ORIGIN}/assets/dex-sidebar.js`,
]) {
  if (!portableHtml.includes(needle)) throw new Error(`portable output missing runtime URL: ${needle}`);
}
if (!portableHtml.includes('announcement-bar-reserved-space')) {
  throw new Error('portable output missing announcement-bar reserved spacing marker');
}
const hasSqsAnnouncementContract = /class="sqs-announcement-bar-dropzone"[\s\S]*?class="sqs-announcement-bar-custom-location"[\s\S]*?class="yui3-widget sqs-widget sqs-announcement-bar"/.test(portableHtml);
const hasDxAnnouncementContract = /class="dx-announcement-bar-dropzone"[\s\S]*?class="dx-announcement-bar-custom-location"[\s\S]*?class="yui3-widget dx-widget dx-announcement-bar"/.test(portableHtml);
if (!hasSqsAnnouncementContract && !hasDxAnnouncementContract) {
  throw new Error('portable output should place announcement bar inside announcement dropzone with sqs/dx class contract');
}
if (!hasSqsAnnouncementContract) {
  throw new Error('portable output should preserve sqs announcement-bar class family for restored template');
}
for (const needle of [
  'id="scroll-gradient-bg"',
  'id="gooey-mesh-wrapper"',
  'id="dex-entry-gooey-bg-style"',
  'id="dex-entry-gooey-bg-script"',
]) {
  if (!portableHtml.includes(needle)) throw new Error(`portable output missing blob background contract: ${needle}`);
}
if (/id=["']noise["']/i.test(portableHtml) || /url\((["'])#noise\1\)/i.test(portableHtml)) {
  throw new Error('portable output should not include legacy grain filter');
}
const portableVerify = spawnSync('node', [path.join(root, 'scripts/verify-portable-entry-html.mjs')], { cwd: portableTemp, encoding: 'utf8' });
if (portableVerify.status !== 0) {
  throw new Error(`portable verifier failed: ${portableVerify.stderr}\n${portableVerify.stdout}`);
}

console.log('smoke-dex-init ok');
