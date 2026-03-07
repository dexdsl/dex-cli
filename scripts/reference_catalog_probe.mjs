#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildCatalogModelFromHtml, buildCatalogDiff } from './lib/catalog-model.mjs';

const ROOT = process.cwd();
const REFERENCE_URL = 'https://dexdsl.org/catalog';
const LOCAL_DATA_PATH = path.join(ROOT, 'public', 'data', 'catalog.data.json');
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'reference');
const REFERENCE_OUT = path.join(OUTPUT_DIR, 'catalog.reference.json');
const DIFF_OUT = path.join(OUTPUT_DIR, 'catalog.diff.json');

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'dexdsl-catalog-probe/1.0 (+https://dexdsl.github.io)',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function readLocalModel() {
  if (!fs.existsSync(LOCAL_DATA_PATH)) {
    throw new Error(`Missing local model at ${path.relative(ROOT, LOCAL_DATA_PATH)}. Run npm run catalog:extract first.`);
  }
  return JSON.parse(fs.readFileSync(LOCAL_DATA_PATH, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const html = await fetchHtml(REFERENCE_URL);
  const referenceModel = buildCatalogModelFromHtml(html, 'reference-dexdsl-org-catalog');
  const localModel = readLocalModel();
  const diff = buildCatalogDiff(localModel, referenceModel);

  writeJson(REFERENCE_OUT, referenceModel);
  writeJson(DIFF_OUT, diff);

  console.log(`catalog:ref-probe wrote ${path.relative(ROOT, REFERENCE_OUT)} (${referenceModel.entries.length} entries)`);
  console.log(`catalog:ref-probe wrote ${path.relative(ROOT, DIFF_OUT)}`);
}

main().catch((error) => {
  console.error(`catalog:ref-probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
