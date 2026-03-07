import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanEntries } from './lib/doctor.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'dex-doctor-'));
const entriesDir = path.join(tmp, 'entries');
await mkdir(path.join(entriesDir, 'demo'), { recursive: true });
const templatePath = path.join(tmp, 'template.html');
await writeFile(templatePath, `<!doctype html><html><head><title>x</title><script id="dex-sidebar-config" type="application/json">{"downloads":{"formats":{"audio":[{"key":"wav"}],"video":[{"key":"1080p"}]}}}</script><script id="dex-manifest" type="application/json">{}</script><!-- DEX:SIDEBAR_PAGE_CONFIG_START --><script>window.dexSidebarPageConfig = {};</script><!-- DEX:SIDEBAR_PAGE_CONFIG_END --></head><body><!-- DEX:VIDEO_START --><div class="dex-video" data-video-url=""><div class="dex-video-aspect"></div></div><!-- DEX:VIDEO_END --><!-- DEX:DESC_START --><p></p><!-- DEX:DESC_END --></body></html>`, 'utf8');
await writeFile(path.join(entriesDir, 'demo', 'entry.json'), JSON.stringify({ slug: 'demo', title: 'Demo', video: { mode: 'url', dataUrl: 'https://example.com', dataHtml: '<iframe src="https://example.com"></iframe>' }, sidebarPageConfig: { lookupNumber: 'L', buckets: ['A'], attributionSentence: 'A', credits: { artist: [{ name: 'A' }], instruments: ['guitar'], video: { director: [{ name: 'A' }], cinematography: [{ name: 'A' }], editing: [{ name: 'A' }] }, audio: { recording: [{ name: 'A' }], mix: [{ name: 'A' }], master: [{ name: 'A' }] }, year: 2024, season: 'S1', location: 'X' }, fileSpecs: { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } }, metadata: { sampleLength: '', tags: [] } } }, null, 2));
await writeFile(path.join(entriesDir, 'demo', 'description.txt'), 'desc\n', 'utf8');
await writeFile(path.join(entriesDir, 'demo', 'manifest.json'), JSON.stringify({ audio: { A: { wav: '' } }, video: { A: { '1080p': '' } } }, null, 2));
await writeFile(path.join(entriesDir, 'demo', 'index.html'), '<html>stale</html>', 'utf8');

const reports = await scanEntries({ entriesDir, templateArg: templatePath });
assert.ok(reports[0].warnings.some((w) => w.includes('STALE HTML')));
console.log('ok doctor drift');
