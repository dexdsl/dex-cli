import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const registry = spawnSync(process.execPath, ['scripts/dex-gui-bridge.mjs', 'registry'], {
  encoding: 'utf8',
});
assert.equal(registry.status, 0, registry.stderr || registry.stdout);
const payload = JSON.parse(registry.stdout);
assert.ok(payload.commands.some((command) => command.id === 'entry.audit'));
assert.ok(payload.groups.some((group) => group.id === 'release'));

const blocked = spawnSync(
  process.execPath,
  [
    'scripts/dex-gui-bridge.mjs',
    'run',
    JSON.stringify({
      runId: 'test-blocked-prod',
      commandId: 'release.publish',
      repo: 'site',
      values: { env: 'prod' },
      dryRun: true,
    }),
  ],
  { encoding: 'utf8' },
);
assert.equal(blocked.status, 2, blocked.stdout);
const events = blocked.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.equal(events[0].type, 'confirmation-required');

console.log('dex gui bridge ok');
