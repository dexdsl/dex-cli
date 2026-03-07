#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runDexNotesCommand } from './lib/dex-notes-cli.mjs';

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, 'content', 'dexnotes', 'posts');
const TEST_SLUG = `test-cli-note-${Date.now()}`;
const TEST_FILE = path.join(POSTS_DIR, `${TEST_SLUG}.md`);

async function main() {
  try {
    await runDexNotesCommand([
      'add',
      '--title', 'CLI Test Note',
      '--slug', TEST_SLUG,
      '--excerpt', 'CLI test excerpt',
      '--published', '2026-02-27',
      '--category', 'Update',
      '--categoryLabel', 'Update',
      '--author', 'dex-team',
      '--authorName', 'dex Team',
      '--tags', 'cli:CLI',
      '--cover', '/assets/img/7142b356c8cfe9d18b7c.png',
      '--coverAlt', 'CLI cover',
      '--bodyMode', 'markdown',
      '--pinned', 'false',
    ]);

    const created = await fs.readFile(TEST_FILE, 'utf8');
    assert(created.includes('CLI Test Note'));

    await runDexNotesCommand(['set', '--slug', TEST_SLUG, '--field', 'title_raw', '--value', 'CLI Test Note Updated']);
    const updated = await fs.readFile(TEST_FILE, 'utf8');
    assert(updated.includes('CLI Test Note Updated'));

    await runDexNotesCommand(['list']);

    console.log('test-dex-notes-cli passed');
  } finally {
    await fs.rm(TEST_FILE, { force: true });
  }
}

main().catch((error) => {
  console.error(`test-dex-notes-cli failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
