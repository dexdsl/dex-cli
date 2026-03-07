import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOME_FEATURED_VERSION,
  normalizeHomeFeaturedFile,
} from './home-featured-schema.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_HOME_FEATURED_PATH = path.join(ROOT, 'data', 'home.featured.json');

function toText(value) {
  return String(value || '').trim();
}

function normalizeHref(value) {
  const raw = toText(value);
  if (!raw) return '';
  if (raw.startsWith('/entry/')) return raw.endsWith('/') ? raw : `${raw}/`;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.pathname.startsWith('/entry/')) return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
      return raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function getHomeFeaturedFilePath(customPath) {
  return customPath ? path.resolve(customPath) : DEFAULT_HOME_FEATURED_PATH;
}

export function defaultHomeFeaturedData() {
  return {
    version: HOME_FEATURED_VERSION,
    updatedAt: new Date().toISOString(),
    maxSlots: 4,
    featured: [],
  };
}

export async function readHomeFeaturedFile(customPath) {
  const filePath = getHomeFeaturedFilePath(customPath);
  const text = await fs.readFile(filePath, 'utf8');
  const raw = JSON.parse(text);
  const data = normalizeHomeFeaturedFile(raw);
  return { filePath, data };
}

export async function writeHomeFeaturedFile(data, customPath) {
  const filePath = getHomeFeaturedFilePath(customPath);
  const normalized = normalizeHomeFeaturedFile({
    ...(data || defaultHomeFeaturedData()),
    version: HOME_FEATURED_VERSION,
    updatedAt: new Date().toISOString(),
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return { filePath, data: normalized };
}

export function upsertHomeFeaturedItems(data, entryIds = [], catalogEntries = []) {
  const normalized = normalizeHomeFeaturedFile(data || defaultHomeFeaturedData());
  const ids = String(entryIds || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error('featured entries list cannot be empty');

  const catalogById = new Map((Array.isArray(catalogEntries) ? catalogEntries : []).map((entry) => [String(entry.id || '').toLowerCase(), entry]));

  const nextFeatured = ids.map((entryId, index) => {
    const entry = catalogById.get(entryId.toLowerCase()) || {};
    const href = normalizeHref(entry.entry_href || '');
    return {
      slot_index: index,
      entry_id: entryId,
      entry_href: href,
      lookup: toText(entry.lookup_raw),
      artist: toText(entry.performer_raw),
      instrument: Array.isArray(entry.instrument_labels) && entry.instrument_labels.length
        ? toText(entry.instrument_labels[0])
        : (Array.isArray(entry.instrument_family) && entry.instrument_family.length ? toText(entry.instrument_family[0]) : ''),
      season: toText(entry.season),
      tags: ['dexFest'],
      leadIn: '',
      video: '',
      thumbnail: toText(entry.image_src),
      date: '',
      label_override: '',
    };
  });

  return normalizeHomeFeaturedFile({
    ...normalized,
    featured: nextFeatured,
  });
}

export function reorderHomeFeaturedItems(data, entryIds = []) {
  const normalized = normalizeHomeFeaturedFile(data || defaultHomeFeaturedData());
  const ids = String(entryIds || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error('reorder list cannot be empty');

  const rowById = new Map(normalized.featured.map((row) => [String(row.entry_id || '').toLowerCase(), row]));
  const next = ids.map((entryId, index) => {
    const row = rowById.get(entryId.toLowerCase());
    if (!row) throw new Error(`home featured entry not found: ${entryId}`);
    return {
      ...row,
      slot_index: index,
    };
  });

  return normalizeHomeFeaturedFile({
    ...normalized,
    featured: next,
  });
}

export function buildHomeFeaturedSnapshot(homeData, { catalogEntries = [], requireCatalogMatch = true } = {}) {
  const normalized = normalizeHomeFeaturedFile(homeData || defaultHomeFeaturedData());
  const catalogById = new Map((Array.isArray(catalogEntries) ? catalogEntries : []).map((entry) => [String(entry.id || '').toLowerCase(), entry]));

  const cards = normalized.featured.map((row) => {
    const catalogEntry = catalogById.get(String(row.entry_id || '').toLowerCase()) || null;
    if (requireCatalogMatch && !catalogEntry) {
      throw new Error(`home featured entry missing from catalog manifest: ${row.entry_id}`);
    }
    return {
      slot_index: row.slot_index,
      entry_id: row.entry_id,
      lookup: toText(row.lookup || catalogEntry?.lookup_raw),
      artist: toText(row.label_override || row.artist || catalogEntry?.performer_raw),
      instrument: toText(row.instrument || (Array.isArray(catalogEntry?.instrument_labels) ? catalogEntry.instrument_labels[0] : '')),
      season: toText(row.season || catalogEntry?.season),
      tags: Array.isArray(row.tags) && row.tags.length ? row.tags : ['dexFest'],
      leadIn: toText(row.leadIn),
      video: toText(row.video),
      url: normalizeHref(row.entry_href || catalogEntry?.entry_href),
      thumbnail: toText(row.thumbnail || catalogEntry?.image_src),
      date: toText(row.date),
    };
  });

  return {
    version: HOME_FEATURED_VERSION,
    updatedAt: new Date().toISOString(),
    maxSlots: normalized.maxSlots,
    featured: cards,
  };
}
