import path from 'node:path';
import fs from 'node:fs/promises';
import {
  normalizeHomeFeaturedFile,
} from './home-featured-schema.mjs';
import {
  readHomeFeaturedFile,
  reorderHomeFeaturedItems,
  upsertHomeFeaturedItems,
  writeHomeFeaturedFile,
} from './home-featured-store.mjs';
import {
  diffHomeFeatured,
  publishHomeFeatured,
  pullHomeFeatured,
  readHomeFeaturedSource,
  writeHomeSnapshotFromLocal,
} from './home-featured-publisher.mjs';

const ROOT = process.cwd();
const CATALOG_ENTRIES_PATH = path.join(ROOT, 'data', 'catalog.entries.json');
const CATALOG_EDITORIAL_PATH = path.join(ROOT, 'data', 'catalog.editorial.json');

function parseArgs(rest = []) {
  const [subcommand = '', ...rawArgs] = rest;
  const flags = new Map();
  const values = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index += 1;
        continue;
      }
      flags.set(name, 'true');
      continue;
    }
    values.push(arg);
  }
  return { subcommand, flags, values };
}

function toText(value) {
  return String(value || '').trim();
}

function parseBoolFlag(flags, key) {
  if (!flags.has(key)) return false;
  const raw = String(flags.get(key)).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

async function readCatalogEntries() {
  const text = await fs.readFile(CATALOG_ENTRIES_PATH, 'utf8');
  const raw = JSON.parse(text);
  return Array.isArray(raw?.entries) ? raw.entries : [];
}

async function readCatalogManifestSet(catalogFilePath) {
  const targetPath = catalogFilePath ? path.resolve(catalogFilePath) : CATALOG_EDITORIAL_PATH;
  const text = await fs.readFile(targetPath, 'utf8');
  const raw = JSON.parse(text);
  const rows = Array.isArray(raw?.manifest) ? raw.manifest : [];
  return new Set(rows.map((row) => toText(row.entry_id).toLowerCase()));
}

function printUsage() {
  console.log('Usage: dex home <featured|validate|diff|publish|pull> [args]');
  console.log('  dex home featured list');
  console.log('  dex home featured set --entries <id1,id2,...>');
  console.log('  dex home featured reorder --entries <id1,id2,...>');
  console.log('  dex home validate [--catalog-file data/catalog.editorial.json]');
  console.log('  dex home diff --env test|prod');
  console.log('  dex home publish --env test|prod [--dry-run]');
  console.log('  dex home pull --env test|prod');
}

function printRows(rows = []) {
  if (!rows.length) {
    console.log('home:featured list empty');
    return;
  }
  for (const row of rows) {
    console.log(`${row.slot_index}\t${row.entry_id}\t${row.lookup || '-'}\t${row.video ? 'video' : 'no-video'}`);
  }
}

async function commandFeatured(rest = [], filePath) {
  const { subcommand, flags } = parseArgs(rest);
  const action = subcommand || 'list';
  const { data } = await readHomeFeaturedFile(filePath);

  if (action === 'list') {
    printRows(data.featured || []);
    return;
  }

  if (action === 'set') {
    const entriesCsv = flags.get('--entries') || '';
    const catalogEntries = await readCatalogEntries();
    const next = upsertHomeFeaturedItems(data, entriesCsv, catalogEntries);
    const written = await writeHomeFeaturedFile(next, filePath);
    console.log('home:featured:set wrote');
    printRows(written.data.featured || []);
    return;
  }

  if (action === 'reorder') {
    const entriesCsv = flags.get('--entries') || '';
    const next = reorderHomeFeaturedItems(data, entriesCsv);
    const written = await writeHomeFeaturedFile(next, filePath);
    console.log('home:featured:reorder wrote');
    printRows(written.data.featured || []);
    return;
  }

  throw new Error(`Unknown home featured command: ${action}`);
}

async function commandValidate(filePath, catalogFilePath) {
  const source = await readHomeFeaturedSource(filePath);
  normalizeHomeFeaturedFile(source.data);
  const manifestIds = await readCatalogManifestSet(catalogFilePath);
  for (const row of source.data.featured || []) {
    if (!manifestIds.has(toText(row.entry_id).toLowerCase())) {
      throw new Error(`home validate failed: entry missing from catalog manifest: ${row.entry_id}`);
    }
  }
  await writeHomeSnapshotFromLocal({ filePath });
  console.log(`home:validate passed (${source.built.counts.featured} featured rows).`);
}

async function commandDiff(flags, filePath) {
  const result = await diffHomeFeatured({
    env: flags.get('--env') || flags.get('--target') || 'test',
    filePath,
    apiBase: flags.get('--api-base'),
    adminToken: flags.get('--token'),
  });
  console.log(`home:diff (${result.env}) local=${result.localHash.slice(0, 12)} remote=${result.remoteHash.slice(0, 12)}`);
  console.log(`  featured +${result.featured.added} -${result.featured.removed} ~${result.featured.changed}`);
}

async function commandPublish(flags, filePath) {
  const env = flags.get('--env') || flags.get('--target') || 'test';
  const dryRun = parseBoolFlag(flags, '--dry-run');
  const result = await publishHomeFeatured({
    env,
    filePath,
    dryRun,
    apiBase: flags.get('--api-base'),
    adminToken: flags.get('--token'),
  });
  if (!dryRun) {
    await writeHomeSnapshotFromLocal({ filePath });
  }
  console.log(`home:publish (${result.env}) featured=${result.counts.featured} dryRun=${dryRun ? 'yes' : 'no'} hash=${result.manifestHash.slice(0, 12)} -> ${result.apiBase}`);
}

async function commandPull(flags) {
  const result = await pullHomeFeatured({
    env: flags.get('--env') || flags.get('--target') || 'test',
    apiBase: flags.get('--api-base'),
    adminToken: flags.get('--token'),
    writeLocal: true,
  });
  console.log(`home:pull (${result.env}) wrote ${result.written?.filePath || 'home.featured.json'} -> ${result.apiBase}`);
}

export async function runHomeCommand(rest = []) {
  const [subcommand = '', ...tail] = rest;
  if (!subcommand) {
    printUsage();
    return;
  }

  // Parse flags from the full tail so top-level commands like
  // `dex home validate --file ...` retain their flags.
  const parsed = parseArgs(['__root__', ...tail]);
  const filePath = parsed.flags.get('--file');
  const catalogFilePath = parsed.flags.get('--catalog-file');

  if (subcommand === 'featured') {
    await commandFeatured(tail, filePath);
    return;
  }

  if (subcommand === 'validate') {
    await commandValidate(filePath, catalogFilePath);
    return;
  }

  if (subcommand === 'diff') {
    await commandDiff(parsed.flags, filePath);
    return;
  }

  if (subcommand === 'publish') {
    await commandPublish(parsed.flags, filePath);
    return;
  }

  if (subcommand === 'pull') {
    await commandPull(parsed.flags);
    return;
  }

  throw new Error(`Unknown home command: ${subcommand}`);
}

export function printHomeUsage() {
  printUsage();
}
