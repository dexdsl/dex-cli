import { z } from 'zod';

export const CATALOG_EDITORIAL_VERSION = 'catalog-editorial-v1';
export const CATALOG_EDITORIAL_STATUS_VALUES = ['active', 'draft', 'archived'];

const isoDateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'Invalid ISO timestamp',
});

const manifestEntrySchema = z.object({
  entry_id: z.string().trim().min(1).max(160),
  entry_href: z.string().trim().min(1).max(500).optional(),
  title_raw: z.string().trim().max(240).optional(),
  lookup_number: z.string().trim().max(120).optional(),
  season: z.string().trim().max(64).optional(),
  performer: z.string().trim().max(240).optional(),
  instrument: z.string().trim().max(240).optional(),
  status: z.enum(CATALOG_EDITORIAL_STATUS_VALUES).optional(),
});

const spotlightSchema = z.object({
  entry_id: z.string().trim().max(160).optional(),
  headline_raw: z.string().trim().max(160).optional(),
  subhead_raw: z.string().trim().max(240).optional(),
  body_raw: z.string().trim().max(640).optional(),
  cta_label_raw: z.string().trim().max(80).optional(),
  image_src: z.string().trim().max(1000).optional(),
}).optional();

const catalogEditorialSchema = z.object({
  version: z.literal(CATALOG_EDITORIAL_VERSION),
  updatedAt: isoDateString,
  manifest: z.array(manifestEntrySchema),
  spotlight: spotlightSchema,
});

function toText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHref(value) {
  const raw = toText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const path = toText(parsed.pathname || '/');
      if (path.startsWith('/entry/')) return path.endsWith('/') ? path : `${path}/`;
      return raw;
    } catch {
      return raw;
    }
  }
  if (raw.startsWith('/entry/')) return raw.endsWith('/') ? raw : `${raw}/`;
  return raw;
}

function normalizeSeason(value) {
  const raw = toText(value);
  if (!raw) return '';
  const match = raw.toUpperCase().match(/^S\d+$/);
  return match ? match[0] : raw;
}

function normalizeManifestEntry(entry) {
  const entryId = toText(entry?.entry_id);
  if (!entryId) throw new Error('manifest entry_id is required.');
  const normalized = {
    entry_id: entryId,
    entry_href: normalizeHref(entry?.entry_href),
    title_raw: toText(entry?.title_raw),
    lookup_number: toText(entry?.lookup_number),
    season: normalizeSeason(entry?.season),
    performer: toText(entry?.performer),
    instrument: toText(entry?.instrument),
    status: CATALOG_EDITORIAL_STATUS_VALUES.includes(toText(entry?.status)) ? toText(entry?.status) : 'active',
  };
  return normalized;
}

function normalizeSpotlight(spotlight) {
  if (!spotlight || typeof spotlight !== 'object') return {};
  return {
    entry_id: toText(spotlight.entry_id),
    headline_raw: toText(spotlight.headline_raw),
    subhead_raw: toText(spotlight.subhead_raw),
    body_raw: toText(spotlight.body_raw),
    cta_label_raw: toText(spotlight.cta_label_raw),
    image_src: toText(spotlight.image_src),
  };
}

function sortManifest(entries = []) {
  return [...entries].sort((a, b) => String(a.entry_id || '').localeCompare(String(b.entry_id || '')));
}

function dedupeManifest(entries = []) {
  const seenId = new Set();
  const seenHref = new Set();
  const out = [];
  for (const entry of entries) {
    const key = String(entry.entry_id || '').toLowerCase();
    if (seenId.has(key)) {
      throw new Error(`Duplicate catalog manifest entry_id: ${entry.entry_id}`);
    }
    seenId.add(key);

    const href = String(entry.entry_href || '').trim().toLowerCase();
    if (href) {
      if (seenHref.has(href)) throw new Error(`Duplicate catalog manifest entry_href: ${entry.entry_href}`);
      seenHref.add(href);
    }

    out.push(entry);
  }
  return out;
}

export function normalizeCatalogEditorialFile(rawValue) {
  const parsed = catalogEditorialSchema.parse(rawValue);
  const manifest = dedupeManifest(sortManifest(parsed.manifest.map(normalizeManifestEntry)));
  return {
    version: CATALOG_EDITORIAL_VERSION,
    updatedAt: new Date(parsed.updatedAt).toISOString(),
    manifest,
    spotlight: normalizeSpotlight(parsed.spotlight),
  };
}

export function validateCatalogEditorialFile(rawValue) {
  return normalizeCatalogEditorialFile(rawValue);
}

export const catalogEditorialJsonSchema = catalogEditorialSchema;
