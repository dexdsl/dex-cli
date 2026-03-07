import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_RECENTS = 50;

function configHome() {
  const custom = String(process.env.DEX_CONFIG_DIR || '').trim();
  if (custom) return path.resolve(custom);
  if (process.platform === 'win32') {
    const appData = String(process.env.APPDATA || '').trim();
    if (appData) return appData;
    return path.join(os.homedir(), 'AppData', 'Roaming');
  }
  const xdg = String(process.env.XDG_CONFIG_HOME || '').trim();
  if (xdg) return xdg;
  return path.join(os.homedir(), '.config');
}

export function getRecentsFilePath() {
  const custom = String(process.env.DEX_RECENTS_FILE || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(configHome(), 'dexdsl', 'recent.json');
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : Date.now();
}

function normalizeEntry(raw) {
  const inputPath = String(raw?.path || '').trim();
  if (!inputPath) return null;
  const absolutePath = path.resolve(inputPath);
  return {
    path: absolutePath,
    displayName: String(raw?.displayName || path.basename(absolutePath) || absolutePath),
    timestamp: normalizeTimestamp(raw?.timestamp),
  };
}

function dedupeSortLimit(entries, max = MAX_RECENTS) {
  const byPath = new Map();
  for (const entry of entries) {
    const normalized = normalizeEntry(entry);
    if (!normalized) continue;
    const existing = byPath.get(normalized.path);
    if (!existing || normalized.timestamp >= existing.timestamp) {
      byPath.set(normalized.path, normalized);
    }
  }
  return [...byPath.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, Math.max(1, max));
}

export async function loadRecents({ filePath = getRecentsFilePath(), max = MAX_RECENTS } = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeSortLimit(parsed, max);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    return [];
  }
}

export async function saveRecents(entries, { filePath = getRecentsFilePath(), max = MAX_RECENTS } = {}) {
  const normalized = dedupeSortLimit(Array.isArray(entries) ? entries : [], max);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function clearRecents(options = {}) {
  return saveRecents([], options);
}

export async function pushRecent(filePath, { displayName, timestamp = Date.now(), max = MAX_RECENTS, storePath } = {}) {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) throw new Error('pushRecent requires a file path');
  const absolutePath = path.resolve(rawPath);

  const entry = {
    path: absolutePath,
    displayName: String(displayName || path.basename(absolutePath) || absolutePath),
    timestamp: normalizeTimestamp(timestamp),
  };
  const listOptions = { filePath: storePath || getRecentsFilePath(), max };
  const current = await loadRecents(listOptions);
  return saveRecents([entry, ...current], listOptions);
}
