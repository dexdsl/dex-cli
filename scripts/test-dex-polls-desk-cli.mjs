#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

async function main() {
  const dexCliPath = path.join(ROOT, 'scripts', 'dex.mjs');
  const pollsManagerPath = path.join(ROOT, 'scripts', 'ui', 'polls-manager.mjs');
  const pollsDeskPath = path.join(ROOT, 'scripts', 'ui', 'polls-desk.mjs');
  const dexCli = await fs.readFile(dexCliPath, 'utf8');
  const pollsManager = await fs.readFile(pollsManagerPath, 'utf8');
  const pollsDesk = await fs.readFile(pollsDeskPath, 'utf8');

  assert(dexCli.includes("if (subcommand === 'desk')"), 'dex polls must expose `desk` subcommand');
  assert(dexCli.includes('DEX_POLLS_OPS_ENV'), 'polls desk must set ops env');
  assert(dexCli.includes('DEX_POLLS_DESK_PAUSED'), 'polls desk must support paused boot flag');

  assert(pollsManager.includes("const OPS_MODES = ['desk'"), 'polls manager must include desk mode');
  assert(pollsManager.includes('const AUTO_REFRESH_MS = 5000;'), 'polls desk must define 5s auto refresh');
  assert(pollsManager.includes('refreshDeskData'), 'polls desk must include refresh scheduler');
  assert(pollsManager.includes("from './polls-desk.mjs'"), 'polls manager must delegate desk rendering');
  assert(pollsManager.includes('setQueueDrilldownOpen'), 'polls desk must include queue drilldown state');
  assert(pollsManager.includes('setPublishNoteOpen'), 'polls desk must include publish note composer state');
  assert(pollsManager.includes('pendingAction'), 'polls desk must guard mutating actions');
  assert(pollsDesk.includes('buildPollsDeskQueueRows'), 'polls-desk module must include queue builder');
  assert(pollsDesk.includes('PollsDeskPublishNoteComposer'), 'polls-desk module must include publish note composer');

  console.log('test-dex-polls-desk-cli passed');
}

main().catch((error) => {
  console.error(`test-dex-polls-desk-cli failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
