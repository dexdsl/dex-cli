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
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
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

  // --- entries (local /entries/<slug>/ folders) -------------------------
  'entry.list': async () => {
    const dir = await entriesDir();
    let names = [];
    try {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      names = ents.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return { entries: [] };
    }
    const rows = [];
    for (const slug of names) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, slug, 'entry.json'), 'utf8'));
        const sidebar = raw?.sidebarPageConfig || {};
        rows.push({
          slug,
          title: raw?.title || slug,
          lookupNumber: sidebar?.lookupNumber || '',
          buckets: Array.isArray(sidebar?.downloads?.selectedBuckets)
            ? sidebar.downloads.selectedBuckets
            : Array.isArray(sidebar?.buckets)
              ? sidebar.buckets
              : [],
          updatedAt: raw?.lifecycle?.updatedAt || raw?.updatedAt || '',
        });
      } catch {
        rows.push({ slug, title: slug, lookupNumber: '', buckets: [], updatedAt: '', error: true });
      }
    }
    rows.sort((a, b) => a.slug.localeCompare(b.slug));
    return { entries: rows };
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
    return runWriteEntryFromData(data, { dryRun: !!args.dryRun });
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

  // entry.bucketScan — read a bucket's Google Drive folder and summarise the
  // downloadable files within (count + total size + file list).
  'entry.bucketScan': async (args = {}) => {
    const folderId = String(args.folderId || '').trim();
    if (!folderId) throw new Error('entry.bucketScan requires { folderId }');
    const buckets = await lib('entry-bucket-folders.mjs');
    return buckets.scanBucketFolder({ folderId });
  },

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
async function runWriteEntryFromData(data, { dryRun = false } = {}) {
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
  return { dryRun: false, slug: data.slug, report: result?.report || null, htmlPath: result?.report?.htmlPath || '', lines };
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
    process.stdout.write(`${JSON.stringify({ ok: false, error: `Unknown op: ${op || '(empty)'}`, ops: Object.keys(handlers) })}\n`);
    process.exit(2);
  }

  try {
    const result = await handler(envelope.args || {});
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) })}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error?.stack || error?.message || String(error) })}\n`);
  process.exit(1);
});
