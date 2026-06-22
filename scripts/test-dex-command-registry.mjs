import assert from 'node:assert/strict';
import {
  DEX_COMMANDS,
  DEX_COMMAND_GROUPS,
  buildDexCommandArgs,
  registryPayload,
  validateDexRunRequest,
} from './lib/dex-command-registry.mjs';

const ids = new Set();
for (const command of DEX_COMMANDS) {
  assert.ok(command.id, 'command id required');
  assert.equal(ids.has(command.id), false, `duplicate command id: ${command.id}`);
  ids.add(command.id);
  assert.ok(command.label, `${command.id} label required`);
  assert.ok(command.command?.length, `${command.id} command argv required`);
  assert.ok(['SAFE', 'EDIT', 'PUBLISH'].includes(command.danger), `${command.id} danger level invalid`);
  assert.ok(DEX_COMMAND_GROUPS.some((group) => group.id === command.group), `${command.id} group missing`);
}

const requiredIds = [
  'setup.configure',
  'entry.init',
  'entry.update',
  'entry.doctor',
  'entry.audit',
  'entry.link',
  'catalog.publish',
  'home.publish',
  'notes.publish',
  'polls.publish',
  'newsletter.send',
  'assets.publish',
  'assets.bucket.ensure',
  'status.manage',
  'release.preflight',
  'release.publish',
  'deploy.site',
  'view.launch',
];
for (const id of requiredIds) assert.ok(ids.has(id), `missing required GUI descriptor: ${id}`);

assert.deepEqual(
  buildDexCommandArgs('catalog.publish', { env: 'test' }, { dryRun: true }),
  ['catalog', 'publish', '--env', 'test', '--dry-run'],
);
assert.deepEqual(
  buildDexCommandArgs('entry.audit', { slug: 'tim-feeney', inventoryOnly: true }),
  ['entry', 'audit', '--slug', 'tim-feeney', '--inventory-only'],
);
assert.equal(
  validateDexRunRequest({ commandId: 'catalog.publish', values: { env: 'prod' }, confirmation: '' }).ok,
  false,
);
assert.equal(
  validateDexRunRequest({ commandId: 'catalog.publish', values: { env: 'prod' }, confirmation: 'PUBLISH PROD' }).ok,
  true,
);
assert.ok(registryPayload().commands.length >= requiredIds.length, 'registry payload includes commands');
console.log(`dex command registry ok (${DEX_COMMANDS.length} commands)`);
