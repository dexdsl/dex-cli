import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_SEASONS_VERSION,
  CATALOG_UNANNOUNCED_MESSAGE_DEFAULT,
  CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT,
  normalizeCatalogSeasonsFile,
} from './catalog-seasons-schema.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_CATALOG_SEASONS_PATH = path.join(ROOT, 'data', 'catalog.seasons.json');

export function getCatalogSeasonsFilePath(customPath) {
  return customPath ? path.resolve(customPath) : DEFAULT_CATALOG_SEASONS_PATH;
}

export function defaultCatalogSeasonsData() {
  return {
    version: CATALOG_SEASONS_VERSION,
    updatedAt: new Date().toISOString(),
    seasons: [],
  };
}

export async function readCatalogSeasonsFile(customPath) {
  const filePath = getCatalogSeasonsFilePath(customPath);
  const text = await fs.readFile(filePath, 'utf8');
  const raw = JSON.parse(text);
  const normalized = normalizeCatalogSeasonsFile(raw);
  return { filePath, data: normalized };
}

export async function writeCatalogSeasonsFile(data, customPath) {
  const filePath = getCatalogSeasonsFilePath(customPath);
  const normalized = normalizeCatalogSeasonsFile({
    ...data,
    version: CATALOG_SEASONS_VERSION,
    updatedAt: new Date().toISOString(),
  });

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return { filePath, data: normalized };
}

export function ensureSeason(data, seasonId, patch = {}) {
  const normalized = normalizeCatalogSeasonsFile(data || defaultCatalogSeasonsData());
  const id = String(seasonId || '').trim().toUpperCase();
  if (!id) throw new Error('Season id is required.');

  const existing = normalized.seasons.find((season) => season.id === id);
  if (existing) {
    const merged = {
      ...existing,
      ...patch,
      unannounced: {
        ...existing.unannounced,
        ...(patch.unannounced || {}),
      },
    };
    const next = {
      ...normalized,
      seasons: normalized.seasons.map((season) => (season.id === id ? merged : season)),
    };
    return normalizeCatalogSeasonsFile(next);
  }

  const inferredOrderMatch = id.match(/^S(\d+)$/);
  const inferredOrder = inferredOrderMatch ? Number(inferredOrderMatch[1]) : 0;
  const created = {
    id,
    label: patch.label || `season ${inferredOrder || id}`,
    order: Number.isFinite(Number(patch.order)) ? Number(patch.order) : inferredOrder,
    unannounced: {
      enabled: Boolean(patch.unannounced?.enabled),
      count: Number.isFinite(Number(patch.unannounced?.count)) ? Number(patch.unannounced.count) : 1,
      message: patch.unannounced?.message || CATALOG_UNANNOUNCED_MESSAGE_DEFAULT,
      tokenPool: Array.isArray(patch.unannounced?.tokenPool)
        ? patch.unannounced.tokenPool
        : [...CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT],
      style: patch.unannounced?.style || 'redacted',
    },
  };
  return normalizeCatalogSeasonsFile({
    ...normalized,
    seasons: [...normalized.seasons, created],
  });
}

export function getSeason(data, seasonId) {
  const normalized = normalizeCatalogSeasonsFile(data || defaultCatalogSeasonsData());
  const id = String(seasonId || '').trim().toUpperCase();
  return normalized.seasons.find((season) => season.id === id) || null;
}
