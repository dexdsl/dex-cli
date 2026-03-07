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
  const dexCliFile = 'scripts/dex.mjs';
  assertIncludes(dexCliFile, 'desk|validate|create|edit|close|open|publish|overview|live|trend|snapshots|publish-results|promote-results');
  assertIncludes(dexCliFile, "if (subcommand === 'desk')");
  assertIncludes(dexCliFile, "if (subcommand === 'overview')");
  assertIncludes(dexCliFile, "if (subcommand === 'live')");
  assertIncludes(dexCliFile, "if (subcommand === 'trend')");
  assertIncludes(dexCliFile, "if (subcommand === 'snapshots')");
  assertIncludes(dexCliFile, "if (subcommand === 'publish-results')");
  assertIncludes(dexCliFile, "if (subcommand === 'promote-results')");
  assertIncludes(dexCliFile, "import('./lib/polls-admin-api.mjs')");
  assertIncludes(dexCliFile, "import('./lib/polls-kuva.mjs')");

  assertIncludes('scripts/lib/polls-admin-api.mjs', 'getAdminPollOverview');
  assertIncludes('scripts/lib/polls-admin-api.mjs', 'publishAdminPollSnapshot');
  assertIncludes('scripts/lib/polls-kuva.mjs', 'renderLineTrend');
  assertIncludes('scripts/ui/polls-manager.mjs', "const OPS_MODES = ['desk'");

  if (FAILURES.length > 0) {
    console.error(`verify:polls-cli failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:polls-cli passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:polls-cli error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
