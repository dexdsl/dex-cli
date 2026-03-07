import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOME_FEATURED_VERSION,
  normalizeHomeFeaturedFile,
} from './home-featured-schema.mjs';
import {
  buildHomeFeaturedSnapshot,
  defaultHomeFeaturedData,
  readHomeFeaturedFile,
  writeHomeFeaturedFile,
} from './home-featured-store.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_API_BY_ENV = {
  prod: 'https://dex-api.spring-fog-8edd.workers.dev',
  test: 'https://dex-api.spring-fog-8edd.workers.dev',
};

const CATALOG_ENTRIES_PATH = path.join(ROOT, 'data', 'catalog.entries.json');
const HOME_SNAPSHOT_PUBLIC_PATH = path.join(ROOT, 'public', 'data', 'home.featured.snapshot.json');
const HOME_SNAPSHOT_DATA_PATH = path.join(ROOT, 'data', 'home.featured.snapshot.json');
const HOME_SNAPSHOT_DOCS_PATH = path.join(ROOT, 'docs', 'data', 'home.featured.snapshot.json');

function toText(value) {
  return String(value || '').trim();
}

function normalizeEnv(value) {
  const raw = toText(value).toLowerCase();
  if (raw === 'prod' || raw === 'production') return 'prod';
  if (raw === 'test' || raw === 'staging' || raw === 'sandbox') return 'test';
  throw new Error(`Unsupported home env: ${value}`);
}

function normalizeApiBase(value) {
  const parsed = new URL(toText(value));
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported home API protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

function resolveHomeApiBase(env = 'test') {
  const normalized = normalizeEnv(env);
  const fromEnv = normalized === 'prod'
    ? process.env.DEX_HOME_API_BASE_PROD || process.env.DEX_API_BASE_PROD || process.env.DEX_API_BASE_URL
    : process.env.DEX_HOME_API_BASE_TEST || process.env.DEX_API_BASE_TEST || process.env.DEX_API_BASE_URL;
  return normalizeApiBase(fromEnv || DEFAULT_API_BY_ENV[normalized]);
}

function resolveHomeAdminToken(env = 'test', { required = true } = {}) {
  const normalized = normalizeEnv(env);
  const direct = normalized === 'prod'
    ? process.env.DEX_HOME_ADMIN_TOKEN_PROD || process.env.HOME_ADMIN_TOKEN_PROD
    : process.env.DEX_HOME_ADMIN_TOKEN_TEST || process.env.HOME_ADMIN_TOKEN_TEST;
  const shared = process.env.DEX_HOME_ADMIN_TOKEN || process.env.HOME_ADMIN_TOKEN || process.env.DEX_MAINTENANCE_TOKEN;
  const token = toText(direct || shared);
  if (required && !token) {
    throw new Error(`Missing home admin token for ${normalized}. Set DEX_HOME_ADMIN_TOKEN_${normalized.toUpperCase()} or DEX_HOME_ADMIN_TOKEN.`);
  }
  return token;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function readCatalogEntries() {
  const raw = JSON.parse(fsSync.readFileSync(CATALOG_ENTRIES_PATH, 'utf8'));
  return Array.isArray(raw?.entries) ? raw.entries : [];
}

export function buildHomePublishPayload(homeData, { catalogEntries } = {}) {
  const normalized = normalizeHomeFeaturedFile(homeData || defaultHomeFeaturedData());
  const entries = Array.isArray(catalogEntries) ? catalogEntries : readCatalogEntries();
  const snapshot = buildHomeFeaturedSnapshot(normalized, { catalogEntries: entries, requireCatalogMatch: true });
  const payload = {
    version: HOME_FEATURED_VERSION,
    updatedAt: normalized.updatedAt,
    maxSlots: normalized.maxSlots,
    featured: normalized.featured,
    snapshot,
  };

  return {
    payload,
    manifestHash: hashValue(payload),
    counts: {
      featured: normalized.featured.length,
    },
  };
}

async function requestJson(pathname, {
  method = 'GET',
  env = 'test',
  body,
  apiBase,
  adminToken,
  requiredToken = true,
} = {}) {
  const normalizedEnv = normalizeEnv(env);
  const resolvedApiBase = apiBase ? normalizeApiBase(apiBase) : resolveHomeApiBase(normalizedEnv);
  const token = toText(adminToken || resolveHomeAdminToken(normalizedEnv, { required: requiredToken }));
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${resolvedApiBase}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    const detail = parsed?.error || parsed?.detail || response.statusText;
    const err = new Error(`${method} ${pathname} failed (${response.status}): ${detail}`);
    err.status = response.status;
    err.payload = parsed;
    throw err;
  }

  return {
    env: normalizedEnv,
    apiBase: resolvedApiBase,
    payload: parsed,
  };
}

function diffRowsByEntry(localRows = [], remoteRows = []) {
  const local = new Map(localRows.map((row) => [String(row.entry_id || ''), row]));
  const remote = new Map(remoteRows.map((row) => [String(row.entry_id || ''), row]));
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const key of local.keys()) {
    if (!remote.has(key)) {
      added += 1;
      continue;
    }
    if (stableStringify(local.get(key)) !== stableStringify(remote.get(key))) changed += 1;
  }
  for (const key of remote.keys()) {
    if (!local.has(key)) removed += 1;
  }
  return { added, removed, changed };
}

export async function readHomeFeaturedSource(customPath) {
  const { filePath, data } = await readHomeFeaturedFile(customPath);
  const built = buildHomePublishPayload(data, { catalogEntries: readCatalogEntries() });
  return { filePath, data, built };
}

export async function publishHomeFeatured({
  env = 'test',
  filePath,
  dryRun = false,
  apiBase,
  adminToken,
} = {}) {
  const source = await readHomeFeaturedSource(filePath);
  const response = await requestJson('/admin/home/publish', {
    method: 'POST',
    env,
    apiBase,
    adminToken,
    body: {
      ...source.built.payload,
      manifestHash: source.built.manifestHash,
      dryRun: Boolean(dryRun),
    },
  });

  return {
    env: response.env,
    apiBase: response.apiBase,
    manifestHash: source.built.manifestHash,
    counts: source.built.counts,
    dryRun: Boolean(dryRun),
    remote: response.payload,
    local: source.built.payload,
    filePath: source.filePath,
  };
}

export async function pullHomeFeatured({
  env = 'test',
  apiBase,
  adminToken,
  writeLocal = true,
} = {}) {
  const response = await requestJson('/admin/home/state', {
    method: 'GET',
    env,
    apiBase,
    adminToken,
  });

  const payload = response.payload || {};
  const state = {
    version: HOME_FEATURED_VERSION,
    updatedAt: toText(payload.updatedAt || new Date().toISOString()),
    maxSlots: Number.isFinite(Number(payload.maxSlots)) ? Number(payload.maxSlots) : 4,
    featured: Array.isArray(payload.featured) ? payload.featured : [],
  };

  let written = null;
  if (writeLocal) {
    written = await writeHomeFeaturedFile(state);
    const snapshot = payload.snapshot && typeof payload.snapshot === 'object'
      ? payload.snapshot
      : buildHomePublishPayload(written.data, { catalogEntries: readCatalogEntries() }).payload.snapshot;
    await fs.mkdir(path.dirname(HOME_SNAPSHOT_PUBLIC_PATH), { recursive: true });
    await fs.writeFile(HOME_SNAPSHOT_PUBLIC_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await fs.mkdir(path.dirname(HOME_SNAPSHOT_DATA_PATH), { recursive: true });
    await fs.writeFile(HOME_SNAPSHOT_DATA_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await fs.mkdir(path.dirname(HOME_SNAPSHOT_DOCS_PATH), { recursive: true });
    await fs.writeFile(HOME_SNAPSHOT_DOCS_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  return {
    env: response.env,
    apiBase: response.apiBase,
    state,
    written,
    remote: payload,
  };
}

export async function diffHomeFeatured({
  env = 'test',
  filePath,
  apiBase,
  adminToken,
} = {}) {
  const source = await readHomeFeaturedSource(filePath);
  const response = await requestJson('/admin/home/state', {
    method: 'GET',
    env,
    apiBase,
    adminToken,
  });

  const remote = response.payload || {};
  const localPayload = source.built.payload;
  const remotePayload = {
    maxSlots: Number.isFinite(Number(remote.maxSlots)) ? Number(remote.maxSlots) : 4,
    featured: Array.isArray(remote.featured) ? remote.featured : [],
  };

  return {
    env: response.env,
    apiBase: response.apiBase,
    localHash: hashValue(localPayload),
    remoteHash: hashValue(remotePayload),
    featured: diffRowsByEntry(localPayload.featured, remotePayload.featured),
    counts: {
      local: { featured: localPayload.featured.length },
      remote: { featured: remotePayload.featured.length },
    },
  };
}

export async function writeHomeSnapshotFromLocal({
  filePath,
  publicPath = HOME_SNAPSHOT_PUBLIC_PATH,
  dataPath = HOME_SNAPSHOT_DATA_PATH,
  docsPath = HOME_SNAPSHOT_DOCS_PATH,
} = {}) {
  const source = await readHomeFeaturedSource(filePath);
  const snapshot = source.built.payload.snapshot;
  await fs.mkdir(path.dirname(publicPath), { recursive: true });
  await fs.writeFile(publicPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await fs.mkdir(path.dirname(docsPath), { recursive: true });
  await fs.writeFile(docsPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return {
    snapshot,
    filePath: source.filePath,
    paths: { publicPath, dataPath, docsPath },
  };
}
