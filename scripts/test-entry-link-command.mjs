#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

function runNode(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`command failed (${code})\n${stdout}\n${stderr}`));
    });
  });
}

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-entry-link-'));
  const cwd = path.join(tmpRoot, 'repo');
  await fs.mkdir(path.join(cwd, 'data'), { recursive: true });

  await fs.writeFile(path.join(cwd, 'data', 'catalog.entries.json'), JSON.stringify({
    entries: [
      {
        id: 'artist-alpha',
        entry_href: '/entry/artist-alpha/',
        lookup_raw: 'SUB01-P.Dru Un AV2026',
        season: 'S2',
        performer_raw: 'Artist Alpha',
        instrument_labels: ['Drumkit'],
        title_raw: 'DRUMKIT GROOVES',
      },
    ],
  }, null, 2), 'utf8');

  await fs.writeFile(path.join(cwd, 'data', 'catalog.editorial.json'), JSON.stringify({
    version: 'catalog-editorial-v1',
    updatedAt: new Date().toISOString(),
    manifest: [],
    spotlight: {},
  }, null, 2), 'utf8');

  await runNode(cwd, [
    path.resolve('scripts/dex.mjs'),
    'entry',
    'link',
    '--entry',
    'artist-alpha',
    '--catalog',
    'artist-alpha',
    '--catalog-file',
    path.join(cwd, 'data', 'catalog.editorial.json'),
    '--catalog-entries-file',
    path.join(cwd, 'data', 'catalog.entries.json'),
  ]);

  const written = JSON.parse(await fs.readFile(path.join(cwd, 'data', 'catalog.editorial.json'), 'utf8'));
  const row = (written.manifest || []).find((item) => String(item.entry_id) === 'artist-alpha');
  assert(row, 'linked manifest row should be written');
  assert.equal(row.lookup_number, 'SUB01-P.Dru Un AV2026', 'lookup should be inherited from catalog.entries');
  assert.equal(row.status, 'draft', 'entry without page should default to draft linkage status');
  assert.equal(row.entry_href, '/entry/artist-alpha/', 'href should be canonical');
  console.log('test-entry-link-command passed');
}

main().catch((error) => {
  console.error(`test-entry-link-command failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
