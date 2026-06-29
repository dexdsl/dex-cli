#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE_ROOT = process.env.DEX_SITE_ROOT || '/Users/seb/dexdsl.github.io';

function rpc(envelope) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'desktop-rpc.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify(envelope),
    env: { ...process.env, DEX_SITE_ROOT: SITE_ROOT },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.trim().split('\n').filter(Boolean).at(-1);
  const parsed = JSON.parse(line);
  assert.equal(parsed.ok, true, parsed.error);
  return parsed.result;
}

const workspace = rpc({ op: 'hero.read', args: {}, secrets: {} });
assert.equal(workspace.library.version, 'home-hero-library-v1');
assert.equal(typeof workspace.prepared, 'boolean');
assert.ok(workspace.library.modules.length >= 2);

const preview = rpc({
  op: 'hero.preview',
  args: { library: workspace.library, compositionId: workspace.library.activeCompositionId },
  secrets: {},
});
assert.match(preview.html, /id="dexCombined"/);
assert.match(preview.html, /id="dexHeroCard"/);
assert.match(preview.html, /id="dexFeaturedSide"/);

const bridge = fs.readFileSync(path.join(ROOT, 'scripts', 'desktop-rpc.mjs'), 'utf8');
for (const op of ['hero.read', 'hero.save', 'hero.preview', 'hero.prepare']) {
  assert.ok(bridge.includes(`'${op}'`), `missing bridge op ${op}`);
}
const app = fs.readFileSync(path.join(ROOT, 'desktop', 'src', 'App.tsx'), 'utf8');
assert.match(app, /id: "hero", label: "Hero"/);
const screen = fs.readFileSync(path.join(ROOT, 'desktop', 'src', 'screens', 'Hero.tsx'), 'utf8');
assert.match(screen, /Prepare for next deploy/);
assert.match(screen, /sandbox="allow-scripts"/);

console.log('desktop:hero:test passed.');
