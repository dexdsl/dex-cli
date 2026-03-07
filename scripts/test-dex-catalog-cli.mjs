#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCatalogCommand } from './lib/catalog-cli.mjs';

const ROOT = process.cwd();
const EDITORIAL_PATH = path.join(ROOT, 'data', 'catalog.editorial.json');
const TMP_EDITORIAL_PATH = path.join(ROOT, 'tmp', `catalog.editorial.test.${process.pid}.${Date.now()}.json`);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  const original = await fs.readFile(EDITORIAL_PATH, 'utf8');
  await fs.mkdir(path.dirname(TMP_EDITORIAL_PATH), { recursive: true });
  await fs.writeFile(TMP_EDITORIAL_PATH, original, 'utf8');
  try {
    await runCatalogCommand(['manifest', 'add', '--entry', 'andrew-chanover', '--lookup', 'TEST-LOOKUP-CLI', '--file', TMP_EDITORIAL_PATH]);
    let afterAdd = await readJson(TMP_EDITORIAL_PATH);
    assert(afterAdd.manifest.some((row) => row.entry_id === 'andrew-chanover' && row.lookup_number === 'TEST-LOOKUP-CLI'));

    await runCatalogCommand(['stage', '--entry', 'andrew-chanover', '--file', TMP_EDITORIAL_PATH]);
    const afterStage = await readJson(TMP_EDITORIAL_PATH);
    assert(afterStage.manifest.some((row) => row.entry_id === 'andrew-chanover'));

    await runCatalogCommand(['spotlight', 'set', '--entry', 'andrew-chanover', '--headline', 'ARTIST SPOTLIGHT', '--file', TMP_EDITORIAL_PATH]);
    const afterSpotlight = await readJson(TMP_EDITORIAL_PATH);
    assert.equal(afterSpotlight.spotlight.entry_id, 'andrew-chanover');

    await runCatalogCommand(['validate', '--file', TMP_EDITORIAL_PATH]);
    const afterValidate = await readJson(TMP_EDITORIAL_PATH);
    assert(Array.isArray(afterValidate.manifest));

    const withBroken = {
      ...afterValidate,
      manifest: [
        ...(afterValidate.manifest || []),
        {
          entry_id: 'missing-entry',
          entry_href: '/entry/missing-entry/',
          title_raw: 'Missing',
          lookup_number: 'SUB99-X.Mis Un O2099',
          season: 'S9',
          performer: 'Missing',
          instrument: 'Missing',
          status: 'active',
        },
      ],
    };
    await fs.writeFile(TMP_EDITORIAL_PATH, `${JSON.stringify(withBroken, null, 2)}\n`, 'utf8');
    await assert.rejects(
      () => runCatalogCommand(['validate', '--file', TMP_EDITORIAL_PATH]),
      /Catalog linkage failed|linked entry page missing/i,
    );

    console.log('test-dex-catalog-cli passed');
  } finally {
    await fs.rm(TMP_EDITORIAL_PATH, { force: true });
  }
}

main().catch((error) => {
  console.error(`test-dex-catalog-cli failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
