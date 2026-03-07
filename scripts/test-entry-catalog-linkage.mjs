#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkCatalogManifestRowLinkage } from './lib/entry-catalog-linkage.mjs';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-entry-linkage-'));
  const row = {
    entry_id: 'unit-entry',
    entry_href: '/entry/unit-entry/',
    status: 'active',
  };

  const missing = await checkCatalogManifestRowLinkage(row, { rootDir: root });
  assert.equal(missing.ok, false, 'missing entry should fail active linkage check');

  const filePath = path.join(root, 'entries', 'unit-entry', 'index.html');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '<!doctype html><title>ok</title>', 'utf8');

  const present = await checkCatalogManifestRowLinkage(row, { rootDir: root });
  assert.equal(present.ok, true, 'existing entry should pass active linkage check');
  console.log('test-entry-catalog-linkage passed');
}

main().catch((error) => {
  console.error(`test-entry-catalog-linkage failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

