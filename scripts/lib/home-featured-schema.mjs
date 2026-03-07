import { z } from 'zod';

export const HOME_FEATURED_VERSION = 'home-featured-v1';

const isoDateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'Invalid ISO timestamp',
});

const featuredItemSchema = z.object({
  slot_index: z.number().int().min(0).max(64),
  entry_id: z.string().trim().min(1).max(160),
  entry_href: z.string().trim().min(1).max(500).optional(),
  lookup: z.string().trim().max(120).optional(),
  artist: z.string().trim().max(240).optional(),
  instrument: z.string().trim().max(240).optional(),
  season: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  leadIn: z.string().trim().max(320).optional(),
  video: z.string().trim().max(1000),
  thumbnail: z.string().trim().max(1000).optional(),
  date: z.string().trim().max(64).optional(),
  label_override: z.string().trim().max(240).optional(),
});

const homeFeaturedSchema = z.object({
  version: z.literal(HOME_FEATURED_VERSION),
  updatedAt: isoDateString,
  maxSlots: z.number().int().min(1).max(12).optional(),
  featured: z.array(featuredItemSchema),
});

function toText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function normalizeTags(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const token = toText(value);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function normalizeFeaturedItem(item) {
  return {
    slot_index: Number(item?.slot_index || 0),
    entry_id: toText(item?.entry_id),
    entry_href: normalizeHref(item?.entry_href),
    lookup: toText(item?.lookup),
    artist: toText(item?.artist),
    instrument: toText(item?.instrument),
    season: toText(item?.season),
    tags: normalizeTags(Array.isArray(item?.tags) ? item.tags : ['dexFest']),
    leadIn: toText(item?.leadIn),
    video: toText(item?.video),
    thumbnail: toText(item?.thumbnail),
    date: toText(item?.date),
    label_override: toText(item?.label_override),
  };
}

function dedupeRows(rows = []) {
  const bySlot = new Set();
  const byEntry = new Set();
  const out = [];
  for (const row of rows) {
    if (bySlot.has(row.slot_index)) {
      throw new Error(`Duplicate home featured slot_index: ${row.slot_index}`);
    }
    bySlot.add(row.slot_index);

    const entryKey = String(row.entry_id || '').toLowerCase();
    if (byEntry.has(entryKey)) {
      throw new Error(`Duplicate home featured entry_id: ${row.entry_id}`);
    }
    byEntry.add(entryKey);
    out.push(row);
  }
  return out;
}

function sortRows(rows = []) {
  return [...rows].sort((a, b) => Number(a.slot_index || 0) - Number(b.slot_index || 0));
}

export function normalizeHomeFeaturedFile(rawValue) {
  const parsed = homeFeaturedSchema.parse(rawValue);
  const featured = dedupeRows(sortRows(parsed.featured.map(normalizeFeaturedItem)));
  return {
    version: HOME_FEATURED_VERSION,
    updatedAt: new Date(parsed.updatedAt).toISOString(),
    maxSlots: Number.isFinite(Number(parsed.maxSlots)) ? Number(parsed.maxSlots) : 4,
    featured,
  };
}

export function validateHomeFeaturedFile(rawValue) {
  return normalizeHomeFeaturedFile(rawValue);
}

export const homeFeaturedJsonSchema = homeFeaturedSchema;
