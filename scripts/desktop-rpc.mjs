#!/usr/bin/env node
// Request/response bridge for the Dex Ops Studio desktop app.
//
// Unlike dex-gui-bridge.mjs (which spawns the CLI and streams stdout), this
// bridge dynamically imports the SITE REPO's ground-truth modules and returns a
// single JSON result. The dex-cli repo only hosts the shell; all ops logic lives
// in /Users/seb/dexdsl.github.io/scripts/lib/* and is never duplicated here.
//
// Usage:  node scripts/desktop-rpc.mjs <op> '<json-args>'
//         echo '<json-envelope>' | node scripts/desktop-rpc.mjs
//
// Envelope (stdin) or argv form both supported:
//   { "op": "ops.list", "args": { "env": "test", "kind": "submission" },
//     "secrets": { "DEX_OPS_ADMIN_TOKEN": "..." } }
//
// Result:  { "ok": true, "result": <value> }  |  { "ok": false, "error": "..." }

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readWorkspaceConfig, resolveRepoRoot } from './lib/dex-workspace-config.mjs';

const execFileAsync = promisify(execFile);

async function runGit(args, { cwd } = {}) {
  const root = cwd || (await siteRoot());
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    return String(stdout || '').trim();
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').trim();
    throw new Error(`git ${args.join(' ')}: ${detail}`);
  }
}

// Like runGit but does NOT trim — porcelain lines can begin with a meaningful
// leading space (worktree-only changes are " M path"), which a global trim
// would strip from the first line and corrupt the parse.
async function runGitRaw(args, { cwd } = {}) {
  const root = cwd || (await siteRoot());
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    return String(stdout || '');
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').trim();
    throw new Error(`git ${args.join(' ')}: ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Site-root resolution + dynamic import of ground-truth modules
// ---------------------------------------------------------------------------

let cachedRoot = '';
async function siteRoot() {
  if (cachedRoot) return cachedRoot;
  if (process.env.DEX_SITE_ROOT) {
    cachedRoot = path.resolve(process.env.DEX_SITE_ROOT);
    return cachedRoot;
  }
  const cfg = await readWorkspaceConfig();
  const resolved = resolveRepoRoot(cfg.config, 'site');
  if (!resolved.root) {
    throw new Error(
      'site repo root is not configured. Set DEX_SITE_ROOT or add a "site" repo to ~/.config/dexdsl/workspaces.json',
    );
  }
  cachedRoot = resolved.root;
  return cachedRoot;
}

const moduleCache = new Map();
async function lib(name) {
  const root = await siteRoot();
  const file = path.join(root, 'scripts', 'lib', name);
  if (!moduleCache.has(file)) {
    moduleCache.set(file, await import(pathToFileURL(file).href));
  }
  return moduleCache.get(file);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function entriesDir() {
  return path.join(await siteRoot(), 'entries');
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj?.[key] !== undefined) out[key] = obj[key];
  return out;
}

function existsSyncSafe(abs) {
  try {
    return existsSync(abs);
  } catch {
    return false;
  }
}

// Only allow /-rooted paths under the tracked static prefixes (no traversal).
function normalizeWebPath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/') || raw.includes('..')) return '';
  const tracked = ['/assets/', '/css/', '/static/'].some((prefix) => raw.startsWith(prefix));
  if (!tracked) return '';
  return raw.replace(/\/+/g, '/');
}

function sanitizeAssetDir(value) {
  const cleaned = String(value || 'img')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.\.+/g, '')
    .replace(/[^A-Za-z0-9/_-]/g, '-');
  return cleaned || 'img';
}

function sanitizeFileName(value) {
  return path.basename(String(value || '')).replace(/[^A-Za-z0-9._-]/g, '-');
}

async function walkFiles(root, current = root) {
  const rows = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const row of rows) {
    const absolute = path.join(current, row.name);
    if (row.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (row.isFile()) files.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
  }
  return files.sort();
}

async function hashFiles(root, relativeFiles) {
  const hash = createHash('sha256');
  for (const relative of relativeFiles) {
    hash.update(relative);
    hash.update('\0');
    hash.update(await fs.readFile(path.join(root, relative)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeEntrySlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('invalid entry slug');
  return slug;
}

function entryRelevantPaths(slug) {
  return [
    `entries/${slug}`,
    `docs/entry/${slug}`,
    'data/catalog.entries.json',
    'assets/data/catalog.entries.json',
    'docs/data/catalog.entries.json',
    'public/data/catalog.entries.json',
    'data/protected.assets.json',
    'docs/data/protected.assets.json',
    'public/data/protected.assets.json',
  ];
}

// Write a source file to every served-root copy of a web path.
async function writeAssetEverywhere(inv, root, webPath, sourcePath) {
  const buf = await fs.readFile(sourcePath);
  const written = [];
  for (const { abs } of inv.mirrorRootsFor(root, webPath)) {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    written.push(abs);
  }
  return { ok: true, webPath, bytes: buf.length, written };
}

// Read protected.assets.json, mutate (or remove) a lookup, re-validate, and
// write the canonical copy + the docs/ and public/ mirrors.
async function mutateProtected(lookupNumber, mutate, { remove = false } = {}) {
  const key = String(lookupNumber || '').trim().toLowerCase();
  if (!key) throw new Error('lookupNumber is required');
  const root = await siteRoot();
  const pub = await lib('protected-assets-publisher.mjs');
  const dataPath = path.join(root, 'data', 'protected.assets.json');
  const { data } = await pub.readProtectedAssetsFile(dataPath);
  const idx = (data.lookups || []).findIndex((l) => String(l.lookupNumber).toLowerCase() === key);
  if (idx < 0) throw new Error(`lookup not found: ${lookupNumber}`);
  if (remove) data.lookups.splice(idx, 1);
  else mutate(data.lookups[idx]);

  const { data: normalized } = await pub.writeProtectedAssetsFile(data, dataPath);
  const json = `${JSON.stringify(normalized, null, 2)}\n`;
  for (const servedRoot of ['docs', 'public']) {
    const dest = path.join(root, servedRoot, 'data', 'protected.assets.json');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, json, 'utf8');
  }
  return { ok: true, lookupNumber, removed: remove, lookups: normalized.lookups.length };
}

// ---------------------------------------------------------------------------
// Dispatch table: op -> async (args) => result
// ---------------------------------------------------------------------------

const handlers = {
  // --- meta -------------------------------------------------------------
  'workspace.info': async () => {
    const root = await siteRoot();
    let opsBase = '';
    try {
      const ops = await lib('ops-admin-api.mjs');
      opsBase = ops.resolveOpsApiBase('test', '');
    } catch {
      /* token-independent base may still fail; ignore */
    }
    return { siteRoot: root, apiBase: opsBase };
  },

  ping: async () => ({ pong: true, siteRoot: await siteRoot() }),

  // --- homepage hero composition library (repo-only; never publishes) ---
  'hero.read': async () => {
    const store = await lib('home-hero-store.mjs');
    return store.readHomeHeroWorkspace();
  },

  'hero.save': async (args = {}) => {
    if (!args.library || typeof args.library !== 'object') throw new Error('hero.save requires { library }');
    const store = await lib('home-hero-store.mjs');
    const written = await store.writeHomeHeroLibrary(args.library);
    const workspace = await store.readHomeHeroWorkspace();
    return { ...workspace, library: written.library };
  },

  'hero.preview': async (args = {}) => {
    if (!args.library || typeof args.library !== 'object') throw new Error('hero.preview requires { library }');
    const compositionId = String(args.compositionId || '').trim();
    if (!compositionId) throw new Error('hero.preview requires { compositionId }');
    const store = await lib('home-hero-store.mjs');
    return store.previewHomeHero(args.library, compositionId);
  },

  'hero.prepare': async (args = {}) => {
    const compositionId = String(args.compositionId || '').trim();
    if (!compositionId) throw new Error('hero.prepare requires { compositionId }');
    const store = await lib('home-hero-store.mjs');
    await store.prepareHomeHero(compositionId);
    return store.readHomeHeroWorkspace();
  },

  // --- entries (local /entries/<slug>/ folders) -------------------------
  'entry.list': async () => {
    const dir = await entriesDir();
    const root = await siteRoot();
    let names = [];
    try {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      // Route-only folders such as entries/bag and empty migration remnants are
      // not catalog entries. Keep malformed entry.json files visible as errors,
      // but never synthesize error cards for directories with no entry record.
      names = ents
        .filter((e) => e.isDirectory() && existsSyncSafe(path.join(dir, e.name, 'entry.json')))
        .map((e) => e.name);
    } catch {
      return { entries: [] };
    }
    // Read the catalog once to join artwork + published linkage by slug.
    const catalog = await readJsonFile(path.join(root, 'data', 'catalog.entries.json'), {});
    const catalogRows = Array.isArray(catalog?.entries) ? catalog.entries : [];
    const catalogBySlug = new Map();
    for (const row of catalogRows) {
      const slug = String(row?.id || '').trim()
        || String(row?.entry_href || row?.href || '').replace(/^\/entry\//, '').replace(/\/$/, '');
      if (slug) catalogBySlug.set(slug.toLowerCase(), row);
    }
    // Editorial artwork overrides (set from the ops app) are canonical and land
    // in catalog.entries.json only on a rebuild. Overlay them here so a freshly
    // set image shows on the list immediately — same precedence the detail
    // sheet's entry.image.get uses (editorial override first).
    const editorialImageBySlug = new Map();
    try {
      const store = await lib('catalog-editorial-store.mjs');
      const { data } = await store.readCatalogEditorialFile(path.join(root, 'data', 'catalog.editorial.json'));
      for (const row of Array.isArray(data?.manifest) ? data.manifest : []) {
        const slug = String(row?.entry_id || '').trim()
          || String(row?.entry_href || '').replace(/^\/entry\//, '').replace(/\/$/, '');
        const img = String(row?.image_src || '').trim();
        if (slug && img) editorialImageBySlug.set(slug.toLowerCase(), img);
      }
    } catch {
      /* no editorial file yet — fall back to catalog image_src */
    }
    const rows = [];
    for (const slug of names) {
      const cat = catalogBySlug.get(slug.toLowerCase()) || null;
      const imageSrc = editorialImageBySlug.get(slug.toLowerCase()) || String(cat?.image_src || '');
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, slug, 'entry.json'), 'utf8'));
        const sidebar = raw?.sidebarPageConfig || {};
        const credits = sidebar?.credits || {};
        const artist = Array.isArray(credits.artist) ? credits.artist.join(', ')
          : String(credits.artist || raw?.canonical?.artistName || cat?.performer_raw || '');
        rows.push({
          slug,
          title: raw?.title || slug,
          lookupNumber: sidebar?.lookupNumber || '',
          artist,
          season: String(sidebar?.credits?.season || cat?.season || ''),
          imageSrc,
          inCatalog: !!cat,
          publishedAt: raw?.lifecycle?.publishedAt || '',
          buckets: Array.isArray(sidebar?.downloads?.selectedBuckets)
            ? sidebar.downloads.selectedBuckets
            : Array.isArray(sidebar?.buckets)
              ? sidebar.buckets
              : [],
          updatedAt: raw?.lifecycle?.updatedAt || raw?.updatedAt || '',
        });
      } catch {
        rows.push({ slug, title: slug, lookupNumber: '', artist: '', season: '', imageSrc, inCatalog: !!cat, buckets: [], updatedAt: '', error: true });
      }
    }
    rows.sort((a, b) => a.slug.localeCompare(b.slug));
    return { entries: rows };
  },

  // catalog.seasons — the defined seasons (data/catalog.seasons.json) merged
  // with any season ids actually present in the catalog, so the entry editor can
  // offer a real picker instead of free text.
  'catalog.seasons': async () => {
    const root = await siteRoot();
    const defs = await readJsonFile(path.join(root, 'data', 'catalog.seasons.json'), {});
    const catalog = await readJsonFile(path.join(root, 'data', 'catalog.entries.json'), {});
    const byId = new Map();
    for (const s of Array.isArray(defs?.seasons) ? defs.seasons : []) {
      const id = String(s?.id || '').trim();
      if (id) byId.set(id, { id, label: String(s?.label || id), order: Number(s?.order || 0) });
    }
    for (const row of Array.isArray(catalog?.entries) ? catalog.entries : []) {
      const id = String(row?.season || '').trim();
      if (id && !byId.has(id)) byId.set(id, { id, label: id, order: 0 });
    }
    const seasons = Array.from(byId.values()).sort((a, b) => (b.order - a.order) || b.id.localeCompare(a.id));
    return { seasons };
  },

  // entry.imageData — read a repo-relative web path (e.g. /assets/catalog/x.jpg)
  // and return it as a data URL so the editor can preview local-only artwork
  // that isn't on the public site yet.
  'entry.imageData': async (args = {}) => {
    const webPath = String(args.webPath || '').trim();
    if (!webPath) return { dataUrl: '' };
    const root = await siteRoot();
    const rel = webPath.replace(/^\/+/, '');
    const abs = path.join(root, rel);
    if (!abs.startsWith(root)) throw new Error('refusing to read outside the site repo');
    try {
      const buf = await fs.readFile(abs);
      const ext = path.extname(abs).toLowerCase().slice(1) || 'png';
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
    } catch {
      return { dataUrl: '' };
    }
  },

  'entry.read': async (args = {}) => {
    const slug = String(args.slug || '').trim();
    if (!slug) throw new Error('entry.read requires { slug }');
    const store = await lib('entry-store.mjs');
    const folder = await readEntryFolderAbs(store, slug);
    return folder;
  },

  // entry.write — regenerate index.html from the edited entry/manifest/description
  // and persist via writeEntryFolder. Pass { dryRun: true } to preview the diff
  // without touching disk.
  'entry.write': async (args = {}) => {
    const slug = String(args.slug || '').trim();
    if (!slug) throw new Error('entry.write requires { slug }');
    if (!args.entry || typeof args.entry !== 'object') throw new Error('entry.write requires { entry }');

    const dir = await entriesDir();
    const store = await lib('entry-store.mjs');
    const initCore = await lib('init-core.mjs');
    const lifecycleMod = await lib('entry-lifecycle.mjs');

    const { templateHtml } = await initCore.prepareTemplate({});
    const existing = await store.readEntryFolder(slug, { entriesDir: dir }).catch(() => ({ indexHtml: '', folder: path.join(dir, slug) }));

    const entry = args.entry;
    const descriptionText = typeof args.descriptionText === 'string' ? args.descriptionText : existing.descriptionText || '';
    const manifest = args.manifest && typeof args.manifest === 'object' ? args.manifest : existing.manifest;

    // Resolve lifecycle once and thread it through both index.html and entry.json
    // (mirrors scripts/ui/update-wizard.mjs).
    const lifecycle = await lifecycleMod.resolveLifecycleForWrite({
      existingLifecycle: entry.lifecycle,
      entryFolder: existing.folder || path.join(dir, slug),
      now: Date.now(),
    });
    entry.lifecycle = lifecycle;

    const indexHtml = store.generateIndexHtml({ templateHtml, entry, descriptionText, manifest, lifecycle });
    const diff = store.diffSummary(existing.indexHtml || '', indexHtml);

    if (args.dryRun) {
      return { dryRun: true, diff, bytes: indexHtml.length };
    }

    const { wroteFiles } = await store.writeEntryFolder(
      slug,
      { entry, descriptionText, manifest, indexHtml },
      { entriesDir: dir },
    );
    return { dryRun: false, diff, wroteFiles };
  },

  // entry.image.get — current image_src for an entry (editorial override first),
  // so the ops UI pre-populates without overwriting.
  'entry.image.get': async (args = {}) => {
    const root = await siteRoot();
    return (await lib('catalog-entry-image.mjs')).getEntryImage({
      siteRoot: root,
      token: args.token || args.slug,
    });
  },

  // entry.image.set — copy a local image into the repo as the entry's artwork,
  // record the editorial override, and regenerate catalog data so the carousel
  // reflects it. { token|slug, sourcePath }.
  'entry.image.set': async (args = {}) => {
    const root = await siteRoot();
    const mod = await lib('catalog-entry-image.mjs');
    const result = await mod.setEntryImage({
      siteRoot: root,
      token: args.token || args.slug,
      sourcePath: args.sourcePath,
    });
    // Regenerate catalog data (extract reads the editorial override) + mirror it.
    const opts = { cwd: root, maxBuffer: 64 * 1024 * 1024 };
    await execFileAsync(process.execPath, ['scripts/extract_catalog_data.mjs'], opts);
    await execFileAsync(process.execPath, ['scripts/sync_runtime_css.mjs'], opts);
    return result;
  },

  // entry.publish — FULL pipeline (writeEntryFromData): writes the folder AND
  // syncs catalog linkage + protected-asset mappings. Use for an authoritative
  // republish of an existing entry. Compose data from the edited folder.
  'entry.publish': async (args = {}) => {
    const slug = String(args.slug || '').trim();
    if (!slug) throw new Error('entry.publish requires { slug }');
    const entry = args.entry;
    if (!entry || typeof entry !== 'object') throw new Error('entry.publish requires { entry }');

    const dir = await entriesDir();
    const existing = await readEntryFolderAbs(await lib('entry-store.mjs'), slug).catch(() => ({}));
    const data = {
      slug: entry.slug || slug,
      title: entry.title,
      canonical: entry.canonical,
      sidebar: entry.sidebarPageConfig,
      creditsData: entry.creditsData,
      manifest: args.manifest && typeof args.manifest === 'object' ? args.manifest : existing.manifest,
      descriptionText: typeof args.descriptionText === 'string' ? args.descriptionText : existing.descriptionText || '',
      video: entry.video,
      authEnabled: true,
      outDir: dir,
    };
    return runWriteEntryFromData(data, { dryRun: !!args.dryRun, publishRoute: true });
  },

  // entry.create — NEW entry via the full pipeline. Composes a schema-valid
  // entry from a lightweight form payload + a credits skeleton + empty manifest.
  'entry.create': async (args = {}) => {
    const slug = String(args.slug || '').trim();
    if (!slug) throw new Error('entry.create requires { slug }');

    const dir = await entriesDir();
    const initCore = await lib('init-core.mjs');
    const { formatKeys } = await initCore.prepareTemplate({});
    const manifest = initCore.buildEmptyManifestSkeleton(formatKeys);

    const buckets = Array.isArray(args.buckets) && args.buckets.length ? args.buckets : ['A'];
    const data = {
      slug,
      title: String(args.title || slug),
      video: { mode: 'url', dataUrl: String(args.videoUrl || ''), dataUrlOriginal: String(args.videoUrl || ''), dataHtml: '' },
      descriptionText: String(args.descriptionText || ''),
      sidebar: {
        lookupNumber: String(args.lookupNumber || ''),
        buckets,
        specialEventImage: '',
        attributionSentence: String(args.attributionSentence || ''),
        credits: creditsSkeleton(args),
        fileSpecs: { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } },
        metadata: { sampleLength: '', tags: [] },
      },
      manifest,
      authEnabled: true,
      outDir: dir,
    };
    return runWriteEntryFromData(data, { dryRun: !!args.dryRun });
  },

  // --- dexDRONES UAV collections ---------------------------------------
  'uav.list': async () => {
    const root = await siteRoot();
    const store = await lib('uav-store.mjs');
    const authorities = await store.readUavAuthorities(root);
    const slugs = await store.listUavSlugs(root);
    const entries = [];
    for (const slug of slugs) {
      const folder = await store.readUavCollection(slug, root);
      const site = authorities.sites.find((row) => row.id === folder.collection.siteAuthorityId);
      entries.push({
        kind: 'uav',
        slug,
        title: folder.collection.title,
        lookupNumber: folder.collection.lookupRaw,
        site: site?.name || '',
        subject: folder.collection.identity.primarySubjectCode,
        tour: folder.collection.identity.tour,
        year: folder.collection.identity.year,
        status: folder.collection.status,
        imageSrc: folder.collection.imageSrc || '',
        buckets: Array.from(new Set(folder.collection.series.map((row) => row.captureClass))),
        updatedAt: folder.collection.lifecycle.updatedAt || '',
        publishedAt: folder.collection.lifecycle.publishedAt || '',
        inCatalog: folder.collection.status === 'active',
      });
    }
    entries.sort((a, b) => a.slug.localeCompare(b.slug));
    return { entries };
  },

  'uav.authorities': async () => {
    const root = await siteRoot();
    return { authorities: await (await lib('uav-store.mjs')).readUavAuthorities(root) };
  },

  'uav.authorities.write': async (args = {}) => {
    if (!args.authorities || typeof args.authorities !== 'object') {
      throw new Error('uav.authorities.write requires { authorities }');
    }
    return (await lib('uav-store.mjs')).writeUavAuthorities(args.authorities, await siteRoot());
  },

  'uav.site.private.set': async (args = {}) => {
    const authorities = await lib('uav-authority-store.mjs');
    if (args.remove) return authorities.removeUavPrivateSite(args.siteId);
    return authorities.writeUavPrivateSite(args.siteId, { lat: args.lat, lon: args.lon });
  },

  'uav.authority.search': async (args = {}) => {
    return (await lib('uav-authority-store.mjs')).searchLocAuthority(args.query, args.kind);
  },

  'uav.read': async (args = {}) => {
    const slug = normalizeEntrySlug(args.slug);
    const root = await siteRoot();
    const store = await lib('uav-store.mjs');
    const [folder, authorities] = await Promise.all([
      store.readUavCollection(slug, root),
      store.readUavAuthorities(root),
    ]);
    return { ...folder, authorities };
  },

  'uav.create': async (args = {}) => {
    return (await lib('uav-store.mjs')).createUavCollection({
      ...args,
      rootDir: await siteRoot(),
      dryRun: !!args.dryRun,
    });
  },

  'uav.write': async (args = {}) => {
    const slug = normalizeEntrySlug(args.slug || args.collection?.slug);
    if (!args.collection || typeof args.collection !== 'object') throw new Error('uav.write requires { collection }');
    if (!args.manifest || typeof args.manifest !== 'object') throw new Error('uav.write requires { manifest }');
    if (slug !== String(args.collection.slug || '').trim()) throw new Error('UAV slug does not match collection');
    return (await lib('uav-store.mjs')).writeUavCollection({
      collection: args.collection,
      manifest: args.manifest,
      descriptionText: String(args.descriptionText ?? args.collection.description ?? ''),
      rootDir: await siteRoot(),
      dryRun: !!args.dryRun,
    });
  },

  'uav.scanBucket': async (args = {}) => {
    const folderId = String(args.folderId || '').trim();
    const seriesLookup = String(args.seriesLookup || '').trim();
    const bucket = String(args.bucket || '').trim().toUpperCase();
    if (!folderId) throw new Error('uav.scanBucket requires { folderId }');
    if (!seriesLookup) throw new Error('uav.scanBucket requires { seriesLookup }');
    if (!bucket) throw new Error('uav.scanBucket requires { bucket }');
    const [scan, inventory] = await Promise.all([
      (await lib('entry-bucket-folders.mjs')).scanBucketFolder({ folderId }),
      lib('uav-file-inventory.mjs'),
    ]);
    const reconciled = inventory.reconcileUavBucketFiles({
      seriesLookup,
      bucket,
      existingFiles: Array.isArray(args.existingFiles) ? args.existingFiles : [],
      scannedFiles: Array.isArray(scan.files) ? scan.files : [],
      scannedAt: new Date().toISOString(),
    });
    return {
      ...reconciled,
      folderId: scan.folderId,
      count: scan.count,
      totalBytes: scan.totalBytes,
      humanSize: scan.humanSize,
    };
  },

  'uav.preflight': async (args = {}) => {
    return (await lib('uav-store.mjs')).preflightUavCollection(
      normalizeEntrySlug(args.slug),
      { rootDir: await siteRoot() },
    );
  },

  'uav.publish': async (args = {}) => {
    const root = await siteRoot();
    const store = await lib('uav-store.mjs');
    const slug = normalizeEntrySlug(args.slug || args.collection?.slug);
    if (args.collection && args.manifest) {
      await store.writeUavCollection({
        collection: args.collection,
        manifest: args.manifest,
        descriptionText: String(args.descriptionText ?? args.collection.description ?? ''),
        rootDir: root,
        dryRun: false,
      });
    }
    const built = await store.buildUavOutputs({ rootDir: root });
    await store.syncUavCatalogOutputs({ rootDir: root, aggregate: built.aggregate });
    const preflight = await store.preflightUavCollection(slug, { rootDir: root });
    if (!preflight.ok) {
      throw new Error(`UAV publish preflight failed: ${preflight.blockers.map((row) => row.detail).join('; ')}`);
    }
    const current = await store.readUavCollection(slug, root);
    return {
      slug,
      entryHref: `/uav/${slug}/`,
      collections: built.collections,
      lookups: built.lookups,
      preflight,
      collection: current.collection,
      manifest: current.manifest,
    };
  },

  // entry.preflight — local, read-only publication gate for a linked thread.
  'entry.preflight': async (args = {}) => {
    const slug = normalizeEntrySlug(args.slug);
    const expectedLookup = String(args.expectedLookup || '').trim();
    const root = await siteRoot();
    const entryRoot = path.join(root, 'entries', slug);
    const checks = [];
    const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail: String(detail || '') });

    let folder = null;
    try {
      folder = await readEntryFolderAbs(await lib('entry-store.mjs'), slug);
      add('entry_exists', true, `entries/${slug}`);
    } catch (error) {
      add('entry_exists', false, String(error?.message || error));
      return { ok: false, slug, checks, blockers: checks.filter((check) => !check.ok) };
    }

    const entry = folder?.entry || {};
    const sidebar = entry?.sidebarPageConfig || {};
    const actualLookup = String(sidebar.lookupNumber || '').trim();
    add('lookup_matches', !!expectedLookup && actualLookup === expectedLookup,
      actualLookup ? `Entry lookup: ${actualLookup}` : 'Entry lookup is missing');
    add('entry_json', existsSyncSafe(path.join(entryRoot, 'entry.json')), 'entry.json');
    add('entry_html', existsSyncSafe(path.join(entryRoot, 'index.html'))
      && String(folder?.indexHtml || '').includes(expectedLookup), 'index.html contains the final lookup');

    const catalog = await readJsonFile(path.join(root, 'data', 'catalog.entries.json'), {});
    const catalogRows = Array.isArray(catalog?.entries) ? catalog.entries : [];
    const catalogEntry = catalogRows.find((row) =>
      String(row?.id || row?.slug || '').toLowerCase() === slug
      || String(row?.entry_href || row?.href || '') === `/entry/${slug}/`);
    add('catalog_link', !!catalogEntry, catalogEntry ? `/entry/${slug}/ is present in the catalog` : 'Catalog linkage is missing');

    const protectedAssets = await readJsonFile(path.join(root, 'data', 'protected.assets.json'), {});
    const protectedRows = Array.isArray(protectedAssets?.lookups) ? protectedAssets.lookups : [];
    const protectedLookup = protectedRows.find((row) =>
      String(row?.lookupNumber || row?.lookup || '').trim().toLowerCase() === expectedLookup.toLowerCase());
    add('protected_assets', !!protectedLookup, protectedLookup
      ? 'Protected download mapping exists'
      : 'Protected download mapping is missing');

    try {
      const bucketFolders = await lib('entry-bucket-folders.mjs');
      const prospectiveImport = bucketFolders.bucketFoldersToProtectedImport(sidebar?.downloads, {
        slug,
        lookupNumber: actualLookup,
        title: String(entry.title || slug),
        season: String(entry?.creditsData?.season || sidebar?.credits?.season || ''),
        status: String(protectedLookup?.status || 'draft'),
        existingFiles: Array.isArray(protectedLookup?.files) ? protectedLookup.files : [],
      });
      if (prospectiveImport) {
        const schema = await lib('protected-assets-schema.mjs');
        const prospectiveAssets = protectedAssets?.version
          ? structuredClone(protectedAssets)
          : {
              version: 'protected-assets-v1',
              updatedAt: new Date().toISOString(),
              settings: {
                storageBucket: 'dex-protected-assets',
                allowedBuckets: ['A', 'B', 'C', 'D', 'E', 'X'],
                syncStrategy: 'manifest-publish',
              },
              lookups: [],
              exemptions: [],
            };
        const lookupIndex = (prospectiveAssets.lookups || []).findIndex(
          (row) => String(row?.lookupNumber || '').trim().toLowerCase() === actualLookup.toLowerCase(),
        );
        const nextLookup = {
          ...(lookupIndex >= 0 ? prospectiveAssets.lookups[lookupIndex] : {}),
          ...prospectiveImport,
          lookupNumber: actualLookup,
          title: String(prospectiveImport.title || entry.title || slug),
          status: String(prospectiveImport.status || protectedLookup?.status || 'draft'),
          season: String(prospectiveImport.season || entry?.creditsData?.season || sidebar?.credits?.season || ''),
          entitlements: Array.isArray(protectedLookup?.entitlements) && protectedLookup.entitlements.length
            ? protectedLookup.entitlements
            : [{ type: 'membership_tier', value: 'member' }],
          ...(protectedLookup?.recordingIndex ? { recordingIndex: protectedLookup.recordingIndex } : {}),
        };
        if (lookupIndex >= 0) prospectiveAssets.lookups[lookupIndex] = nextLookup;
        else prospectiveAssets.lookups.push(nextLookup);
        schema.normalizeProtectedAssetsFile({
          ...prospectiveAssets,
          updatedAt: new Date().toISOString(),
        });
        add('bucket_assets', true, `${prospectiveImport.files.length} scanned files are publishable`);
      } else {
        add('bucket_assets', true, 'No scanned bucket-folder import is configured');
      }
    } catch (error) {
      add('bucket_assets', false, `Scanned bucket files cannot publish: ${formatBridgeError(error)}`);
    }

    try {
      const dryRun = await runWriteEntryFromData({
        slug: entry.slug || slug,
        title: entry.title,
        canonical: entry.canonical,
        sidebar: entry.sidebarPageConfig,
        creditsData: entry.creditsData,
        manifest: folder.manifest,
        descriptionText: folder.descriptionText || '',
        video: entry.video,
        authEnabled: true,
        outDir: await entriesDir(),
      }, { dryRun: true });
      add('build', true, dryRun?.report?.htmlPath || 'Entry build dry-run passed');
    } catch (error) {
      add('build', false, String(error?.message || error));
    }

    const entryFiles = (await walkFiles(entryRoot)).map((file) => `entries/${slug}/${file}`);
    const evidenceFiles = [
      ...entryFiles,
      'data/catalog.entries.json',
      'data/protected.assets.json',
    ].filter((file) => existsSyncSafe(path.join(root, file)));
    const contentHash = await hashFiles(root, evidenceFiles);
    const ok = checks.every((check) => check.ok);
    return {
      ok,
      slug,
      entryHref: `/entry/${slug}/`,
      lookup: actualLookup,
      title: String(entry.title || slug),
      contentHash,
      relevantPaths: entryRelevantPaths(slug),
      checkedAt: new Date().toISOString(),
      checks,
      blockers: checks.filter((check) => !check.ok),
    };
  },

  // entry.verifyPublished — proves the linked entry matches origin/<branch>
  // and the public page contains the expected lookup/title.
  'entry.verifyPublished': async (args = {}) => {
    const slug = normalizeEntrySlug(args.slug);
    const expectedLookup = String(args.expectedLookup || '').trim();
    const expectedTitle = String(args.expectedTitle || '').trim();
    if (!expectedLookup) throw new Error('expectedLookup is required');
    const root = await siteRoot();
    const expectedContentHash = String(args.expectedContentHash || '').trim();
    if (!expectedContentHash) throw new Error('expectedContentHash is required; rerun preflight');
    const entryRoot = path.join(root, 'entries', slug);
    const currentEvidenceFiles = [
      ...(await walkFiles(entryRoot)).map((file) => `entries/${slug}/${file}`),
      'data/catalog.entries.json',
      'data/protected.assets.json',
    ].filter((file) => existsSyncSafe(path.join(root, file)));
    const currentContentHash = await hashFiles(root, currentEvidenceFiles);
    if (currentContentHash !== expectedContentHash) {
      return {
        ok: false,
        code: 'preflight_stale',
        message: 'The linked entry changed after preflight. Run preflight again.',
        expectedContentHash,
        currentContentHash,
      };
    }
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    await runGit(['fetch', '--quiet', 'origin', branch]);
    const relevantPaths = Array.isArray(args.relevantPaths) && args.relevantPaths.length
      ? args.relevantPaths.map(String)
      : entryRelevantPaths(slug);
    const remoteDiff = await runGit(['diff', '--name-only', `origin/${branch}`, '--', ...relevantPaths]);
    if (remoteDiff) {
      return {
        ok: false,
        code: 'remote_mismatch',
        message: 'Push the linked entry changes before marking it in library.',
        files: remoteDiff.split('\n').filter(Boolean),
        branch,
      };
    }
    const worktreeDiff = await runGit(['status', '--porcelain', '--', ...relevantPaths]);
    if (worktreeDiff) {
      return {
        ok: false,
        code: 'local_changes',
        message: 'The linked entry still has uncommitted changes.',
        files: worktreeDiff.split('\n').filter(Boolean),
        branch,
      };
    }

    const appOrigin = String(args.appOrigin || process.env.DEX_APP_ORIGIN || 'https://dexdsl.github.io').replace(/\/+$/, '');
    const base = new URL(appOrigin);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) {
      throw new Error('publication verification requires HTTPS');
    }
    const target = new URL(`/entry/${slug}/?dx_verify=${Date.now()}`, base);
    if (target.origin !== base.origin) throw new Error('public entry must be same-origin');
    const response = await fetch(target, {
      redirect: 'manual',
      headers: { accept: 'text/html', 'cache-control': 'no-cache' },
    });
    if (!response.ok) {
      return { ok: false, code: 'publication_pending', message: `Waiting for live site (${response.status}).`, branch };
    }
    const html = (await response.text()).slice(0, 2_000_000);
    const normalized = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    if (!normalized.includes(expectedLookup.toLowerCase()) || (expectedTitle && !normalized.includes(expectedTitle.toLowerCase()))) {
      return {
        ok: false,
        code: 'publication_pending',
        message: 'Waiting for the expected lookup and title to appear on the live entry.',
        branch,
      };
    }
    const commitSha = await runGit(['rev-parse', 'HEAD']);
    return {
      ok: true,
      liveVerified: true,
      url: `${appOrigin}/entry/${slug}/`,
      status: response.status,
      branch,
      commitSha,
      checkedAt: new Date().toISOString(),
      relevantPaths,
    };
  },

  // entry.bucketScan — read a bucket's Google Drive folder and summarise the
  // downloadable files within (count + total size + file list).
  'entry.bucketScan': async (args = {}) => {
    const folderId = String(args.folderId || '').trim();
    if (!folderId) throw new Error('entry.bucketScan requires { folderId }');
    const buckets = await lib('entry-bucket-folders.mjs');
    return buckets.scanBucketFolder({ folderId });
  },

  // --- assets (static repo files: /assets, /css, /static) ----------------
  // assets.list — every tracked static file with size, mirror presence, and a
  // reference count (how many HTML/CSS/JS files point at its web path).
  'assets.list': async () => {
    const root = await siteRoot();
    return (await lib('asset-inventory.mjs')).inventory({ siteRoot: root });
  },

  // assets.refs — the full list of repo files referencing a web path.
  'assets.refs': async (args = {}) => {
    const root = await siteRoot();
    return (await lib('asset-inventory.mjs')).assetReferences({ siteRoot: root, webPath: args.webPath });
  },

  // assets.add — copy a picked local file into /assets/<destDir>/, mirrored to
  // every served root. Returns the new web path.
  'assets.add': async (args = {}) => {
    const root = await siteRoot();
    const src = String(args.sourcePath || '').trim();
    if (!src) throw new Error('assets.add requires { sourcePath }');
    const inv = await lib('asset-inventory.mjs');
    const destDir = sanitizeAssetDir(args.destDir);
    const fileName = sanitizeFileName(args.fileName || path.basename(src));
    if (!fileName) throw new Error('assets.add could not derive a file name');
    const webPath = `/${['assets', destDir, fileName].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
    return writeAssetEverywhere(inv, root, webPath, src);
  },

  // assets.replace — overwrite the file at an existing web path across all
  // mirror roots, keeping the path so every reference updates at once.
  'assets.replace': async (args = {}) => {
    const root = await siteRoot();
    const webPath = normalizeWebPath(args.webPath);
    const src = String(args.sourcePath || '').trim();
    if (!webPath) throw new Error('assets.replace requires a valid { webPath } under /assets, /css, or /static');
    if (!src) throw new Error('assets.replace requires { sourcePath }');
    const inv = await lib('asset-inventory.mjs');
    return writeAssetEverywhere(inv, root, webPath, src);
  },

  // assets.delete — remove a web path from all mirror roots. Blocks when the
  // asset is still referenced unless { confirmed: true }.
  'assets.delete': async (args = {}) => {
    const root = await siteRoot();
    const webPath = normalizeWebPath(args.webPath);
    if (!webPath) throw new Error('assets.delete requires a valid { webPath } under /assets, /css, or /static');
    const inv = await lib('asset-inventory.mjs');
    if (!args.confirmed) {
      const { refs } = inv.assetReferences({ siteRoot: root, webPath });
      if (refs.length) {
        throw new Error(`"${webPath}" is referenced by ${refs.length} file(s); pass confirmed:true to delete anyway`);
      }
    }
    const removed = [];
    for (const { abs } of inv.mirrorRootsFor(root, webPath)) {
      try {
        await fs.rm(abs, { force: true });
        removed.push(abs);
      } catch {
        /* ignore individual mirror misses */
      }
    }
    return { ok: true, webPath, removed };
  },

  // assets.read — base64 contents of a static asset (lazy image thumbnails).
  'assets.read': async (args = {}) => {
    const root = await siteRoot();
    const webPath = normalizeWebPath(args.webPath);
    if (!webPath) throw new Error('assets.read requires a valid { webPath }');
    const inv = await lib('asset-inventory.mjs');
    const target = inv.mirrorRootsFor(root, webPath).map((m) => m.abs).find((abs) => existsSyncSafe(abs));
    if (!target) throw new Error(`asset not found: ${webPath}`);
    const buf = await fs.readFile(target);
    return { webPath, base64: buf.toString('base64'), bytes: buf.length };
  },

  // --- linked assets (data/protected.assets.json lookups) ----------------
  'protected.list': async () => {
    const pub = await lib('protected-assets-publisher.mjs');
    const dataPath = path.join(await siteRoot(), 'data', 'protected.assets.json');
    const { data } = await pub.readProtectedAssetsFile(dataPath);
    const lookups = (data.lookups || []).map((l) => ({
      lookupNumber: l.lookupNumber,
      title: l.title || '',
      status: l.status || '',
      season: l.season || '',
      fileCount: Array.isArray(l.files) ? l.files.length : 0,
      totalBytes: (l.files || []).reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0),
      entitlements: l.entitlements || [],
      hasRecordingIndex: Boolean(l.recordingIndex),
    }));
    return { lookups, settings: data.settings || {}, updatedAt: data.updatedAt };
  },

  'protected.get': async (args = {}) => {
    const key = String(args.lookupNumber || '').trim().toLowerCase();
    if (!key) throw new Error('protected.get requires { lookupNumber }');
    const pub = await lib('protected-assets-publisher.mjs');
    const dataPath = path.join(await siteRoot(), 'data', 'protected.assets.json');
    const { data } = await pub.readProtectedAssetsFile(dataPath);
    const lookup = (data.lookups || []).find((l) => String(l.lookupNumber).toLowerCase() === key);
    if (!lookup) throw new Error(`lookup not found: ${args.lookupNumber}`);
    return { lookup };
  },

  'protected.patchLookup': async (args = {}) => mutateProtected(args.lookupNumber, (lookup) => {
    const patch = args.patch && typeof args.patch === 'object' ? args.patch : {};
    if (typeof patch.title === 'string') lookup.title = patch.title;
    if (typeof patch.status === 'string') lookup.status = patch.status;
    if (typeof patch.season === 'string') lookup.season = patch.season;
    if (Array.isArray(patch.entitlements)) lookup.entitlements = patch.entitlements;
  }),

  'protected.removeLookup': async (args = {}) => mutateProtected(args.lookupNumber, null, { remove: true }),

  // --- ops / submissions / press / board / support ----------------------
  'ops.list': async (args = {}) => (await lib('ops-admin-api.mjs')).listOpsTickets(args),
  'ops.get': async (args = {}) => (await lib('ops-admin-api.mjs')).getOpsTicket(args),
  'ops.create': async (args = {}) => (await lib('ops-admin-api.mjs')).createOpsTicket(args),
  'ops.patch': async (args = {}) => (await lib('ops-admin-api.mjs')).patchOpsTicket(args),
  'ops.reply': async (args = {}) => (await lib('ops-admin-api.mjs')).replyOpsTicket(args),
  'ops.import': async (args = {}) => (await lib('ops-admin-api.mjs')).importOpsRows(args),

  // --- polls ------------------------------------------------------------
  'polls.list': async (args = {}) => (await lib('polls-admin-api.mjs')).listAdminPollDefinitions(args),
  'polls.overview': async (args = {}) => (await lib('polls-admin-api.mjs')).getAdminPollOverview(args),
  // polls.create — build a schema-valid draft (id/slug/callRef/defaults) from a
  // lightweight input, then create it via the admin API.
  'polls.create': async (args = {}) => {
    const pollsApi = await lib('polls-admin-api.mjs');
    if (args.poll && typeof args.poll === 'object') {
      return pollsApi.createAdminPollDefinition({ env: args.env, poll: args.poll });
    }
    const store = await lib('polls-store.mjs');
    let existing = { polls: [] };
    try {
      existing = await store.readPollsFile();
    } catch {
      /* no local polls file — createPollDraft tolerates an empty base */
    }
    const draft = store.createPollDraft(existing, {
      id: args.id,
      question: args.question,
      options: Array.isArray(args.options) ? args.options : undefined,
      visibility: args.visibility,
      status: args.status,
    });
    return pollsApi.createAdminPollDefinition({ env: args.env, poll: draft });
  },
  'polls.patch': async (args = {}) => (await lib('polls-admin-api.mjs')).patchAdminPollDefinition(args),
  'polls.status': async (args = {}) => (await lib('polls-admin-api.mjs')).setAdminPollDefinitionStatus(args),
  'polls.live': async (args = {}) => (await lib('polls-admin-api.mjs')).getAdminPollLive(args),
  'polls.trend': async (args = {}) => (await lib('polls-admin-api.mjs')).getAdminPollTrend(args),
  'polls.snapshots': async (args = {}) => (await lib('polls-admin-api.mjs')).getAdminPollSnapshots(args),
  'polls.publishSnapshot': async (args = {}) => (await lib('polls-admin-api.mjs')).publishAdminPollSnapshot(args),
  'polls.promoteSnapshot': async (args = {}) => (await lib('polls-admin-api.mjs')).promoteAdminPollSnapshot(args),

  // --- profiles / claims ------------------------------------------------
  'profiles.claims': async (args = {}) => (await lib('profile-admin-api.mjs')).listProfileClaims(args),
  'profiles.updateClaim': async (args = {}) => (await lib('profile-admin-api.mjs')).updateProfileClaim(args),
  'profiles.publicMap': async (args = {}) => (await lib('profile-admin-api.mjs')).getPublicProfilesMap(args),

  // --- users (Auth0 directory) ------------------------------------------
  'users.list': async (args = {}) => (await lib('profile-admin-api.mjs')).listAuth0Users(args),
  'users.action': async (args = {}) => (await lib('profile-admin-api.mjs')).userAction(args),

  // --- submission threads / kanban board --------------------------------
  'threads.board': async (args = {}) => (await lib('ops-admin-api.mjs')).listAdminThreads(args),
  'threads.get': async (args = {}) => (await lib('ops-admin-api.mjs')).getAdminThread(args),
  'threads.patch': async (args = {}) => (await lib('ops-admin-api.mjs')).patchAdminThread(args),
  'threads.message': async (args = {}) => (await lib('ops-admin-api.mjs')).postAdminThreadMessage(args),
  'threads.action': async (args = {}) => (await lib('ops-admin-api.mjs')).postAdminThreadAction(args),
  'threads.audit': async (args = {}) => (await lib('ops-admin-api.mjs')).getAdminThreadsAudit(args),

  // --- git (site repo) --------------------------------------------------
  'git.status': async () => {
    const root = await siteRoot();
    let isRepo = true;
    try {
      await runGit(['rev-parse', '--is-inside-work-tree']);
    } catch {
      isRepo = false;
    }
    if (!isRepo) return { isRepo: false, root };

    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    let fetched = true;
    try {
      await runGit(['fetch', '--quiet', 'origin', branch]);
    } catch {
      fetched = false;
    }
    const porcelain = await runGit(['status', '--porcelain']);
    const dirtyFiles = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;

    let ahead = 0;
    let behind = 0;
    let hasUpstream = true;
    try {
      const counts = await runGit(['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`]);
      const [a, b] = counts.split(/\s+/).map((n) => Number(n) || 0);
      ahead = a;
      behind = b;
    } catch {
      hasUpstream = false;
    }
    const lastCommit = await runGit(['log', '-1', '--pretty=%h %s (%cr)']).catch(() => '');
    return { isRepo: true, root, branch, fetched, hasUpstream, dirtyFiles, ahead, behind, lastCommit };
  },

  'git.pull': async () => {
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    const output = await runGit(['pull', '--ff-only', 'origin', branch]);
    return { ok: true, branch, output };
  },

  'git.push': async (args = {}) => {
    const message = String(args.message || '').trim() || `ops: update ${new Date().toISOString()}`;
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    await runGit(['add', '-A']);
    let committed = true;
    try {
      await runGit(['commit', '-m', message]);
    } catch (error) {
      if (/nothing to commit/i.test(String(error?.message || ''))) committed = false;
      else throw error;
    }
    const output = await runGit(['push', 'origin', branch]);
    return { ok: true, branch, committed, message, output };
  },

  // git.changes — per-file working-tree changes for the push preflight. Each
  // file carries its status (added/modified/deleted/renamed), whether it is
  // untracked, and +/- line counts (for tracked files) so the UI can render a
  // diff-style summary.
  'git.changes': async () => {
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    const porcelain = (await runGitRaw(['status', '--porcelain'])).replace(/\n$/, '');
    const numstatRaw = await runGit(['diff', '--numstat', 'HEAD']).catch(() => '');
    const numstat = new Map();
    numstatRaw.split('\n').filter(Boolean).forEach((line) => {
      const parts = line.split('\t');
      if (parts.length < 3) return;
      const [add, del, ...rest] = parts;
      numstat.set(rest.join('\t'), { insertions: Number(add) || 0, deletions: Number(del) || 0 });
    });
    const unquote = (p) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) : p);
    const files = [];
    porcelain.split('\n').filter(Boolean).forEach((line) => {
      const code = line.slice(0, 2);
      let rest = line.slice(3);
      let oldPath;
      if (code[0] === 'R' || code[1] === 'R') {
        const arrow = rest.split(' -> ');
        oldPath = unquote(arrow[0]);
        rest = arrow[1] || arrow[0];
      }
      const filePath = unquote(rest);
      const untracked = code === '??';
      let status = 'modified';
      if (untracked || code.includes('A')) status = 'added';
      else if (code.includes('D')) status = 'deleted';
      else if (code.includes('R')) status = 'renamed';
      const ns = numstat.get(filePath) || { insertions: 0, deletions: 0 };
      files.push({ path: filePath, oldPath, status, untracked, staged: code[0] !== ' ' && code[0] !== '?', insertions: ns.insertions, deletions: ns.deletions });
    });
    return { branch, files };
  },

  // git.fileDiff — unified diff for a single path (used by the per-change
  // "view diff" toggle). Untracked files render as an all-added block.
  'git.fileDiff': async (args = {}) => {
    const file = String(args.path || '').trim();
    if (!file) throw new Error('path is required');
    const root = await siteRoot();
    const inHead = await runGit(['cat-file', '-e', `HEAD:${file}`]).then(() => true).catch(() => false);
    if (inHead || (await runGit(['ls-files', '--error-unmatch', '--', file]).then(() => true).catch(() => false))) {
      const diff = await runGit(['diff', 'HEAD', '--', file]).catch(() => '');
      return { path: file, tracked: true, diff };
    }
    const content = await fs.readFile(path.join(root, file), 'utf8').catch(() => '');
    const diff = content
      ? `--- /dev/null\n+++ b/${file}\n` + content.replace(/\n$/, '').split('\n').map((l) => '+' + l).join('\n')
      : `+++ b/${file}\n(binary or empty new file)`;
    return { path: file, tracked: false, diff };
  },

  // git.pushSelective — preflight commit: discard the chosen changes, stage and
  // commit ONLY the chosen files (others stay in the working tree), then push.
  //   args: { message?, commit: string[], discard: string[] }
  'git.pushSelective': async (args = {}) => {
    const message = String(args.message || '').trim() || `ops: update ${new Date().toISOString()}`;
    const commit = Array.isArray(args.commit) ? [...new Set(args.commit.map(String).filter(Boolean))] : [];
    const discard = Array.isArray(args.discard) ? [...new Set(args.discard.map(String).filter(Boolean))] : [];
    const root = await siteRoot();
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);

    // 1) Discard: restore HEAD-known files; remove brand-new files entirely.
    for (const file of discard) {
      const inHead = await runGit(['cat-file', '-e', `HEAD:${file}`]).then(() => true).catch(() => false);
      if (inHead) {
        await runGit(['reset', '-q', 'HEAD', '--', file]).catch(() => {});
        await runGit(['checkout', 'HEAD', '--', file]).catch(() => {});
      } else {
        await runGit(['rm', '-f', '--cached', '--', file]).catch(() => {});
        await fs.rm(path.join(root, file), { force: true, recursive: false }).catch(() => {});
      }
    }

    // 2) Stage ONLY the chosen files (reset the index first so nothing else
    //    sneaks into the commit), then commit. Kept files stay dirty.
    let committed = false;
    if (commit.length) {
      await runGit(['reset', '-q']).catch(() => {});
      await runGit(['add', '--', ...commit]);
      try {
        await runGit(['commit', '-m', message]);
        committed = true;
      } catch (error) {
        if (/nothing to commit/i.test(String(error?.message || ''))) committed = false;
        else throw error;
      }
    }

    // 3) Push when there is anything to send (this commit, or prior ahead).
    let output = '';
    let pushed = false;
    let ahead = 0;
    try {
      const counts = await runGit(['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`]);
      ahead = Number(counts.split(/\s+/)[0]) || 0;
    } catch {}
    if (committed || ahead > 0) {
      output = await runGit(['push', 'origin', branch]);
      pushed = true;
    }
    return { ok: true, branch, committed, pushed, message, output, commitCount: commit.length, discardCount: discard.length };
  },

  // profiles.syncMap — fetch the public profiles map from the API and write it
  // to data/ + docs/data/ + public/data/ (mirrors `dex profiles map sync`).
  'profiles.syncMap': async (args = {}) => {
    const api = await lib('profile-admin-api.mjs');
    const result = await api.getPublicProfilesMap({ env: args.env });
    const written = await api.writePublicProfilesMap(result.payload, { mirror: true });
    return { apiBase: result.apiBase, written };
  },
};

// readEntryFolder resolves `./entries` against cwd; we pass an absolute dir so
// the bridge works regardless of where node was launched.
async function readEntryFolderAbs(store, slug) {
  const dir = await entriesDir();
  return store.readEntryFolder(slug, { entriesDir: dir });
}

// Run the entry write pipeline.
//   dryRun  -> init-core writer: previews only, NO catalog/asset side effects.
//   real    -> entry-run writer: writes folder AND syncs catalog linkage +
//              protected-asset mappings.
// (entry-run's catalog sync does not honour dryRun, so we must not call it for
// previews — see syncCatalogLinkageAfterWrite in the site repo.)
async function runWriteEntryFromData(data, { dryRun = false, publishRoute = false } = {}) {
  const initCore = await lib('init-core.mjs');
  const { templatePath, templateHtml } = await initCore.prepareTemplate({});

  if (dryRun) {
    const result = await initCore.writeEntryFromData({ templatePath, templateHtml, data, opts: { dryRun: true } });
    return { dryRun: true, slug: data.slug, report: result?.report || null, htmlPath: result?.report?.htmlPath || '', lines: result?.lines || [] };
  }

  const entryRun = await lib('entry-run.mjs');
  const lines = [];
  const result = await entryRun.writeEntryFromData({
    templatePath,
    templateHtml,
    data,
    opts: { dryRun: false },
    log: (line) => lines.push(line),
  });
  let route = null;
  if (publishRoute) {
    route = await entryRun.publishEntryRoute(data.slug, {
      rootDir: await siteRoot(),
      entriesDir: data.outDir,
    });
    lines.push(`✓ Published route /entry/${data.slug}/`);
  }
  return {
    dryRun: false,
    slug: data.slug,
    report: result?.report || null,
    htmlPath: result?.report?.htmlPath || '',
    routeHtmlPath: route?.routePath || '',
    lines,
  };
}

// Mirrors defaultCredits() in scripts/dex.mjs — a schema-valid credits block.
function creditsSkeleton(args = {}) {
  const toList = (value) =>
    Array.isArray(value)
      ? value
      : String(value || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
  return {
    artist: toList(args.artist),
    artistAlt: args.artistAlt || null,
    instruments: toList(args.instruments),
    instrumentLinksEnabled: false,
    linksByPerson: {},
    video: { director: toList(args.director), cinematography: toList(args.cinematography), editing: toList(args.editing) },
    audio: { recording: toList(args.recording), mix: toList(args.mix), master: toList(args.master) },
    year: Number(args.year) || new Date().getUTCFullYear(),
    season: String(args.season || 'S1'),
    location: String(args.location || 'Unknown'),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function readEnvelope() {
  const [opArg, argsArg] = process.argv.slice(2);
  if (opArg) {
    return { op: opArg, args: argsArg ? JSON.parse(argsArg) : {}, secrets: {} };
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function formatBridgeError(error) {
  const directIssues = Array.isArray(error?.issues) ? error.issues : null;
  let parsedIssues = directIssues;
  if (!parsedIssues) {
    try {
      const parsed = JSON.parse(String(error?.message || ''));
      if (Array.isArray(parsed)) parsedIssues = parsed;
    } catch {
      // Not a structured validation error.
    }
  }
  if (parsedIssues?.length) {
    const sample = parsedIssues.slice(0, 8).map((issue) => {
      const issuePath = Array.isArray(issue?.path) && issue.path.length ? issue.path.join('.') : 'value';
      return `${issuePath}: ${String(issue?.message || issue?.code || 'invalid')}`;
    });
    const remaining = parsedIssues.length - sample.length;
    return `Validation failed (${parsedIssues.length} issues): ${sample.join('; ')}${remaining > 0 ? `; … ${remaining} more` : ''}`;
  }
  return String(error?.message || error || 'Unknown error');
}

async function writeBridgeResponse(payload, exitCode = 0) {
  const text = `${JSON.stringify(payload)}\n`;
  await new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
  process.exitCode = exitCode;
}

function applySecrets(secrets = {}) {
  for (const [key, value] of Object.entries(secrets || {})) {
    if (value == null || value === '') continue;
    process.env[key] = String(value);
  }
}

async function main() {
  const envelope = await readEnvelope();
  const op = String(envelope.op || '').trim();
  applySecrets(envelope.secrets);

  // Run from the site root so the ground-truth modules resolve ./entries,
  // ./data and entry-template/ exactly as the CLI does.
  try {
    process.chdir(await siteRoot());
  } catch {
    /* surfaced by the handler if the root is genuinely missing */
  }

  const handler = handlers[op];
  if (!handler) {
    await writeBridgeResponse({ ok: false, error: `Unknown op: ${op || '(empty)'}`, ops: Object.keys(handlers) }, 2);
    return;
  }

  try {
    const result = await handler(envelope.args || {});
    await writeBridgeResponse({ ok: true, result });
  } catch (error) {
    await writeBridgeResponse({ ok: false, error: formatBridgeError(error) }, 1);
  }
}

main().catch(async (error) => {
  try {
    await writeBridgeResponse({ ok: false, error: formatBridgeError(error) }, 1);
  } catch (writeError) {
    process.stderr.write(`${String(writeError?.stack || writeError?.message || writeError)}\n`);
    process.exitCode = 1;
  }
});
