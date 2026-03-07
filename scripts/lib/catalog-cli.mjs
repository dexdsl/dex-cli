import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeCatalogEditorialFile,
} from './catalog-editorial-schema.mjs';
import {
  defaultCatalogEditorialData,
  readCatalogEditorialFile,
  removeCatalogManifestEntry,
  setCatalogSpotlight,
  upsertCatalogManifestEntry,
  writeCatalogEditorialFile,
} from './catalog-editorial-store.mjs';
import {
  diffCatalogCuration,
  publishCatalogCuration,
  pullCatalogCuration,
  readCatalogEditorialSource,
  writeCatalogSnapshotFromLocal,
} from './catalog-publisher.mjs';
import { runCatalogSeasonsCommand } from './catalog-seasons-cli.mjs';
import { readHomeFeaturedFile } from './home-featured-store.mjs';
import {
  assertCatalogManifestLinkageSet,
  assertCatalogManifestRowLinkage,
  canonicalEntryHrefFromId,
} from './entry-catalog-linkage.mjs';

const ROOT = process.cwd();
const CATALOG_ENTRIES_PATH = path.join(ROOT, 'data', 'catalog.entries.json');

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

function normalizeHref(value) {
  const raw = toText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.pathname.startsWith('/entry/')) return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
      return raw;
    } catch {
      return raw;
    }
  }
  if (raw.startsWith('/entry/')) return raw.endsWith('/') ? raw : `${raw}/`;
  return raw;
}

async function readCatalogEntries() {
  const text = await fs.readFile(CATALOG_ENTRIES_PATH, 'utf8');
  const raw = JSON.parse(text);
  return Array.isArray(raw?.entries) ? raw.entries : [];
}

function resolveEntryFromCatalog(entries = [], token) {
  const needle = toText(token).toLowerCase();
  if (!needle) return null;

  const byId = entries.find((entry) => toText(entry.id).toLowerCase() === needle);
  if (byId) return byId;

  const byHref = entries.find((entry) => normalizeHref(entry.entry_href).toLowerCase() === normalizeHref(needle).toLowerCase());
  if (byHref) return byHref;

  const bySlug = entries.find((entry) => {
    const slug = normalizeHref(entry.entry_href).replace(/^\/entry\//, '').replace(/\/$/, '').toLowerCase();
    return slug === needle;
  });
  return bySlug || null;
}

function printUsage() {
  console.log('Usage: dex catalog <manifest|stage|spotlight|validate|diff|publish|pull|seasons> [args]');
  console.log('  dex catalog manifest list [--all]');
  console.log('  dex catalog manifest add --entry <slug|href|id> --lookup <lookup> --season <S#> --instrument <...> --performer <...>');
  console.log('  dex catalog manifest edit --entry <slug|href|id> [--lookup ... --season ... --instrument ... --performer ... --status ...]');
  console.log('  dex catalog manifest retire --entry <slug|href|id> [--reason ...]');
  console.log('  dex catalog manifest remove --entry <slug|href|id> [--force-remove]');
  console.log('  dex catalog stage --entry <slug|href|id> [--lookup ...]');
  console.log('  dex catalog spotlight set --entry <slug|href|id> [--headline ... --cta-label ...]');
  console.log('  dex catalog validate');
  console.log('  dex catalog diff --env test|prod');
  console.log('  dex catalog publish --env test|prod [--dry-run]');
  console.log('  dex catalog pull --env test|prod');
  console.log('  dex catalog seasons ...');
}

function printManifestRows(rows = []) {
  if (!rows.length) {
    console.log('catalog:manifest list empty');
    return;
  }
  for (const row of rows) {
    console.log(`${row.entry_id}\t${row.lookup_number || '-'}\t${row.season || '-'}\t${row.status || 'active'}\t${row.entry_href || '-'}`);
  }
}

function parseBoolFlag(flags, key) {
  if (!flags.has(key)) return false;
  const raw = String(flags.get(key)).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

async function commandManifest(rest = [], filePath) {
  const { subcommand, flags, values } = parseArgs(rest);
  const action = subcommand || 'list';

  const { data } = await readCatalogEditorialFile(filePath);

  if (action === 'list') {
    const showAll = parseBoolFlag(flags, '--all');
    if (showAll) {
      const source = await readCatalogEditorialSource(filePath);
      const rows = Array.isArray(source?.built?.payload?.snapshot?.manifest) ? source.built.payload.snapshot.manifest : [];
      console.log(`catalog:manifest full=${rows.length} staged=${(data.manifest || []).length}`);
      printManifestRows(rows);
      return;
    }
    const stagedRows = Array.isArray(data.manifest) ? data.manifest : [];
    const source = await readCatalogEditorialSource(filePath);
    const fullCount = Array.isArray(source?.built?.payload?.snapshot?.manifest) ? source.built.payload.snapshot.manifest.length : 0;
    console.log(`catalog:manifest staged=${stagedRows.length} full=${fullCount} (use --all for full view)`);
    printManifestRows(stagedRows);
    return;
  }

  if (action === 'retire') {
    const token = flags.get('--entry') || values[0] || '';
    if (!toText(token)) throw new Error('catalog manifest retire requires --entry <slug|href|id>');
    const rows = Array.isArray(data.manifest) ? data.manifest : [];
    const found = rows.find((row) => {
      const rowId = toText(row.entry_id).toLowerCase();
      const href = normalizeHref(row.entry_href).toLowerCase();
      const slug = href.replace(/^\/entry\//, '').replace(/\/$/, '');
      const needle = toText(token).toLowerCase();
      return rowId === needle || href === normalizeHref(needle).toLowerCase() || slug === needle;
    });
    if (!found) throw new Error(`catalog manifest entry not found: ${token}`);
    const next = upsertCatalogManifestEntry(data, {
      ...found,
      status: 'archived',
    });
    const written = await writeCatalogEditorialFile(next, filePath);
    console.log(`catalog:manifest:retire wrote ${toText(found.entry_id || token)}`);
    printManifestRows(written.data.manifest || []);
    return;
  }

  if (action === 'remove') {
    const token = flags.get('--entry') || values[0] || '';
    if (!toText(token)) throw new Error('catalog manifest remove requires --entry <slug|href|id>');
    const rows = Array.isArray(data.manifest) ? data.manifest : [];
    const found = rows.find((row) => {
      const rowId = toText(row.entry_id).toLowerCase();
      const href = normalizeHref(row.entry_href).toLowerCase();
      const slug = href.replace(/^\/entry\//, '').replace(/\/$/, '');
      const needle = toText(token).toLowerCase();
      return rowId === needle || href === normalizeHref(needle).toLowerCase() || slug === needle;
    });
    if (found) {
      const linked = await assertCatalogManifestRowLinkage(
        { ...found, status: 'active' },
        { rootDir: process.cwd() },
      ).then(() => true).catch(() => false);
      if (linked && !parseBoolFlag(flags, '--force-remove')) {
        throw new Error(
          'catalog manifest remove blocked: linked entry page exists. Use `dex catalog manifest retire --entry ...` or pass --force-remove.',
        );
      }
    }
    const next = removeCatalogManifestEntry(data, String(token));
    const written = await writeCatalogEditorialFile(next, filePath);
    console.log(`catalog:manifest:remove wrote ${toText(token)}`);
    printManifestRows(written.data.manifest || []);
    return;
  }

  if (action === 'add' || action === 'edit') {
    const token = flags.get('--entry') || values[0] || '';
    if (!toText(token)) throw new Error(`catalog manifest ${action} requires --entry <slug|href|id>`);

    const entries = await readCatalogEntries();
    const resolved = resolveEntryFromCatalog(entries, token);

    const patch = {
      entry_id: toText(flags.get('--entry-id') || resolved?.id || token),
      entry_href: normalizeHref(flags.get('--entry-href') || resolved?.entry_href || token),
      title_raw: toText(flags.get('--title') || resolved?.title_raw),
      lookup_number: toText(flags.get('--lookup') || resolved?.lookup_raw),
      season: toText(flags.get('--season') || resolved?.season),
      performer: toText(flags.get('--performer') || resolved?.performer_raw),
      instrument: toText(
        flags.get('--instrument')
          || (Array.isArray(resolved?.instrument_labels) && resolved.instrument_labels.length ? resolved.instrument_labels[0] : ''),
      ),
      status: toText(flags.get('--status') || 'active'),
    };

    if (!patch.entry_href.startsWith('/entry/')) {
      patch.entry_href = normalizeHref(resolved?.entry_href || '');
    }

    if (!patch.entry_id) {
      throw new Error('catalog manifest patch requires resolvable entry_id.');
    }
    if (!patch.entry_href) {
      patch.entry_href = canonicalEntryHrefFromId(patch.entry_id);
    }
    await assertCatalogManifestRowLinkage(patch, { rootDir: process.cwd() });

    const next = upsertCatalogManifestEntry(data, patch);
    const written = await writeCatalogEditorialFile(next, filePath);
    console.log(`catalog:manifest:${action} wrote ${patch.entry_id}`);
    printManifestRows(written.data.manifest || []);
    return;
  }

  throw new Error(`Unknown catalog manifest command: ${action}`);
}

async function commandStage(rest = [], filePath) {
  const { flags, values } = parseArgs(rest);
  const token = flags.get('--entry') || values[0] || '';
  if (!toText(token)) throw new Error('catalog stage requires --entry <slug|href|id>');

  const entries = await readCatalogEntries();
  const resolved = resolveEntryFromCatalog(entries, token);
  if (!resolved) throw new Error(`catalog stage entry not found in catalog entries: ${token}`);

  const { data } = await readCatalogEditorialFile(filePath);
  const patch = {
    entry_id: toText(resolved.id),
    entry_href: normalizeHref(resolved.entry_href),
    title_raw: toText(flags.get('--title') || resolved.title_raw),
    lookup_number: toText(flags.get('--lookup') || resolved.lookup_raw),
    season: toText(flags.get('--season') || resolved.season),
    performer: toText(flags.get('--performer') || resolved.performer_raw),
    instrument: toText(
      flags.get('--instrument')
        || (Array.isArray(resolved.instrument_labels) && resolved.instrument_labels.length ? resolved.instrument_labels[0] : ''),
    ),
    status: toText(flags.get('--status') || 'active'),
  };
  if (!patch.entry_href) patch.entry_href = canonicalEntryHrefFromId(patch.entry_id);
  await assertCatalogManifestRowLinkage(patch, { rootDir: process.cwd() });

  const next = upsertCatalogManifestEntry(data, patch);
  const written = await writeCatalogEditorialFile(next, filePath);
  console.log(`catalog:stage wrote ${patch.entry_id}`);
  printManifestRows(written.data.manifest || []);
}

async function commandSpotlight(rest = [], filePath) {
  const { subcommand, flags, values } = parseArgs(rest);
  const action = subcommand || 'set';
  if (action !== 'set') throw new Error(`Unknown catalog spotlight command: ${action}`);

  const token = flags.get('--entry') || values[0] || '';
  if (!toText(token)) throw new Error('catalog spotlight set requires --entry <slug|href|id>');
  const entries = await readCatalogEntries();
  const resolved = resolveEntryFromCatalog(entries, token);
  const entryId = toText(flags.get('--entry-id') || resolved?.id || token);
  if (!entryId) throw new Error('catalog spotlight set requires resolvable entry_id');

  const { data } = await readCatalogEditorialFile(filePath);
  const next = setCatalogSpotlight(data, {
    entry_id: entryId,
    headline_raw: toText(flags.get('--headline') || data?.spotlight?.headline_raw || 'ARTIST SPOTLIGHT'),
    cta_label_raw: toText(flags.get('--cta-label') || data?.spotlight?.cta_label_raw || 'VIEW COLLECTION'),
    body_raw: toText(flags.get('--body') || data?.spotlight?.body_raw || resolved?.performer_raw || ''),
    subhead_raw: toText(flags.get('--subhead') || data?.spotlight?.subhead_raw || resolved?.title_raw || ''),
    image_src: toText(flags.get('--image') || data?.spotlight?.image_src || resolved?.image_src || ''),
  });
  const written = await writeCatalogEditorialFile(next, filePath);
  console.log(`catalog:spotlight:set wrote entry=${entryId}`);
  console.log(JSON.stringify(written.data.spotlight, null, 2));
}

async function commandValidate(filePath) {
  const source = await readCatalogEditorialSource(filePath);
  normalizeCatalogEditorialFile(source.data);

  const manifestIds = new Set((source.data.manifest || []).map((row) => toText(row.entry_id).toLowerCase()));
  const spotlightId = toText(source.data.spotlight?.entry_id).toLowerCase();
  if (spotlightId && !manifestIds.has(spotlightId)) {
    console.warn(`catalog:validate warning spotlight entry ${source.data.spotlight.entry_id} is not staged in manifest.`);
  }

  try {
    const home = await readHomeFeaturedFile();
    for (const row of home.data.featured || []) {
      if (!manifestIds.has(toText(row.entry_id).toLowerCase())) {
        console.warn(`catalog:validate warning home featured entry missing from catalog manifest: ${row.entry_id}`);
      }
    }
  } catch {
    // Optional cross-check, ignore if home config is unavailable.
  }

  await assertCatalogManifestLinkageSet(source.data.manifest || [], { rootDir: process.cwd() });

  await writeCatalogSnapshotFromLocal({ filePath });
  console.log(`catalog:validate passed (${source.built.counts.manifest} manifest rows).`);
}

async function commandDiff(flags, filePath) {
  const result = await diffCatalogCuration({
    env: flags.get('--env') || flags.get('--target') || 'test',
    filePath,
    apiBase: flags.get('--api-base'),
    adminToken: flags.get('--token'),
  });

  console.log(`catalog:diff (${result.env}) local=${result.localHash.slice(0, 12)} remote=${result.remoteHash.slice(0, 12)}`);
  console.log(`  manifest +${result.manifest.added} -${result.manifest.removed} ~${result.manifest.changed}`);
  console.log(`  spotlight changed=${result.spotlightChanged ? 'yes' : 'no'}`);
}

async function commandPublish(flags, filePath) {
  const env = flags.get('--env') || flags.get('--target') || 'test';
  const dryRun = parseBoolFlag(flags, '--dry-run');
  const result = await publishCatalogCuration({
    env,
    filePath,
    dryRun,
    apiBase: flags.get('--api-base'),
    adminToken: flags.get('--token'),
  });
  if (!dryRun) {
    await writeCatalogSnapshotFromLocal({ filePath });
  }
  console.log(`catalog:publish (${result.env}) manifest=${result.counts.manifest} dryRun=${dryRun ? 'yes' : 'no'} hash=${result.manifestHash.slice(0, 12)} -> ${result.apiBase}`);
}

async function commandPull(flags) {
  const result = await pullCatalogCuration({
    env: flags.get('--env') || flags.get('--target') || 'test',
    apiBase: flags.get('--api-base'),
    adminToken: flags.get('--token'),
    writeLocal: true,
  });
  console.log(`catalog:pull (${result.env}) wrote ${result.written?.filePath || 'catalog.editorial.json'} -> ${result.apiBase}`);
}

export async function runCatalogCommand(rest = []) {
  const [subcommand = '', ...tail] = rest;
  if (!subcommand) {
    printUsage();
    return;
  }

  // Parse flags from the full tail so top-level commands like
  // `dex catalog validate --file ...` retain their flags.
  const parsed = parseArgs(['__root__', ...tail]);
  const filePath = parsed.flags.get('--file');

  if (subcommand === 'seasons') {
    await runCatalogSeasonsCommand(tail);
    return;
  }

  if (subcommand === 'manifest') {
    await commandManifest(tail, filePath);
    return;
  }

  if (subcommand === 'stage') {
    await commandStage(tail, filePath);
    return;
  }

  if (subcommand === 'spotlight') {
    await commandSpotlight(tail, filePath);
    return;
  }

  if (subcommand === 'validate') {
    await commandValidate(filePath);
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

  throw new Error(`Unknown catalog command: ${subcommand}`);
}

export function printCatalogUsage() {
  printUsage();
}
