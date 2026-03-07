#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FAILURES = [];

function readText(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    FAILURES.push(`Missing required file: ${relPath}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

function assertIncludes(relPath, marker) {
  const source = readText(relPath);
  if (!source.includes(marker)) {
    FAILURES.push(`${relPath} missing marker: ${marker}`);
  }
}

function main() {
  assertIncludes('scripts/dex.mjs', "if (subcommand === 'desk')");
  assertIncludes('scripts/dex.mjs', "DEX_POLLS_OPS_ENV");
  assertIncludes('scripts/dex.mjs', "DEX_POLLS_DESK_PAUSED");

  assertIncludes('scripts/ui/polls-manager.mjs', "const OPS_MODES = ['desk'");
  assertIncludes('scripts/ui/polls-manager.mjs', 'const AUTO_REFRESH_MS = 5000;');
  assertIncludes('scripts/ui/polls-manager.mjs', 'const PANEL_NAMES =');
  assertIncludes('scripts/ui/polls-manager.mjs', 'const refreshDeskData = useCallback');
  assertIncludes('scripts/ui/polls-manager.mjs', 'setPendingAction');
  assertIncludes('scripts/ui/polls-manager.mjs', 'setQueueDrilldownOpen');
  assertIncludes('scripts/ui/polls-manager.mjs', 'setPublishNoteOpen');
  assertIncludes('scripts/ui/polls-manager.mjs', "if (pendingAction)");
  assertIncludes('scripts/ui/polls-manager.mjs', "from './polls-desk.mjs'");
  assertIncludes('scripts/ui/polls-manager.mjs', 'PollsDeskDetail');
  assertIncludes('scripts/ui/polls-manager.mjs', 'PollsDeskPublishNoteComposer');

  assertIncludes('scripts/ui/polls-desk.mjs', 'buildPollsDeskQueueRows');
  assertIncludes('scripts/ui/polls-desk.mjs', 'QUEUE DRILLDOWN');
  assertIncludes('scripts/ui/polls-desk.mjs', 'Publish note composer');

  assertIncludes('scripts/lib/polls-kuva.mjs', 'renderLineTrend');
  assertIncludes('scripts/lib/polls-kuva.mjs', 'renderStackedOptionTrend');
  assertIncludes('scripts/lib/polls-kuva.mjs', 'renderVelocityTrend');

  if (FAILURES.length > 0) {
    console.error(`verify:polls-desk failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log('verify:polls-desk passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:polls-desk error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
