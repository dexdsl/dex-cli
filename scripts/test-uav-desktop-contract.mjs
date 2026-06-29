#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const entries = fs.readFileSync(path.join(root, 'desktop/src/screens/Entries.tsx'), 'utf8');
const uav = fs.readFileSync(path.join(root, 'desktop/src/screens/UavEntry.tsx'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'desktop/src/components/SidebarPreview.tsx'), 'utf8');
const rpc = fs.readFileSync(path.join(root, 'scripts/desktop-rpc.mjs'), 'utf8');

for (const marker of [
  'role="dialog"',
  'aria-modal="true"',
  'aria-labelledby="entry-kind-title"',
  'event.key === "Escape"',
  'event.key === "Tab"',
  'catalogRef.current?.focus()',
  'Dex catalog',
  'dex, dexFest, or inDex',
  'dexDRONES',
  'UAV location collection',
]) {
  assert.ok(entries.includes(marker), `New-entry modal is missing ${marker}`);
}
assert.ok(entries.includes('rpc<{ entries: EntryListItem[] }>("uav.list")'), 'Entry list does not merge UAV rows');
assert.ok(entries.includes('!uavSlugs.has(row.slug)'), 'Entry list does not suppress legacy standard rows migrated to UAV');
assert.ok(entries.includes('item.kind === "uav"'), 'Entry rows do not dispatch typed UAV records');

for (const tab of ['"overview"', '"downloads"', '"credits"', '"metadata"']) {
  assert.ok(uav.includes(tab), `UAV editor is missing ${tab} tab`);
}
for (const marker of [
  'form.captureClass !== "A"',
  'series.captureClass !== "A"',
  'useGuardSource(',
  'className="panel entry-readiness"',
  'className="panel uav-marc-persistent"',
  'className="bucket-row"',
  'className="bucket-config"',
  '<UavSidebarPreview',
  'Authority registry',
  'Configure site',
  'Public latitude',
  'Exact private coordinates',
  'Reusable authority intake',
  '"uav.scanBucket"',
  'sourceXItems',
  '"uav.authority.search"',
  '"uav.site.private.set"',
  '"uav.preflight"',
  '"uav.publish"',
]) {
  assert.ok(uav.includes(marker), `UAV editor is missing ${marker}`);
}
assert.ok(!uav.includes('import { BUCKETS'), 'UAV editor must not import catalog A-E/X bucket semantics');
assert.ok(entries.includes('LinkedCreditInput'), 'Regular catalog credits do not use linked credit chips');
assert.ok(!entries.includes('Enable per-person credit links'), 'Legacy per-person link checkbox is still visible');
assert.ok(uav.includes('LinkedCreditInput'), 'UAV operators and contributors do not use linked credit chips');
assert.ok(sidebar.includes('linksByPerson'), 'Regular sidebar preview does not render credit links');

for (const op of [
  'uav.list',
  'uav.read',
  'uav.create',
  'uav.write',
  'uav.scanBucket',
  'uav.authority.search',
  'uav.preflight',
  'uav.publish',
]) {
  assert.ok(rpc.includes(`'${op}'`), `Desktop RPC is missing ${op}`);
}

console.log('desktop:uav:test passed (modal, typed dispatch, conditional fields, guard, RPC, readiness).');
