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
  const text = readText(relPath);
  if (!text.includes(marker)) {
    FAILURES.push(`${relPath} missing marker: ${marker}`);
  }
}

function main() {
  assertIncludes('scripts/build_dexnotes_data.mjs', 'data-dx-poll-embed="true"');
  assertIncludes('scripts/src/shared/dx-polls-embed.entry.mjs', 'data-dx-poll-embed-state');
  assertIncludes('scripts/src/dexnotes.entry.entry.mjs', 'mountPollEmbeds');
  assertIncludes('scripts/src/dexnotes.index.entry.mjs', 'mountPollEmbeds');
  assertIncludes('scripts/render_dexnotes_pages.mjs', '/css/components/dx-polls-embed.css');

  const requiredCss = [
    'public/css/components/dx-polls-embed.css',
    'css/components/dx-polls-embed.css',
    'docs/css/components/dx-polls-embed.css',
  ];
  for (const relPath of requiredCss) {
    if (!fs.existsSync(path.join(ROOT, relPath))) {
      FAILURES.push(`Missing required CSS artifact: ${relPath}`);
    }
  }

  if (FAILURES.length > 0) {
    console.error(`verify:polls-embed failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:polls-embed passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:polls-embed error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
