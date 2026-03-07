import assert from 'node:assert/strict';
import { normalizeManifestWithFormats } from './lib/entry-store.mjs';

const manifest = { audio: { A: { wav: 'id-a' } }, video: {} };
const out = normalizeManifestWithFormats(manifest, { audio: ['wav', 'mp3'], video: ['1080p'] });
for (const bucket of ['A', 'B', 'C', 'D', 'E', 'X']) {
  assert.equal(typeof out.audio[bucket], 'object');
  assert.equal(typeof out.video[bucket], 'object');
  assert.equal(typeof out.audio[bucket].wav, 'string');
  assert.equal(typeof out.audio[bucket].mp3, 'string');
  assert.equal(typeof out.video[bucket]['1080p'], 'string');
}
assert.equal(out.audio.A.wav, 'id-a');
console.log('ok doctor normalize');
