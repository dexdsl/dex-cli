#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { normalizeCatalogEditorialFile } from './lib/catalog-editorial-schema.mjs';

const ROOT = process.cwd();

const SOURCE_PATH = path.join(ROOT, 'data', 'catalog.editorial.json');
const PUBLIC_PATH = path.join(ROOT, 'public', 'data', 'catalog.editorial.json');
const DOCS_PATH = path.join(ROOT, 'docs', 'data', 'catalog.editorial.json');
const SNAPSHOT_SOURCE = path.join(ROOT, 'data', 'catalog.curation.snapshot.json');
const SNAPSHOT_PUBLIC = path.join(ROOT, 'public', 'data', 'catalog.curation.snapshot.json');
const SNAPSHOT_DOCS = path.join(ROOT, 'docs', 'data', 'catalog.curation.snapshot.json');

const EXTRACT_SCRIPT_PATH = path.join(ROOT, 'scripts', 'extract_catalog_data.mjs');
const CATALOG_CLI_PATH = path.join(ROOT, 'scripts', 'lib', 'catalog-cli.mjs');
const CATALOG_MANAGER_PATH = path.join(ROOT, 'scripts', 'ui', 'catalog-manager.mjs');
const DEX_CLI_PATH = path.join(ROOT, 'scripts', 'dex.mjs');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

function main() {
  const failures = [];

  const source = normalizeCatalogEditorialFile(readJson(SOURCE_PATH));
  const publicMirror = normalizeCatalogEditorialFile(readJson(PUBLIC_PATH));
  const docsMirror = normalizeCatalogEditorialFile(readJson(DOCS_PATH));

  if (JSON.stringify(source.manifest) !== JSON.stringify(publicMirror.manifest)) {
    failures.push('public/data/catalog.editorial.json manifest does not match data/catalog.editorial.json');
  }
  if (JSON.stringify(source.manifest) !== JSON.stringify(docsMirror.manifest)) {
    failures.push('docs/data/catalog.editorial.json manifest does not match data/catalog.editorial.json');
  }
  if (JSON.stringify(source.spotlight) !== JSON.stringify(publicMirror.spotlight)) {
    failures.push('public/data/catalog.editorial.json spotlight does not match source');
  }
  if (JSON.stringify(source.spotlight) !== JSON.stringify(docsMirror.spotlight)) {
    failures.push('docs/data/catalog.editorial.json spotlight does not match source');
  }

  const snapshotSource = readJson(SNAPSHOT_SOURCE);
  const snapshotPublic = readJson(SNAPSHOT_PUBLIC);
  const snapshotDocs = readJson(SNAPSHOT_DOCS);

  if (JSON.stringify(snapshotSource) !== JSON.stringify(snapshotPublic)) {
    failures.push('public catalog curation snapshot does not match data snapshot');
  }
  if (JSON.stringify(snapshotSource) !== JSON.stringify(snapshotDocs)) {
    failures.push('docs catalog curation snapshot does not match data snapshot');
  }

  const extractSource = readText(EXTRACT_SCRIPT_PATH);
  const requiredExtractMarkers = [
    'applyCatalogEditorialToModel',
    'OUT_CATALOG_CURATION_SNAPSHOT_PATH',
    'buildCatalogManifestSnapshot',
  ];
  for (const marker of requiredExtractMarkers) {
    if (!extractSource.includes(marker)) {
      failures.push(`extract_catalog_data.mjs missing marker: ${marker}`);
    }
  }

  const dexCliSource = readText(DEX_CLI_PATH);
  const requiredDexMarkers = [
    "firstNonFlag === 'catalog'",
    "firstNonFlag === 'entry'",
    "firstNonFlag === 'home'",
    "firstNonFlag === 'notes'",
    "topLevel.command === 'catalog'",
    "topLevel.command === 'entry'",
  ];
  for (const marker of requiredDexMarkers) {
    if (!dexCliSource.includes(marker)) {
      failures.push(`dex.mjs missing marker: ${marker}`);
    }
  }

  const catalogCliSource = readText(CATALOG_CLI_PATH);
  const requiredCatalogCliMarkers = [
    'catalog manifest',
    'catalog manifest retire',
    'catalog stage',
    'catalog spotlight',
    'catalog validate',
    'catalog diff',
    'catalog publish',
    'catalog pull',
    'assertCatalogManifestLinkageSet',
    'assertCatalogManifestRowLinkage',
  ];
  for (const marker of requiredCatalogCliMarkers) {
    if (!catalogCliSource.includes(marker)) {
      failures.push(`catalog-cli missing marker: ${marker}`);
    }
  }

  const catalogManagerSource = readText(CATALOG_MANAGER_PATH);
  const requiredManagerMarkers = [
    'LIVE / CRITICAL / SENSITIVE INFRASTRUCTURE',
    'PUBLISH PROD',
    'publishCatalogCuration',
    'Rows (',
    '[FILTERED]',
  ];
  for (const marker of requiredManagerMarkers) {
    if (!catalogManagerSource.includes(marker)) {
      failures.push(`catalog-manager missing marker: ${marker}`);
    }
  }

  if (failures.length) {
    console.error(`verify:catalog-editorial failed with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`verify:catalog-editorial passed (${source.manifest.length} manifest rows).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:catalog-editorial failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
