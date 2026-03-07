import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_EDITORIAL_VERSION,
  normalizeCatalogEditorialFile,
} from './catalog-editorial-schema.mjs';
import {
  applyCatalogEditorialToModel,
  buildCatalogManifestSnapshot,
  defaultCatalogEditorialData,
  readCatalogEditorialFile,
  writeCatalogEditorialFile,
} from './catalog-editorial-store.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_API_BY_ENV = {
  prod: 'https://dex-api.spring-fog-8edd.workers.dev',
  test: 'https://dex-api.spring-fog-8edd.workers.dev',
};

const CATALOG_DATA_PATH = path.join(ROOT, 'data', 'catalog.data.json');
const CATALOG_SNAPSHOT_PUBLIC_PATH = path.join(ROOT, 'public', 'data', 'catalog.curation.snapshot.json');
const CATALOG_SNAPSHOT_DATA_PATH = path.join(ROOT, 'data', 'catalog.curation.snapshot.json');
const CATALOG_SNAPSHOT_DOCS_PATH = path.join(ROOT, 'docs', 'data', 'catalog.curation.snapshot.json');

function toText(value) {
  return String(value || '').trim();
}

function normalizeEnv(value) {
  const raw = toText(value).toLowerCase();
  if (raw === 'prod' || raw === 'production') return 'prod';
  if (raw === 'test' || raw === 'staging' || raw === 'sandbox') return 'test';
  throw new Error(`Unsupported catalog env: ${value}`);
}

function normalizeApiBase(value) {
  const parsed = new URL(toText(value));
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported catalog API protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

function resolveCatalogApiBase(env = 'test') {
  const normalized = normalizeEnv(env);
  const fromEnv = normalized === 'prod'
    ? process.env.DEX_CATALOG_API_BASE_PROD || process.env.DEX_API_BASE_PROD || process.env.DEX_API_BASE_URL
    : process.env.DEX_CATALOG_API_BASE_TEST || process.env.DEX_API_BASE_TEST || process.env.DEX_API_BASE_URL;
  return normalizeApiBase(fromEnv || DEFAULT_API_BY_ENV[normalized]);
}

function resolveCatalogAdminToken(env = 'test', { required = true } = {}) {
  const normalized = normalizeEnv(env);
  const direct = normalized === 'prod'
    ? process.env.DEX_CATALOG_ADMIN_TOKEN_PROD || process.env.CATALOG_ADMIN_TOKEN_PROD
    : process.env.DEX_CATALOG_ADMIN_TOKEN_TEST || process.env.CATALOG_ADMIN_TOKEN_TEST;
  const shared = process.env.DEX_CATALOG_ADMIN_TOKEN || process.env.CATALOG_ADMIN_TOKEN || process.env.DEX_MAINTENANCE_TOKEN;
  const token = toText(direct || shared);
  if (required && !token) {
    throw new Error(`Missing catalog admin token for ${normalized}. Set DEX_CATALOG_ADMIN_TOKEN_${normalized.toUpperCase()} or DEX_CATALOG_ADMIN_TOKEN.`);
  }
  return token;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeManifestRow(row) {
  return {
    entry_id: toText(row.entry_id),
    entry_href: toText(row.entry_href),
    lookup_number: toText(row.lookup_number),
    season: toText(row.season),
    performer: toText(row.performer),
    instrument: toText(row.instrument),
    status: toText(row.status || 'active') || 'active',
  };
}

function readCatalogModel() {
  const text = fsSync.readFileSync(CATALOG_DATA_PATH, 'utf8');
  const raw = JSON.parse(text);
  return raw;
}

export function buildCatalogPublishPayload(editorialData, { catalogModel } = {}) {
  const editorial = normalizeCatalogEditorialFile(editorialData || defaultCatalogEditorialData());
  const model = catalogModel || readCatalogModel();
  const curated = applyCatalogEditorialToModel(model, editorial);
  const snapshot = buildCatalogManifestSnapshot(curated, editorial);

  const payload = {
    version: CATALOG_EDITORIAL_VERSION,
    updatedAt: editorial.updatedAt,
    manifest: (Array.isArray(editorial.manifest) ? editorial.manifest : []).map(normalizeManifestRow),
    spotlight: {
      entry_id: toText(editorial.spotlight?.entry_id),
      headline_raw: toText(editorial.spotlight?.headline_raw),
      subhead_raw: toText(editorial.spotlight?.subhead_raw),
      body_raw: toText(editorial.spotlight?.body_raw),
      cta_label_raw: toText(editorial.spotlight?.cta_label_raw),
      cta_href: toText(curated?.spotlight?.cta_href || editorial.spotlight?.cta_href),
      image_src: toText(editorial.spotlight?.image_src || curated?.spotlight?.image_src),
    },
    snapshot,
  };

  const manifestHash = hashValue(payload);
  return {
    payload,
    manifestHash,
    counts: {
      manifest: payload.manifest.length,
      snapshot: Array.isArray(snapshot.manifest) ? snapshot.manifest.length : 0,
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
  const resolvedApiBase = apiBase ? normalizeApiBase(apiBase) : resolveCatalogApiBase(normalizedEnv);
  const token = toText(adminToken || resolveCatalogAdminToken(normalizedEnv, { required: requiredToken }));
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

function diffRowsByKey(localRows = [], remoteRows = [], key = 'entry_id') {
  const local = new Map(localRows.map((row) => [String(row[key] || ''), row]));
  const remote = new Map(remoteRows.map((row) => [String(row[key] || ''), row]));

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const localKey of local.keys()) {
    if (!remote.has(localKey)) {
      added += 1;
      continue;
    }
    const a = stableStringify(local.get(localKey));
    const b = stableStringify(remote.get(localKey));
    if (a !== b) changed += 1;
  }

  for (const remoteKey of remote.keys()) {
    if (!local.has(remoteKey)) removed += 1;
  }

  return { added, removed, changed };
}

export async function readCatalogEditorialSource(customPath) {
  const { data, filePath } = await readCatalogEditorialFile(customPath);
  const model = readCatalogModel();
  const built = buildCatalogPublishPayload(data, { catalogModel: model });
  return { data, filePath, built };
}

export async function publishCatalogCuration({
  env = 'test',
  filePath,
  dryRun = false,
  apiBase,
  adminToken,
} = {}) {
  const source = await readCatalogEditorialSource(filePath);
  const response = await requestJson('/admin/catalog/publish', {
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

export async function pullCatalogCuration({
  env = 'test',
  apiBase,
  adminToken,
  writeLocal = true,
} = {}) {
  const response = await requestJson('/admin/catalog/state', {
    method: 'GET',
    env,
    apiBase,
    adminToken,
  });

  const payload = response.payload || {};
  const state = {
    version: CATALOG_EDITORIAL_VERSION,
    updatedAt: toText(payload.updatedAt || new Date().toISOString()),
    manifest: Array.isArray(payload.manifest) ? payload.manifest.map(normalizeManifestRow) : [],
    spotlight: payload.spotlight && typeof payload.spotlight === 'object' ? payload.spotlight : {},
  };

  let written = null;
  if (writeLocal) {
    written = await writeCatalogEditorialFile(state);
    const snapshot = payload.snapshot && typeof payload.snapshot === 'object'
      ? payload.snapshot
      : buildCatalogPublishPayload(written.data, { catalogModel: readCatalogModel() }).payload.snapshot;
    await fs.mkdir(path.dirname(CATALOG_SNAPSHOT_PUBLIC_PATH), { recursive: true });
    await fs.writeFile(CATALOG_SNAPSHOT_PUBLIC_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await fs.mkdir(path.dirname(CATALOG_SNAPSHOT_DATA_PATH), { recursive: true });
    await fs.writeFile(CATALOG_SNAPSHOT_DATA_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await fs.mkdir(path.dirname(CATALOG_SNAPSHOT_DOCS_PATH), { recursive: true });
    await fs.writeFile(CATALOG_SNAPSHOT_DOCS_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  return {
    env: response.env,
    apiBase: response.apiBase,
    state,
    written,
    remote: payload,
  };
}

export async function diffCatalogCuration({
  env = 'test',
  filePath,
  apiBase,
  adminToken,
} = {}) {
  const source = await readCatalogEditorialSource(filePath);
  const response = await requestJson('/admin/catalog/state', {
    method: 'GET',
    env,
    apiBase,
    adminToken,
  });
  const remote = response.payload || {};

  const localPayload = source.built.payload;
  const remotePayload = {
    manifest: Array.isArray(remote.manifest) ? remote.manifest.map(normalizeManifestRow) : [],
    spotlight: remote.spotlight && typeof remote.spotlight === 'object' ? remote.spotlight : {},
  };

  const localHash = hashValue(localPayload);
  const remoteHash = hashValue(remotePayload);

  return {
    env: response.env,
    apiBase: response.apiBase,
    localHash,
    remoteHash,
    manifest: diffRowsByKey(localPayload.manifest, remotePayload.manifest, 'entry_id'),
    spotlightChanged: stableStringify(localPayload.spotlight) !== stableStringify(remotePayload.spotlight),
    counts: {
      local: {
        manifest: localPayload.manifest.length,
      },
      remote: {
        manifest: remotePayload.manifest.length,
      },
    },
  };
}

export async function writeCatalogSnapshotFromLocal({
  filePath,
  publicPath = CATALOG_SNAPSHOT_PUBLIC_PATH,
  dataPath = CATALOG_SNAPSHOT_DATA_PATH,
  docsPath = CATALOG_SNAPSHOT_DOCS_PATH,
} = {}) {
  const source = await readCatalogEditorialSource(filePath);
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
    paths: {
      publicPath,
      dataPath,
      docsPath,
    },
  };
}
