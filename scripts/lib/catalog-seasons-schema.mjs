import { z } from 'zod';

export const CATALOG_SEASONS_VERSION = 'catalog-seasons-v1';
export const CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT = ['???', '!!!', '***', '@@@'];
export const CATALOG_UNANNOUNCED_MESSAGE_DEFAULT = 'this artist has not been announced yet';
export const CATALOG_UNANNOUNCED_STYLE_VALUES = ['redacted'];

const isoDateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'Invalid ISO timestamp',
});

const unannouncedSchema = z.object({
  enabled: z.boolean().optional(),
  count: z.number().int().min(0).max(3).optional(),
  message: z.string().trim().min(1).max(240).optional(),
  tokenPool: z.array(z.string().trim().min(1).max(16)).min(1).max(16).optional(),
  style: z.enum(CATALOG_UNANNOUNCED_STYLE_VALUES).optional(),
}).optional();

const seasonSchema = z.object({
  id: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(120).optional(),
  order: z.number().int().min(-999).max(999).optional(),
  unannounced: unannouncedSchema,
});

const catalogSeasonsSchema = z.object({
  version: z.literal(CATALOG_SEASONS_VERSION),
  updatedAt: isoDateString,
  seasons: z.array(seasonSchema),
});

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeTokens(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const token = normalizeText(value);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function clampCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(0, Math.round(n)));
}

function seasonNumber(value) {
  const match = normalizeText(value).toUpperCase().match(/^S(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function fallbackSeasonLabel(id) {
  const n = seasonNumber(id);
  if (!n) return normalizeText(id).toLowerCase() || 'season';
  return `season ${n}`;
}

function normalizeUnannounced(input) {
  const enabled = Boolean(input?.enabled);
  const count = clampCount(input?.count);
  const message = normalizeText(input?.message) || CATALOG_UNANNOUNCED_MESSAGE_DEFAULT;
  const tokenPool = dedupeTokens(input?.tokenPool);
  return {
    enabled,
    count,
    message,
    tokenPool: tokenPool.length ? tokenPool : [...CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT],
    style: CATALOG_UNANNOUNCED_STYLE_VALUES.includes(input?.style) ? input.style : 'redacted',
  };
}

function normalizeSeason(input) {
  const id = normalizeText(input?.id).toUpperCase();
  if (!id) throw new Error('Season id is required.');
  const inferredOrder = seasonNumber(id);
  const rawOrder = Number(input?.order);
  const normalizedOrder = Number.isFinite(rawOrder)
    ? Math.round(rawOrder)
    : (Number.isFinite(inferredOrder) ? inferredOrder : 0);

  return {
    id,
    label: normalizeText(input?.label) || fallbackSeasonLabel(id),
    order: normalizedOrder,
    unannounced: normalizeUnannounced(input?.unannounced),
  };
}

function sortSeasons(seasons = []) {
  return [...seasons].sort((a, b) => {
    const orderDiff = Number(b.order || 0) - Number(a.order || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

export function normalizeCatalogSeasonsFile(rawValue) {
  const parsed = catalogSeasonsSchema.parse(rawValue);
  const ids = new Set();
  const seasons = sortSeasons(parsed.seasons.map(normalizeSeason));

  for (const season of seasons) {
    const key = season.id.toUpperCase();
    if (ids.has(key)) throw new Error(`Duplicate season id: ${season.id}`);
    ids.add(key);
  }

  return {
    version: CATALOG_SEASONS_VERSION,
    updatedAt: new Date(parsed.updatedAt).toISOString(),
    seasons,
  };
}

export function validateCatalogSeasonsFile(rawValue) {
  return normalizeCatalogSeasonsFile(rawValue);
}

export const catalogSeasonsJsonSchema = catalogSeasonsSchema;
