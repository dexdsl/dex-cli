#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runHomeCommand } from './lib/home-featured-cli.mjs';
import { runCatalogCommand } from './lib/catalog-cli.mjs';

const ROOT = process.cwd();
const HOME_PATH = path.join(ROOT, 'data', 'home.featured.json');
const EDITORIAL_PATH = path.join(ROOT, 'data', 'catalog.editorial.json');
const TMP_HOME_PATH = path.join(ROOT, 'tmp', `home.featured.test.${process.pid}.${Date.now()}.json`);
const TMP_EDITORIAL_PATH = path.join(ROOT, 'tmp', `catalog.editorial.home-test.${process.pid}.${Date.now()}.json`);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  const original = await fs.readFile(HOME_PATH, 'utf8');
  const originalEditorial = await fs.readFile(EDITORIAL_PATH, 'utf8');
  await fs.mkdir(path.dirname(TMP_HOME_PATH), { recursive: true });
  await fs.writeFile(TMP_HOME_PATH, original, 'utf8');
  await fs.writeFile(TMP_EDITORIAL_PATH, originalEditorial, 'utf8');
  try {
    await runCatalogCommand(['stage', '--entry', 'prepared-oboe-sky-macklay', '--file', TMP_EDITORIAL_PATH]);
    await runCatalogCommand(['stage', '--entry', 'jakob-heinemann', '--file', TMP_EDITORIAL_PATH]);

    await runHomeCommand(['featured', 'set', '--entries', 'prepared-oboe-sky-macklay,jakob-heinemann', '--file', TMP_HOME_PATH]);
    const afterSet = await readJson(TMP_HOME_PATH);
    assert.equal(afterSet.featured.length, 2);
    assert.equal(afterSet.featured[0].entry_id, 'prepared-oboe-sky-macklay');

    await runHomeCommand(['featured', 'reorder', '--entries', 'jakob-heinemann,prepared-oboe-sky-macklay', '--file', TMP_HOME_PATH]);
    const afterReorder = await readJson(TMP_HOME_PATH);
    assert.equal(afterReorder.featured[0].entry_id, 'jakob-heinemann');

    await runHomeCommand(['validate', '--file', TMP_HOME_PATH, '--catalog-file', TMP_EDITORIAL_PATH]);
    const afterValidate = await readJson(TMP_HOME_PATH);
    assert(Array.isArray(afterValidate.featured));

    console.log('test-dex-home-featured-cli passed');
  } finally {
    await fs.rm(TMP_HOME_PATH, { force: true });
    await fs.rm(TMP_EDITORIAL_PATH, { force: true });
  }
}

main().catch((error) => {
  console.error(`test-dex-home-featured-cli failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
