import fs from 'node:fs/promises';
import path from 'node:path';

const TRACKED_ENTRY_FILES = ['entry.json', 'description.txt', 'description.html', 'manifest.json', 'index.html'];

function toIsoDateTime(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toISOString();
}

export function resolveLifecycleForInit(now = Date.now()) {
  const isoNow = toIsoDateTime(now) || new Date().toISOString();
  return { publishedAt: isoNow, updatedAt: isoNow };
}

async function resolvePublishedFromEntryFiles(entryFolder) {
  const folder = String(entryFolder || '').trim();
  if (!folder) return '';

  let earliest = Number.POSITIVE_INFINITY;
  for (const fileName of TRACKED_ENTRY_FILES) {
    const filePath = path.join(folder, fileName);
    try {
      const stats = await fs.stat(filePath);
      if (Number.isFinite(stats.mtimeMs) && stats.mtimeMs > 0) {
        earliest = Math.min(earliest, stats.mtimeMs);
      }
    } catch {}
  }

  if (!Number.isFinite(earliest)) return '';
  return toIsoDateTime(new Date(earliest));
}

export async function resolveLifecycleForWrite({ existingLifecycle, entryFolder, now = Date.now() } = {}) {
  const isoNow = toIsoDateTime(now) || new Date().toISOString();
  const publishedAt = toIsoDateTime(existingLifecycle?.publishedAt)
    || await resolvePublishedFromEntryFiles(entryFolder)
    || isoNow;
  return { publishedAt, updatedAt: isoNow };
}
