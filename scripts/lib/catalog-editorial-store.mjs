import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_EDITORIAL_VERSION,
  normalizeCatalogEditorialFile,
} from './catalog-editorial-schema.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_CATALOG_EDITORIAL_PATH = path.join(ROOT, 'data', 'catalog.editorial.json');

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

function canonicalEntryHrefFromId(entryId) {
  const id = toText(entryId);
  return id ? `/entry/${id}/` : '';
}

function ensureCatalogEntryShape(entry, { includeSearchFields = false } = {}) {
  const result = {
    id: toText(entry?.id),
    title_raw: toText(entry?.title_raw),
    performer_raw: toText(entry?.performer_raw),
    instrument_family: Array.isArray(entry?.instrument_family) ? entry.instrument_family : [],
    instrument_labels: Array.isArray(entry?.instrument_labels) ? entry.instrument_labels : [],
    lookup_raw: toText(entry?.lookup_raw),
    season: toText(entry?.season),
    entry_href: normalizeHref(entry?.entry_href),
    image_src: toText(entry?.image_src),
    image_alt_raw: toText(entry?.image_alt_raw),
    featured: Boolean(entry?.featured),
    sort_key: toText(entry?.sort_key || entry?.id || entry?.entry_href),
  };

  if (includeSearchFields) {
    result.title_norm = toText(entry?.title_norm);
    result.performer_norm = toText(entry?.performer_norm);
    result.lookup_norm = toText(entry?.lookup_norm);
    result.instrument_norm = toText(entry?.instrument_norm);
  }

  return result;
}

function toManifestMap(manifest = []) {
  const byId = new Map();
  const byHref = new Map();
  for (const row of manifest) {
    const id = toText(row?.entry_id).toLowerCase();
    const href = normalizeHref(row?.entry_href).toLowerCase();
    if (id) byId.set(id, row);
    if (href) byHref.set(href, row);
  }
  return { byId, byHref };
}

function chooseManifestRow(entry, maps) {
  const id = toText(entry?.id).toLowerCase();
  const href = normalizeHref(entry?.entry_href).toLowerCase();
  return maps.byId.get(id) || maps.byHref.get(href) || null;
}

function normalizeModelEntry(entry, row) {
  const out = ensureCatalogEntryShape(entry, { includeSearchFields: true });
  if (!row) return out;
  if (toText(row.lookup_number)) out.lookup_raw = toText(row.lookup_number);
  if (toText(row.season)) out.season = toText(row.season);
  if (toText(row.performer)) out.performer_raw = toText(row.performer);
  if (toText(row.instrument)) {
    out.instrument_family = [toText(row.instrument)];
    out.instrument_labels = [toText(row.instrument)];
  }
  if (toText(row.title_raw)) out.title_raw = toText(row.title_raw);
  if (toText(row.entry_href)) out.entry_href = normalizeHref(row.entry_href);
  out.status = toText(row.status) || 'active';
  return out;
}

function createSyntheticEntry(row) {
  const instrument = toText(row.instrument) || 'Unknown';
  const performer = toText(row.performer) || 'Unknown';
  const title = toText(row.title_raw) || `${performer} — ${instrument}`;
  const href = normalizeHref(row.entry_href);
  const id = toText(row.entry_id) || toText(href).replace(/^\/entry\//, '').replace(/\/$/, '');
  return {
    id,
    title_raw: title,
    performer_raw: performer,
    instrument_family: [instrument],
    instrument_labels: [instrument],
    lookup_raw: toText(row.lookup_number),
    season: toText(row.season),
    entry_href: href,
    image_src: '',
    image_alt_raw: '',
    featured: false,
    sort_key: id || href,
    title_norm: '',
    performer_norm: '',
    lookup_norm: '',
    instrument_norm: '',
    status: toText(row.status) || 'draft',
  };
}

export function getCatalogEditorialFilePath(customPath) {
  return customPath ? path.resolve(customPath) : DEFAULT_CATALOG_EDITORIAL_PATH;
}

export function defaultCatalogEditorialData() {
  return {
    version: CATALOG_EDITORIAL_VERSION,
    updatedAt: new Date().toISOString(),
    manifest: [],
    spotlight: {},
  };
}

export async function readCatalogEditorialFile(customPath) {
  const filePath = getCatalogEditorialFilePath(customPath);
  const text = await fs.readFile(filePath, 'utf8');
  const raw = JSON.parse(text);
  const data = normalizeCatalogEditorialFile(raw);
  return { filePath, data };
}

export async function writeCatalogEditorialFile(data, customPath) {
  const filePath = getCatalogEditorialFilePath(customPath);
  const normalized = normalizeCatalogEditorialFile({
    ...(data || defaultCatalogEditorialData()),
    version: CATALOG_EDITORIAL_VERSION,
    updatedAt: new Date().toISOString(),
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return { filePath, data: normalized };
}

export function upsertCatalogManifestEntry(data, patch = {}) {
  const normalized = normalizeCatalogEditorialFile(data || defaultCatalogEditorialData());
  const entryId = toText(patch.entry_id).toLowerCase();
  const entryHref = normalizeHref(patch.entry_href).toLowerCase();
  if (!entryId && !entryHref) throw new Error('manifest entry requires --entry (id or href).');

  const rows = [...normalized.manifest];
  const index = rows.findIndex((row) => {
    const sameId = entryId && toText(row.entry_id).toLowerCase() === entryId;
    const sameHref = entryHref && normalizeHref(row.entry_href).toLowerCase() === entryHref;
    return sameId || sameHref;
  });

  const existing = index >= 0 ? rows[index] : {
    entry_id: toText(patch.entry_id || '').trim() || normalizeHref(patch.entry_href).replace(/^\/entry\//, '').replace(/\/$/, ''),
    entry_href: normalizeHref(patch.entry_href),
    title_raw: '',
    lookup_number: '',
    season: '',
    performer: '',
    instrument: '',
    status: 'active',
  };

  const next = {
    ...existing,
    ...patch,
    entry_id: toText(patch.entry_id ?? existing.entry_id),
    entry_href: normalizeHref(patch.entry_href ?? existing.entry_href),
    title_raw: toText(patch.title_raw ?? existing.title_raw),
    lookup_number: toText(patch.lookup_number ?? existing.lookup_number),
    season: toText(patch.season ?? existing.season),
    performer: toText(patch.performer ?? existing.performer),
    instrument: toText(patch.instrument ?? existing.instrument),
    status: toText(patch.status ?? existing.status) || 'active',
  };

  if (!toText(next.entry_href) && toText(next.entry_id)) {
    next.entry_href = canonicalEntryHrefFromId(next.entry_id);
  }

  const mergedRows = index >= 0
    ? rows.map((row, rowIndex) => (rowIndex === index ? next : row))
    : [...rows, next];

  return normalizeCatalogEditorialFile({
    ...normalized,
    manifest: mergedRows,
  });
}

export function findCatalogManifestEntry(data, token) {
  const normalized = normalizeCatalogEditorialFile(data || defaultCatalogEditorialData());
  const needle = toText(token).toLowerCase();
  if (!needle) return null;
  return (normalized.manifest || []).find((row) => {
    const rowId = toText(row.entry_id).toLowerCase();
    const href = normalizeHref(row.entry_href).toLowerCase();
    const slug = href.replace(/^\/entry\//, '').replace(/\/$/, '');
    return rowId === needle || href === normalizeHref(needle).toLowerCase() || slug === needle;
  }) || null;
}

export function removeCatalogManifestEntry(data, token) {
  const normalized = normalizeCatalogEditorialFile(data || defaultCatalogEditorialData());
  const needle = toText(token).toLowerCase();
  if (!needle) throw new Error('entry token is required.');

  const nextRows = normalized.manifest.filter((row) => {
    const id = toText(row.entry_id).toLowerCase();
    const href = normalizeHref(row.entry_href).toLowerCase();
    return id !== needle && href !== needle;
  });

  if (nextRows.length === normalized.manifest.length) {
    throw new Error(`catalog manifest entry not found: ${token}`);
  }

  return normalizeCatalogEditorialFile({
    ...normalized,
    manifest: nextRows,
  });
}

export function setCatalogSpotlight(data, patch = {}) {
  const normalized = normalizeCatalogEditorialFile(data || defaultCatalogEditorialData());
  const spotlight = {
    ...(normalized.spotlight || {}),
    ...patch,
  };

  if (!toText(spotlight.entry_id)) {
    throw new Error('spotlight entry_id is required.');
  }

  return normalizeCatalogEditorialFile({
    ...normalized,
    spotlight,
  });
}

export function applyCatalogEditorialToModel(model, editorialData) {
  const editorial = normalizeCatalogEditorialFile(editorialData || defaultCatalogEditorialData());
  const nextModel = {
    ...model,
    entries: Array.isArray(model?.entries) ? model.entries.map((entry) => ({ ...entry })) : [],
    spotlight: { ...(model?.spotlight || {}) },
  };

  const maps = toManifestMap(editorial.manifest);
  const touched = new Set();
  nextModel.entries = nextModel.entries.map((entry) => {
    const row = chooseManifestRow(entry, maps);
    if (!row) return ensureCatalogEntryShape(entry, { includeSearchFields: true });
    touched.add(toText(row.entry_id).toLowerCase());
    return normalizeModelEntry(entry, row);
  });

  for (const row of editorial.manifest) {
    const rowId = toText(row.entry_id).toLowerCase();
    if (rowId && touched.has(rowId)) continue;
    const href = normalizeHref(row.entry_href);
    if (!href || !href.startsWith('/entry/')) continue;
    const synthetic = createSyntheticEntry(row);
    nextModel.entries.push(synthetic);
  }

  if (toText(editorial.spotlight?.entry_id)) {
    const entry = nextModel.entries.find((candidate) => {
      const sameId = toText(candidate.id).toLowerCase() === toText(editorial.spotlight.entry_id).toLowerCase();
      const sameHref = normalizeHref(candidate.entry_href).toLowerCase() === normalizeHref(editorial.spotlight.entry_href).toLowerCase();
      return sameId || sameHref;
    });

    nextModel.spotlight = {
      ...nextModel.spotlight,
      ...editorial.spotlight,
      entry_id: toText(editorial.spotlight.entry_id),
      cta_href: entry ? normalizeHref(entry.entry_href) : normalizeHref(editorial.spotlight.entry_href || nextModel.spotlight.cta_href),
      subhead_raw: toText(editorial.spotlight.subhead_raw || entry?.title_raw || nextModel.spotlight.subhead_raw),
      body_raw: toText(editorial.spotlight.body_raw || entry?.performer_raw || nextModel.spotlight.body_raw),
      cta_label_raw: toText(editorial.spotlight.cta_label_raw || nextModel.spotlight.cta_label_raw || 'VIEW COLLECTION'),
    };
  }

  return nextModel;
}

export function buildCatalogManifestSnapshot(model, editorialData) {
  const normalizedModel = applyCatalogEditorialToModel(model, editorialData);
  const rows = (Array.isArray(normalizedModel.entries) ? normalizedModel.entries : []).map((entry) => ({
    entry_id: toText(entry.id),
    entry_href: normalizeHref(entry.entry_href),
    lookup_number: toText(entry.lookup_raw),
    season: toText(entry.season),
    performer: toText(entry.performer_raw),
    instrument: Array.isArray(entry.instrument_family) && entry.instrument_family.length
      ? toText(entry.instrument_family[0])
      : (Array.isArray(entry.instrument_labels) && entry.instrument_labels.length ? toText(entry.instrument_labels[0]) : ''),
    status: toText(entry.status) || 'active',
    updated_at: new Date().toISOString(),
  }));

  return {
    version: CATALOG_EDITORIAL_VERSION,
    updatedAt: new Date().toISOString(),
    manifest: rows,
    spotlight: {
      entry_id: toText(normalizedModel?.spotlight?.entry_id),
      headline_raw: toText(normalizedModel?.spotlight?.headline_raw),
      cta_label_raw: toText(normalizedModel?.spotlight?.cta_label_raw),
      cta_href: normalizeHref(normalizedModel?.spotlight?.cta_href),
      subhead_raw: toText(normalizedModel?.spotlight?.subhead_raw),
      body_raw: toText(normalizedModel?.spotlight?.body_raw),
      image_src: toText(normalizedModel?.spotlight?.image_src),
    },
  };
}
