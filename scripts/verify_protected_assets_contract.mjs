#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { normalizeProtectedAssetsFile } from './lib/protected-assets-schema.mjs';

const ROOT = process.cwd();
const SOURCE_PATH = path.join(ROOT, 'data', 'protected.assets.json');
const PUBLIC_PATH = path.join(ROOT, 'public', 'data', 'protected.assets.json');
const DOCS_PATH = path.join(ROOT, 'docs', 'data', 'protected.assets.json');
const DEX_PATH = path.join(ROOT, 'scripts', 'dex.mjs');
const DASHBOARD_PATH = path.join(ROOT, 'scripts', 'ui', 'dashboard.mjs');
const MANAGER_PATH = path.join(ROOT, 'scripts', 'ui', 'protected-assets-manager.mjs');
const PUBLISHER_PATH = path.join(ROOT, 'scripts', 'lib', 'protected-assets-publisher.mjs');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function main() {
  const failures = [];

  const source = normalizeProtectedAssetsFile(readJson(SOURCE_PATH));
  const publicMirror = normalizeProtectedAssetsFile(readJson(PUBLIC_PATH));
  const docsMirror = normalizeProtectedAssetsFile(readJson(DOCS_PATH));

  if (JSON.stringify(source) !== JSON.stringify(publicMirror)) {
    failures.push('public/data/protected.assets.json does not match data/protected.assets.json');
  }
  if (JSON.stringify(source) !== JSON.stringify(docsMirror)) {
    failures.push('docs/data/protected.assets.json does not match data/protected.assets.json');
  }

  const dexSource = readText(DEX_PATH);
  const requiredDexMarkers = [
    "if (firstNonFlag === 'assets')",
    'async function runAssetsCommand',
    "if (topLevel.mode === 'direct-command' && topLevel.command === 'assets')",
    'dex assets <validate|diff|publish|bucket>',
  ];
  for (const marker of requiredDexMarkers) {
    if (!dexSource.includes(marker)) {
      failures.push(`scripts/dex.mjs missing marker: ${marker}`);
    }
  }

  const dashboardSource = readText(DASHBOARD_PATH);
  const requiredDashboardMarkers = [
    "id: 'assets'",
    'ProtectedAssetsManager',
    "mode === 'assets'",
  ];
  for (const marker of requiredDashboardMarkers) {
    if (!dashboardSource.includes(marker)) {
      failures.push(`scripts/ui/dashboard.mjs missing marker: ${marker}`);
    }
  }

  const managerSource = readText(MANAGER_PATH);
  const requiredManagerMarkers = [
    'Protected Assets Manager',
    'publishProtectedAssets',
    'diffProtectedAssets',
    'ensureProtectedAssetsBucket',
  ];
  for (const marker of requiredManagerMarkers) {
    if (!managerSource.includes(marker)) {
      failures.push(`scripts/ui/protected-assets-manager.mjs missing marker: ${marker}`);
    }
  }

  const publisherSource = readText(PUBLISHER_PATH);
  const requiredPublisherMarkers = [
    '/admin/assets/publish',
    '/admin/assets/state',
    '/admin/assets/bucket/ensure',
    'manifestHash',
    'validateCatalogLookupCoverage',
    'exemptions',
    'effectiveManifestCount',
    'exempted',
    'Production publish blocked',
  ];
  for (const marker of requiredPublisherMarkers) {
    if (!publisherSource.includes(marker)) {
      failures.push(`scripts/lib/protected-assets-publisher.mjs missing marker: ${marker}`);
    }
  }

  if (failures.length > 0) {
    console.error(`verify:protected-assets failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`verify:protected-assets passed (lookups=${source.lookups.length}).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:protected-assets failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
