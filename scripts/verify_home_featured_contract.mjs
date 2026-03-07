#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { normalizeHomeFeaturedFile } from './lib/home-featured-schema.mjs';

const ROOT = process.cwd();

const SOURCE_PATH = path.join(ROOT, 'data', 'home.featured.json');
const PUBLIC_PATH = path.join(ROOT, 'public', 'data', 'home.featured.json');
const DOCS_PATH = path.join(ROOT, 'docs', 'data', 'home.featured.json');
const SNAPSHOT_SOURCE = path.join(ROOT, 'data', 'home.featured.snapshot.json');
const SNAPSHOT_PUBLIC = path.join(ROOT, 'public', 'data', 'home.featured.snapshot.json');
const SNAPSHOT_DOCS = path.join(ROOT, 'docs', 'data', 'home.featured.snapshot.json');

const HOME_PAGE_PATH = path.join(ROOT, 'docs', 'index.html');
const HOME_MANAGER_PATH = path.join(ROOT, 'scripts', 'ui', 'home-featured-manager.mjs');
const HOME_CLI_PATH = path.join(ROOT, 'scripts', 'lib', 'home-featured-cli.mjs');

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

  const source = normalizeHomeFeaturedFile(readJson(SOURCE_PATH));
  const publicMirror = normalizeHomeFeaturedFile(readJson(PUBLIC_PATH));
  const docsMirror = normalizeHomeFeaturedFile(readJson(DOCS_PATH));

  if (JSON.stringify(source.featured) !== JSON.stringify(publicMirror.featured)) {
    failures.push('public/data/home.featured.json does not match data/home.featured.json');
  }
  if (JSON.stringify(source.featured) !== JSON.stringify(docsMirror.featured)) {
    failures.push('docs/data/home.featured.json does not match data/home.featured.json');
  }

  const sourceSnapshot = readJson(SNAPSHOT_SOURCE);
  const publicSnapshot = readJson(SNAPSHOT_PUBLIC);
  const docsSnapshot = readJson(SNAPSHOT_DOCS);

  if (JSON.stringify(sourceSnapshot) !== JSON.stringify(publicSnapshot)) {
    failures.push('public home featured snapshot does not match data snapshot');
  }
  if (JSON.stringify(sourceSnapshot) !== JSON.stringify(docsSnapshot)) {
    failures.push('docs home featured snapshot does not match data snapshot');
  }

  const homePage = readText(HOME_PAGE_PATH);
  const requiredHomeMarkers = [
    '/data/home.featured.snapshot.json',
    'loadFeaturedItems',
  ];
  for (const marker of requiredHomeMarkers) {
    if (!homePage.includes(marker)) {
      failures.push(`docs/index.html missing marker: ${marker}`);
    }
  }
  if (homePage.includes('id="featured-manifest"')) {
    failures.push('docs/index.html still includes legacy inline featured-manifest source');
  }

  const homeCli = readText(HOME_CLI_PATH);
  const requiredCliMarkers = [
    'home featured list',
    'home featured set',
    'home featured reorder',
    'home validate',
    'home diff',
    'home publish',
    'home pull',
  ];
  for (const marker of requiredCliMarkers) {
    if (!homeCli.includes(marker)) failures.push(`home-featured-cli missing marker: ${marker}`);
  }

  const homeManager = readText(HOME_MANAGER_PATH);
  const requiredManagerMarkers = [
    'LIVE / CRITICAL / SENSITIVE INFRASTRUCTURE',
    'PUBLISH PROD',
    'publishHomeFeatured',
  ];
  for (const marker of requiredManagerMarkers) {
    if (!homeManager.includes(marker)) failures.push(`home-featured-manager missing marker: ${marker}`);
  }

  if (failures.length) {
    console.error(`verify:home-featured failed with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`verify:home-featured passed (${source.featured.length} featured rows).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:home-featured failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
