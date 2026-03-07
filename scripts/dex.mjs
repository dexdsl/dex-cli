#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import prompts from 'prompts';
import { fileURLToPath } from 'node:url';
import {
  ALL_BUCKETS,
  BUCKETS,
  manifestSchemaForFormats,
  normalizeManifest,
  slugify,
} from './lib/entry-schema.mjs';
import { buildEmptyManifestSkeleton, prepareTemplate } from './lib/init-core.mjs';
import { scanEntries } from './lib/doctor.mjs';
import { deriveCanonicalEntry, descriptionTextFromSeed } from './lib/entry-html.mjs';
import { parseViewerArgs, startViewer } from './lib/viewer-server.mjs';
import { runDeployShortcut } from './lib/deploy.mjs';
import { writeEntryFromData } from './lib/entry-run.mjs';
import { ensureWorkspaceConfig, runDexSetup } from './lib/dex-setup.mjs';
import { isSupportedRepoKey, resolveRepoRoot } from './lib/dex-workspace-config.mjs';
import { listStaffLinkGroups, normalizeLinkToken } from './lib/staff-links.mjs';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

let DEX_WORKSPACE_CONTEXT = {
  activeRepo: 'site',
  activeRoot: process.cwd(),
  configPath: '',
  config: null,
};

const ensure = async (p) => { try { await fs.access(p); return true; } catch { return false; } };
const parseJsonMaybe = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

function dashboardContext({ initialMode, paletteOpen, version } = {}) {
  return {
    initialMode,
    paletteOpen,
    version,
    workspace: {
      activeRepo: DEX_WORKSPACE_CONTEXT.activeRepo,
      activeRoot: DEX_WORKSPACE_CONTEXT.activeRoot,
      configPath: DEX_WORKSPACE_CONTEXT.configPath,
      config: DEX_WORKSPACE_CONTEXT.config,
    },
  };
}

function dedupeSlug(base, existing) {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

async function promptLinks(message) {
  const links = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { add } = await prompts({ type: 'toggle', name: 'add', message, initial: false, active: 'yes', inactive: 'no' });
    if (!add) break;
    const ans = await prompts([
      { type: 'text', name: 'label', message: 'Link label:', validate: (v) => (!!v || 'Required') },
      { type: 'text', name: 'href', message: 'Link href:', validate: (v) => (!!v || 'Required') },
    ]);
    links.push(ans);
  }
  return links;
}

function defaultCredits(base) {
  const now = new Date().getUTCFullYear();
  return {
    artist: Array.isArray(base?.artist) ? base.artist : (base?.artist?.name ? String(base.artist.name).split(',').map((v) => v.trim()).filter(Boolean) : []),
    artistAlt: base?.artistAlt || null,
    instruments: Array.isArray(base?.instruments) ? base.instruments : [],
    video: {
      director: Array.isArray(base?.video?.director) ? base.video.director : (base?.video?.director?.name ? String(base.video.director.name).split(',').map((v) => v.trim()).filter(Boolean) : []),
      cinematography: Array.isArray(base?.video?.cinematography) ? base.video.cinematography : (base?.video?.cinematography?.name ? String(base.video.cinematography.name).split(',').map((v) => v.trim()).filter(Boolean) : []),
      editing: Array.isArray(base?.video?.editing) ? base.video.editing : (base?.video?.editing?.name ? String(base.video.editing.name).split(',').map((v) => v.trim()).filter(Boolean) : []),
    },
    audio: { recording: Array.isArray(base?.audio?.recording) ? base.audio.recording : (base?.audio?.recording?.name ? String(base.audio.recording.name).split(',').map((v) => v.trim()).filter(Boolean) : []), mix: Array.isArray(base?.audio?.mix) ? base.audio.mix : (base?.audio?.mix?.name ? String(base.audio.mix.name).split(',').map((v) => v.trim()).filter(Boolean) : []), master: Array.isArray(base?.audio?.master) ? base.audio.master : (base?.audio?.master?.name ? String(base.audio.master.name).split(',').map((v) => v.trim()).filter(Boolean) : []) },
    year: Number(base?.year) || now,
    season: base?.season || 'S1',
    location: typeof base?.location === 'string' && base.location.trim() ? base.location : 'Unknown',
  };
}

function mapSeriesToImage(series) {
  if (series === 'dex') return '/assets/series/dex.png';
  if (series === 'inDex') return '/assets/series/index.png';
  if (series === 'dexFest') return '/assets/series/dexfest.png';
  return '/assets/series/dex.png';
}



async function collectInitData(opts, slugArg) {
  const base = opts.from ? await parseJsonMaybe(path.resolve(opts.from)) : {};
  const quick = !!opts.quick;

  const nonInteractive = !process.stdin.isTTY;
  if (nonInteractive) {
    const title = base.title || slugArg || 'new entry';
    const lookup = base.sidebarPageConfig?.lookupNumber || 'LOOKUP-0000';
    const outDir = path.resolve(opts.out || './entries');
    const existing = new Set((await ensure(outDir)) ? (await fs.readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) : []);
    const computedSlug = dedupeSlug(slugify(slugArg || base.slug || title), existing);
    const videoUrl = String(base.video?.dataUrlOriginal || base.video?.dataUrl || '').trim();
    if (!videoUrl) throw new Error('Video URL is required for non-interactive init. Pass --from with video.dataUrl.');
    const seedCredits = base.sidebarPageConfig?.credits || base.creditsData;
    const seedRecordingIndexPdfRef = String(
      base?.sidebarPageConfig?.downloads?.recordingIndexPdfRef
      || base?.sidebarPageConfig?.recordingIndexPdfRef
      || '',
    ).trim();
    const seedRecordingIndexBundleRef = String(
      base?.sidebarPageConfig?.downloads?.recordingIndexBundleRef
      || base?.sidebarPageConfig?.recordingIndexBundleRef
      || '',
    ).trim();
    const seedRecordingIndexSourceUrl = String(
      base?.sidebarPageConfig?.downloads?.recordingIndexSourceUrl
      || base?.sidebarPageConfig?.recordingIndexSourceUrl
      || '',
    ).trim();
    const seedDownloads = (
      base?.sidebarPageConfig?.downloads
      && typeof base.sidebarPageConfig.downloads === 'object'
      && !Array.isArray(base.sidebarPageConfig.downloads)
    )
      ? JSON.parse(JSON.stringify(base.sidebarPageConfig.downloads))
      : {};
    const seedCreditsData = defaultCredits(seedCredits);
    if (seedCredits && typeof seedCredits === 'object') {
      if (typeof seedCredits.instrumentLinksEnabled === 'boolean') {
        seedCreditsData.instrumentLinksEnabled = seedCredits.instrumentLinksEnabled;
      }
      if (seedCredits.linksByPerson && typeof seedCredits.linksByPerson === 'object' && !Array.isArray(seedCredits.linksByPerson)) {
        seedCreditsData.linksByPerson = JSON.parse(JSON.stringify(seedCredits.linksByPerson));
      }
    }
    const sidebar = {
      lookupNumber: lookup,
      buckets: base.sidebarPageConfig?.buckets || ['A'],
      specialEventImage: base.sidebarPageConfig?.specialEventImage || mapSeriesToImage(base.series || 'dex'),
      attributionSentence: base.sidebarPageConfig?.attributionSentence || 'Attribution',
      credits: seedCreditsData,
      fileSpecs: base.sidebarPageConfig?.fileSpecs || base.fileSpecs || { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } },
      metadata: base.sidebarPageConfig?.metadata || base.metadata || { sampleLength: '', tags: [] },
    };
    if (seedRecordingIndexPdfRef) seedDownloads.recordingIndexPdfRef = seedRecordingIndexPdfRef;
    if (seedRecordingIndexBundleRef) seedDownloads.recordingIndexBundleRef = seedRecordingIndexBundleRef;
    if (seedRecordingIndexSourceUrl) seedDownloads.recordingIndexSourceUrl = seedRecordingIndexSourceUrl;
    if (Object.keys(seedDownloads).length) {
      sidebar.downloads = seedDownloads;
    }
    if (base?.sidebarPageConfig?.bucketFileStats && typeof base.sidebarPageConfig.bucketFileStats === 'object') {
      sidebar.bucketFileStats = JSON.parse(JSON.stringify(base.sidebarPageConfig.bucketFileStats));
    }
    const canonical = deriveCanonicalEntry({
      canonical: base.canonical,
      sidebarConfig: sidebar,
      creditsData: base.creditsData,
    });
    const manifestSeed = (base.manifest && typeof base.manifest === 'object' && !Array.isArray(base.manifest))
      ? JSON.parse(JSON.stringify(base.manifest))
      : buildEmptyManifestSkeleton(opts.formatKeys);
    const manifest = normalizeManifest(manifestSeed, opts.formatKeys, ALL_BUCKETS);
    manifestSchemaForFormats(opts.formatKeys?.audio || [], opts.formatKeys?.video || []).parse(manifest);
    return {
      slug: computedSlug,
      title,
      canonical,
      video: { mode: 'url', dataUrl: videoUrl, dataUrlOriginal: videoUrl, dataHtml: '' },
      descriptionText: descriptionTextFromSeed(base),
      sidebar,
      manifest,
      authEnabled: true,
      series: base.series || 'dex',
      selectedBuckets: Array.isArray(base.selectedBuckets) && base.selectedBuckets.length
        ? base.selectedBuckets
        : (Array.isArray(sidebar.buckets) ? sidebar.buckets : []),
      creditsData: base.creditsData || seedCreditsData,
      fileSpecs: base.fileSpecs || sidebar.fileSpecs,
      metadata: base.metadata || sidebar.metadata,
      outDir,
    };
  }

  const id = await prompts([
    { type: 'text', name: 'title', message: 'Title:', initial: base.title || '', validate: (v) => (!!v || 'Required') },
    { type: 'text', name: 'slug', message: 'Slug:', initial: slugArg || base.slug || undefined },
  ]);
  const outDir = path.resolve(opts.out || './entries');
  const existing = new Set((await ensure(outDir)) ? (await fs.readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) : []);
  const computedSlug = dedupeSlug(slugify(id.slug || id.title), existing);

  const nameAns = await prompts({ type: 'text', name: 'name', message: 'Name:', initial: Array.isArray(base.sidebarPageConfig?.credits?.artist) ? base.sidebarPageConfig.credits.artist.join(', ') : (base.sidebarPageConfig?.credits?.artist?.name || ''), validate: (v) => (!!v || 'Required') });

  const instruments = [(await prompts({ type: 'text', name: 'instrument', message: 'Instrument:', initial: Array.isArray(base.sidebarPageConfig?.credits?.instruments) ? String(base.sidebarPageConfig.credits.instruments[0] || '') : String(base.sidebarPageConfig?.credits?.instruments?.[0]?.name || ''), validate: (v) => (!!v || 'Required') })).instrument];
  if (!quick) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { add } = await prompts({ type: 'toggle', name: 'add', message: 'Add another instrument?', initial: false, active: 'yes', inactive: 'no' });
      if (!add) break;
      const item = await prompts({ type: 'text', name: 'name', message: 'Instrument name:', validate: (v) => (!!v || 'Required') });
      instruments.push(item.name);
    }
  }



  const lookupAns = await prompts({ type: 'text', name: 'lookup', message: 'Lookup number:', initial: base.sidebarPageConfig?.lookupNumber || '', validate: (v) => (!!v || 'Required') });

  const videoMode = await prompts({
    type: 'select',
    name: 'mode',
    message: 'Video input:',
    choices: [{ title: 'Paste URL', value: 'url' }, { title: 'Paste raw embed HTML', value: 'embed' }],
    initial: 0,
  });
  const video = videoMode.mode === 'embed'
    ? { mode: 'embed', dataUrl: '', dataUrlOriginal: '', dataHtml: (await prompts({ type: 'text', name: 'dataHtml', message: 'Paste raw embed HTML:' })).dataHtml || '' }
    : { mode: 'url', dataUrl: '', dataUrlOriginal: '', dataHtml: '' };
  if (video.mode === 'url') {
    const ans = await prompts({ type: 'text', name: 'url', message: 'Video URL:', initial: base.video?.dataUrlOriginal || base.video?.dataUrl || '', validate: (v) => (!!v || 'Required') });
    video.dataUrl = ans.url;
    video.dataUrlOriginal = ans.url;
    video.dataHtml = '';
  }


  const descriptionText = (await prompts({ type: 'text', name: 'description', message: 'Description (plain text):', initial: descriptionTextFromSeed(base) })).description || '';

  const seriesAns = await prompts({
    type: 'select',
    name: 'series',
    message: 'Series:',
    choices: [{ title: 'dex', value: 'dex' }, { title: 'inDex', value: 'inDex' }, { title: 'dexFest', value: 'dexFest' }, { title: 'none', value: 'none' }],
    initial: 3,
  });

  const bucketAns = await prompts({ type: 'multiselect', name: 'buckets', message: 'Buckets (available):', choices: BUCKETS.map((b) => ({ title: b, value: b })), initial: (base.sidebarPageConfig?.buckets || ['A']).map((b) => BUCKETS.indexOf(b)).filter((i) => i >= 0), min: 1 });
  const attributionAns = await prompts({ type: 'text', name: 'attributionSentence', message: 'Attribution sentence:', initial: base.sidebarPageConfig?.attributionSentence || '', validate: (v) => (!!v || 'Required') });

  let credits = defaultCredits(base.sidebarPageConfig?.credits);
  await prompts({
    type: 'text',
    name: 'continue',
    message: 'Credits flow not implemented yet. Using minimal defaults for now. Press Enter to continue.',
    initial: '',
  });
  credits.artist = nameAns.name.split(',').map((v) => v.trim()).filter(Boolean);
  credits.instruments = instruments;

  const seedRecordingIndexPdfRef = String(
    base?.sidebarPageConfig?.downloads?.recordingIndexPdfRef
    || base?.sidebarPageConfig?.recordingIndexPdfRef
    || '',
  ).trim();

  const sidebar = {
    lookupNumber: lookupAns.lookup,
    buckets: bucketAns.buckets,
    specialEventImage: mapSeriesToImage(seriesAns.series),
    attributionSentence: attributionAns.attributionSentence,
    credits,
    fileSpecs: { bitDepth: 24, sampleRate: 48000, channels: 'stereo', staticSizes: { A: '', B: '', C: '', D: '', E: '', X: '' } },
    metadata: { sampleLength: '', tags: [] },
  };
  if (seedRecordingIndexPdfRef) {
    sidebar.downloads = { recordingIndexPdfRef: seedRecordingIndexPdfRef };
  }
  const canonical = deriveCanonicalEntry({
    canonical: base.canonical,
    sidebarConfig: sidebar,
    creditsData: credits,
  });

  await prompts({
    type: 'text',
    name: 'continue',
    message: 'Download manifest flow not implemented yet. Generating an empty manifest skeleton. Press Enter to continue.',
    initial: '',
  });
  const manifest = buildEmptyManifestSkeleton(opts.formatKeys);
  normalizeManifest(manifest, opts.formatKeys, ALL_BUCKETS);
  manifestSchemaForFormats(opts.formatKeys?.audio || [], opts.formatKeys?.video || []).parse(manifest);

  return {
    slug: computedSlug,
    title: id.title,
    canonical,
    video,
    descriptionText,
    sidebar,
    manifest: normalizeManifest(manifest, opts.formatKeys, ALL_BUCKETS),
    authEnabled: true,
    outDir,
  };
}

async function initCommand(slugArg, opts) {
  const { templatePath, templateHtml, formatKeys } = await prepareTemplate({ templateArg: opts.template });
  const data = await collectInitData({ ...opts, formatKeys }, slugArg);
  const { report, lines } = await writeEntryFromData({ templatePath, templateHtml, data, opts });
  lines.forEach((line) => console.log(line));
  if (!opts.dryRun) {
    const relativeHtmlPath = path.relative(process.cwd(), report.htmlPath) || report.htmlPath;
    console.log(`Recent entry: ${relativeHtmlPath}`);
    console.log('To preview in localhost mode: dex view');
  }

  if (process.env.DEX_INIT_REPORT_PATH) {
    await fs.writeFile(process.env.DEX_INIT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
  }
}


function parseTopLevelMode(argv) {
  const args = argv.slice(2);
  const hasTopHelp = args.includes('--help') || args.includes('-h');
  const firstNonFlag = args.find((arg) => !arg.startsWith('-'));
  if (!firstNonFlag && args.length === 0) return { mode: 'dashboard', paletteOpen: false, command: null, rest: [] };
  if (!firstNonFlag && hasTopHelp) return { mode: 'dashboard', paletteOpen: true, command: null, rest: [] };
  if (['init', 'update', 'doctor', 'status'].includes(firstNonFlag)) {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'ink-command', paletteOpen: false, command: firstNonFlag, rest: args.slice(idx + 1) };
  }
  if (['view', 'viewer'].includes(firstNonFlag)) {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'view', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'polls') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'polls', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'call') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'call', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'newsletter') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'newsletter', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'catalog') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'catalog', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'home') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'home', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'notes') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'notes', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'assets') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'assets', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'entry') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'entry', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'deploy') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'deploy', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'release') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'release', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'setup') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'setup', rest: args.slice(idx + 1) };
  }
  if (firstNonFlag === 'links') {
    const idx = args.indexOf(firstNonFlag);
    return { mode: 'direct-command', paletteOpen: false, command: 'links', rest: args.slice(idx + 1) };
  }
  return { mode: 'legacy', paletteOpen: false, command: null, rest: args };
}

function stripRepoFlag(argv = []) {
  const out = [argv[0], argv[1]];
  let repo = 'site';
  for (let index = 2; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (arg === '--repo') {
      const next = String(argv[index + 1] || '').trim();
      if (next && !next.startsWith('--')) {
        repo = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length);
      continue;
    }
    out.push(arg);
  }
  return {
    argv: out,
    repo: String(repo || '').trim().toLowerCase() || 'site',
  };
}

function parseInitArgs(rest = []) {
  const opts = {
    quick: true,
    out: './entries',
    catalogLink: {
      mode: 'create-linked',
      enabled: true,
    },
  };
  let slugArg;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === '--quick') { opts.quick = true; continue; }
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg === '--flat') { opts.flat = true; continue; }
    if (arg === '--open') { opts.open = true; continue; }
    if (arg === '--template' && next) { opts.template = next; i += 1; continue; }
    if (arg.startsWith('--template=')) { opts.template = arg.slice('--template='.length); continue; }
    if (arg === '--out' && next) { opts.out = next; i += 1; continue; }
    if (arg.startsWith('--out=')) { opts.out = arg.slice('--out='.length); continue; }
    if (arg === '--from' && next) { opts.from = next; i += 1; continue; }
    if (arg.startsWith('--from=')) { opts.from = arg.slice('--from='.length); continue; }
    if (arg === '--catalog-link' && next) { opts.catalogLink.mode = next; i += 1; continue; }
    if (arg.startsWith('--catalog-link=')) { opts.catalogLink.mode = arg.slice('--catalog-link='.length); continue; }
    if (arg === '--catalog-file' && next) { opts.catalogFilePath = next; opts.catalogLink.filePath = next; i += 1; continue; }
    if (arg.startsWith('--catalog-file=')) {
      const filePath = arg.slice('--catalog-file='.length);
      opts.catalogFilePath = filePath;
      opts.catalogLink.filePath = filePath;
      continue;
    }
    if (arg === '--catalog-status' && next) { opts.catalogLink.status = next; i += 1; continue; }
    if (arg.startsWith('--catalog-status=')) { opts.catalogLink.status = arg.slice('--catalog-status='.length); continue; }
    if (arg === '--catalog-entry-id' && next) { opts.catalogLink.entryId = next; i += 1; continue; }
    if (arg.startsWith('--catalog-entry-id=')) { opts.catalogLink.entryId = arg.slice('--catalog-entry-id='.length); continue; }
    if (arg === '--catalog-entry-href' && next) { opts.catalogLink.entryHref = next; i += 1; continue; }
    if (arg.startsWith('--catalog-entry-href=')) { opts.catalogLink.entryHref = arg.slice('--catalog-entry-href='.length); continue; }
    if (arg === '--catalog-lookup' && next) { opts.catalogLink.lookupNumber = next; i += 1; continue; }
    if (arg.startsWith('--catalog-lookup=')) { opts.catalogLink.lookupNumber = arg.slice('--catalog-lookup='.length); continue; }
    if (arg === '--catalog-season' && next) { opts.catalogLink.season = next; i += 1; continue; }
    if (arg.startsWith('--catalog-season=')) { opts.catalogLink.season = arg.slice('--catalog-season='.length); continue; }
    if (arg === '--catalog-performer' && next) { opts.catalogLink.performer = next; i += 1; continue; }
    if (arg.startsWith('--catalog-performer=')) { opts.catalogLink.performer = arg.slice('--catalog-performer='.length); continue; }
    if (arg === '--catalog-instrument' && next) { opts.catalogLink.instrument = next; i += 1; continue; }
    if (arg.startsWith('--catalog-instrument=')) { opts.catalogLink.instrument = arg.slice('--catalog-instrument='.length); continue; }
    if (!arg.startsWith('-') && !slugArg) slugArg = arg;
  }
  return { slugArg, opts };
}

function parsePollsCommandArgs(rest = []) {
  const [subcommand = '', ...rawArgs] = rest;
  const flags = new Map();
  const values = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index += 1;
        continue;
      }
      flags.set(name, 'true');
      continue;
    }
    values.push(arg);
  }
  return { subcommand, flags, values };
}

async function runPollsCommand(rest = []) {
  const {
    readPollsFile,
    writePollsFile,
    createPollDraft,
    upsertPoll,
    setPollStatus,
  } = await import('./lib/polls-store.mjs');
  const { readCallsRegistry } = await import('./lib/calls-store.mjs');
  const { allocateNextInDexSequence, buildPollCallRef, normalizeCallRef } = await import('./lib/call-lookup.mjs');
  const { validatePollsFile } = await import('./lib/polls-schema.mjs');
  const { publishPolls } = await import('./lib/polls-publish.mjs');
  const {
    getAdminPollOverview,
    getAdminPollLive,
    getAdminPollTrend,
    getAdminPollSnapshots,
    publishAdminPollSnapshot,
    promoteAdminPollSnapshot,
  } = await import('./lib/polls-admin-api.mjs');
  const {
    renderLineTrend,
    renderStackedOptionTrend,
    renderVelocityTrend,
  } = await import('./lib/polls-kuva.mjs');
  const { runPollsScreen } = await import('./ui/polls-screen.mjs');

  const parsed = parsePollsCommandArgs(rest);
  const { subcommand, flags, values } = parsed;

  if (!subcommand) {
    if (process.stdout.isTTY && process.stdin.isTTY) {
      const action = await runPollsScreen();
      if (action === 'validate') {
        const { data } = await readPollsFile();
        validatePollsFile(data);
        console.log('polls:validate passed.');
        return;
      }
      if (action === 'publish-test' || action === 'publish-prod') {
        const env = action === 'publish-prod' ? 'prod' : 'test';
        const result = await publishPolls({ env });
        const eventSummary = result.events
          ? ` events sent=${result.events.sent || 0} failed=${result.events.failed || 0} skipped=${result.events.skipped || 0}`
          : '';
        console.log(`polls:publish (${result.env}) synced ${result.count} polls -> ${result.apiBase}${eventSummary}`);
        return;
      }
    }
    console.log('Usage: dex polls <desk|validate|create|edit|close|open|publish|overview|live|trend|snapshots|publish-results|promote-results> [args]');
    return;
  }

  if (subcommand === 'desk') {
    const env = flags.get('--env') || process.env.DEX_POLLS_OPS_ENV || 'test';
    if (env) process.env.DEX_POLLS_OPS_ENV = String(env);
    const layout = flags.get('--layout');
    if (layout) process.env.DEX_POLLS_DESK_LAYOUT = String(layout);
    if (flags.has('--paused')) process.env.DEX_POLLS_DESK_PAUSED = '1';
    if (process.stdout.isTTY && process.stdin.isTTY) {
      const { runDashboard } = await import('./ui/dashboard.mjs');
      const packageJson = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
      await runDashboard(dashboardContext({
        initialMode: 'polls',
        version: packageJson.version || 'dev',
      }));
      return;
    }
    throw new Error('polls:desk requires an interactive TTY');
  }

  if (subcommand === 'validate') {
    const { data } = await readPollsFile();
    validatePollsFile(data);
    console.log('polls:validate passed.');
    return;
  }

  if (subcommand === 'publish') {
    const env = flags.get('--env') || flags.get('--target') || 'test';
    const filePath = flags.get('--file');
    const result = await publishPolls({ env, filePath });
    const eventSummary = result.events
      ? ` events sent=${result.events.sent || 0} failed=${result.events.failed || 0} skipped=${result.events.skipped || 0}`
      : '';
    console.log(`polls:publish (${result.env}) synced ${result.count} polls -> ${result.apiBase}${eventSummary}`);
    return;
  }

  const printVoteRows = (options = [], countsRaw = {}, totalRaw = 0) => {
    const total = Math.max(0, Number(totalRaw) || 0);
    const counts = countsRaw && typeof countsRaw === 'object' ? countsRaw : {};
    options.forEach((label, index) => {
      const count = Math.max(0, Number(counts[String(index)] ?? counts[index] ?? 0) || 0);
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      console.log(`  ${String(index + 1).padStart(2)}. ${String(label || '').padEnd(42)} ${String(count).padStart(5)} (${String(pct).padStart(3)}%)`);
    });
  };

  const toTrendSeries = (payload) => {
    const trend = payload?.trend && typeof payload.trend === 'object' ? payload.trend : payload;
    const candidates = [
      trend?.series,
      trend?.totals,
      trend?.points,
      trend?.rows,
      trend?.trend,
    ];
    const list = candidates.find((item) => Array.isArray(item)) || [];
    return list.map((row) => ({
      t: String(row?.t || row?.bucket || row?.timestamp || row?.date || row?.label || '').trim(),
      value: Number(row?.value ?? row?.count ?? row?.total ?? 0) || 0,
    })).filter((row) => row.t);
  };

  const toTrendSeriesByOption = (payload) => {
    const trend = payload?.trend && typeof payload.trend === 'object' ? payload.trend : payload;
    const out = {};
    if (trend?.seriesByOption && typeof trend.seriesByOption === 'object' && !Array.isArray(trend.seriesByOption)) {
      for (const [key, value] of Object.entries(trend.seriesByOption)) {
        if (!Array.isArray(value)) continue;
        out[key] = value.map((row) => ({
          t: String(row?.t || row?.bucket || row?.timestamp || row?.date || row?.label || '').trim(),
          value: Number(row?.value ?? row?.count ?? row?.total ?? 0) || 0,
        })).filter((row) => row.t);
      }
      return out;
    }
    if (Array.isArray(trend?.options)) {
      for (const option of trend.options) {
        const key = String(option?.label || option?.name || option?.option || option?.index || '').trim();
        const points = Array.isArray(option?.series) ? option.series : [];
        if (!key || !points.length) continue;
        out[key] = points.map((row) => ({
          t: String(row?.t || row?.bucket || row?.timestamp || row?.date || row?.label || '').trim(),
          value: Number(row?.value ?? row?.count ?? row?.total ?? 0) || 0,
        })).filter((row) => row.t);
      }
    }
    return out;
  };

  const readSummaryFile = async (summaryFile) => {
    const absolute = path.resolve(summaryFile);
    const content = await fs.readFile(absolute, 'utf8');
    const trimmed = String(content || '').trim();
    if (!trimmed) throw new Error(`Summary file is empty: ${absolute}`);
    return trimmed;
  };

  if (subcommand === 'overview') {
    const env = flags.get('--env') || 'test';
    const windowValue = flags.get('--window') || '30d';
    const { payload, apiBase } = await getAdminPollOverview({ env, window: windowValue });
    const overview = payload?.overview && typeof payload.overview === 'object' ? payload.overview : payload;
    console.log(`polls:overview (${env}) via ${apiBase}`);
    if (overview?.totals && typeof overview.totals === 'object') {
      const totals = overview.totals;
      console.log(`  open=${totals.open ?? 0} closed=${totals.closed ?? 0} draft=${totals.draft ?? 0} votes=${totals.votes ?? 0}`);
    }
    const rows = Array.isArray(overview?.polls) ? overview.polls : [];
    if (!rows.length) {
      console.log('  no poll rows returned.');
      return;
    }
    for (const row of rows) {
      const id = String(row?.pollId || row?.id || '').trim() || '(unknown)';
      const status = String(row?.status || '-').padEnd(6);
      const votes = String(Math.max(0, Number(row?.votes ?? row?.totalVotes ?? 0) || 0)).padStart(5);
      const closeAt = String(row?.closeAt || row?.close_at || '').slice(0, 10) || 'n/a';
      console.log(`  ${id.padEnd(40)} ${status} votes:${votes} close:${closeAt}`);
    }
    return;
  }

  if (subcommand === 'live') {
    const env = flags.get('--env') || 'test';
    const pollId = values[0] || flags.get('--id');
    if (!pollId) throw new Error('polls:live requires a poll id');
    const { payload, apiBase } = await getAdminPollLive({ pollId, env });
    const live = payload?.live && typeof payload.live === 'object' ? payload.live : payload;
    const poll = live?.poll || {};
    const options = Array.isArray(poll?.options) ? poll.options : [];
    const counts = live?.counts && typeof live.counts === 'object' ? live.counts : {};
    const total = Number(live?.total ?? live?.totalVotes ?? 0) || 0;
    console.log(`polls:live (${env}) ${pollId} via ${apiBase}`);
    console.log(`  question: ${String(poll?.question || 'n/a')}`);
    console.log(`  status: ${String(poll?.status || 'n/a')} visibility: ${String(poll?.visibility || 'n/a')} total:${total}`);
    printVoteRows(options, counts, total);
    return;
  }

  if (subcommand === 'trend') {
    const env = flags.get('--env') || 'test';
    const pollId = values[0] || flags.get('--id');
    const windowValue = flags.get('--window') || '90d';
    const bucket = flags.get('--bucket') || 'day';
    const chart = (flags.get('--chart') || 'line').toLowerCase();
    if (!pollId) throw new Error('polls:trend requires a poll id');

    const { payload, apiBase } = await getAdminPollTrend({
      pollId,
      env,
      window: windowValue,
      bucket,
    });
    if (flags.has('--json')) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    const series = toTrendSeries(payload);
    const seriesByOption = toTrendSeriesByOption(payload);
    let chartText = '';
    if (chart === 'stack' || chart === 'stacked') {
      chartText = await renderStackedOptionTrend(seriesByOption, {
        title: `polls:trend ${pollId} (${windowValue}/${bucket})`,
        termWidth: Math.max(42, Math.min(120, (process.stdout?.columns || 96) - 6)),
        termHeight: 18,
      });
    } else if (chart === 'velocity') {
      chartText = await renderVelocityTrend(series, {
        title: `polls:trend velocity ${pollId} (${windowValue}/${bucket})`,
        termWidth: Math.max(42, Math.min(120, (process.stdout?.columns || 96) - 6)),
        termHeight: 18,
      });
    } else {
      chartText = await renderLineTrend(series, {
        title: `polls:trend ${pollId} (${windowValue}/${bucket})`,
        termWidth: Math.max(42, Math.min(120, (process.stdout?.columns || 96) - 6)),
        termHeight: 18,
      });
    }
    console.log(`polls:trend (${env}) ${pollId} via ${apiBase}`);
    console.log(chartText);
    return;
  }

  if (subcommand === 'snapshots') {
    const env = flags.get('--env') || 'test';
    const pollId = values[0] || flags.get('--id');
    if (!pollId) throw new Error('polls:snapshots requires a poll id');
    const { payload, apiBase } = await getAdminPollSnapshots({ pollId, env });
    const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : (Array.isArray(payload?.items) ? payload.items : []);
    console.log(`polls:snapshots (${env}) ${pollId} via ${apiBase}`);
    if (!snapshots.length) {
      console.log('  no snapshots');
      return;
    }
    for (const item of snapshots) {
      const version = Number(item?.version || 0);
      const state = String(item?.state || 'draft');
      const publishedAt = String(item?.publishedAt || item?.published_at || '').slice(0, 19) || '-';
      const createdAt = String(item?.createdAt || item?.created_at || '').slice(0, 19) || '-';
      const headline = String(item?.headline || '').trim();
      console.log(`  v${String(version).padStart(2)}  ${state.padEnd(9)}  created:${createdAt}  published:${publishedAt}${headline ? `  ${headline}` : ''}`);
    }
    return;
  }

  if (subcommand === 'publish-results') {
    const env = flags.get('--env') || 'test';
    const pollId = values[0] || flags.get('--id');
    const summaryFile = flags.get('--summary-file');
    const headline = flags.get('--headline') || '';
    const draft = flags.has('--draft');
    if (!pollId) throw new Error('polls:publish-results requires a poll id');
    if (!summaryFile) throw new Error('polls:publish-results requires --summary-file <path>');
    const summaryMarkdown = await readSummaryFile(summaryFile);
    const { payload, apiBase } = await publishAdminPollSnapshot({
      pollId,
      env,
      summaryMarkdown,
      headline,
      publish: !draft,
      trendWindow: flags.get('--window') || '90d',
      idempotencyKey: flags.get('--idempotency-key') || '',
    });
    console.log(`polls:publish-results (${env}) ${pollId} via ${apiBase}`);
    console.log(`  version: ${payload?.version ?? '-'} state: ${payload?.state ?? '-'} publishedAt: ${payload?.publishedAt ?? '-'}`);
    return;
  }

  if (subcommand === 'promote-results') {
    const env = flags.get('--env') || 'test';
    const pollId = values[0] || flags.get('--id');
    const version = Number(flags.get('--version') || values[1] || 0);
    if (!pollId) throw new Error('polls:promote-results requires a poll id');
    if (!Number.isFinite(version) || version <= 0) throw new Error('polls:promote-results requires --version <n>');
    const { payload, apiBase } = await promoteAdminPollSnapshot({ pollId, version, env });
    console.log(`polls:promote-results (${env}) ${pollId} via ${apiBase}`);
    console.log(`  version: ${payload?.version ?? version} state: ${payload?.state ?? '-'} updatedAt: ${payload?.publishedAt || payload?.updatedAt || '-'}`);
    return;
  }

  const { data } = await readPollsFile(flags.get('--file'));

  if (subcommand === 'create') {
    const { data: callsData } = await readCallsRegistry(flags.get('--calls-file'));
    const nextSequence = allocateNextInDexSequence({
      calls: callsData.calls,
      polls: data.polls,
    });
    const pollYear = Number(flags.get('--call-year')) || new Date().getUTCFullYear();
    const draft = createPollDraft(data, {
      question: flags.get('--question') || 'New poll question',
      visibility: flags.get('--visibility') || 'public',
      status: flags.get('--status') || 'draft',
      callRef: buildPollCallRef({ year: pollYear, sequence: nextSequence }),
    });
    const next = upsertPoll(data, draft);
    await writePollsFile(next, flags.get('--file'));
    console.log(`polls:create wrote ${draft.id}`);
    return;
  }

  if (subcommand === 'edit') {
    const pollId = values[0] || flags.get('--id');
    if (!pollId) {
      throw new Error('polls:edit requires a poll id');
    }
    const existing = data.polls.find((poll) => poll.id === pollId);
    if (!existing) {
      throw new Error(`polls:edit poll not found: ${pollId}`);
    }
    const updated = {
      ...existing,
      question: flags.get('--question') || existing.question,
      visibility: flags.get('--visibility') || existing.visibility,
      status: flags.get('--status') || existing.status,
      closeAt: flags.get('--closeAt') || existing.closeAt,
      manualClose: flags.has('--manualClose')
        ? flags.get('--manualClose') === 'true'
        : existing.manualClose,
      callRef: normalizeCallRef(existing.callRef || {}),
    };

    if (flags.has('--call-sequence') || flags.has('--call-year')) {
      const nextSequence = Number(flags.get('--call-sequence') || updated.callRef.sequence || 0);
      const nextYear = Number(flags.get('--call-year') || updated.callRef.year || new Date().getUTCFullYear());
      updated.callRef = buildPollCallRef({ year: nextYear, sequence: nextSequence });
    }

    const next = upsertPoll(data, updated);
    await writePollsFile(next, flags.get('--file'));
    console.log(`polls:edit wrote ${pollId}`);
    return;
  }

  if (subcommand === 'close' || subcommand === 'open') {
    const pollId = values[0] || flags.get('--id');
    if (!pollId) {
      throw new Error(`polls:${subcommand} requires a poll id`);
    }
    const status = subcommand === 'close' ? 'closed' : 'open';
    const next = setPollStatus(data, pollId, status);
    await writePollsFile(next, flags.get('--file'));
    console.log(`polls:${subcommand} wrote ${pollId}`);
    return;
  }

  throw new Error(`Unknown polls command: ${subcommand}`);
}

async function runCallCommand(rest = []) {
  const [subcommand = ''] = rest;
  if (!subcommand && process.stdout.isTTY && process.stdin.isTTY) {
    const { runDashboard } = await import('./ui/dashboard.mjs');
    await runDashboard(dashboardContext({
      initialMode: 'calls',
      version: JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'dev',
    }));
    return;
  }
  const { runCallCommand: runCommand, printCallUsage } = await import('./lib/calls-cli.mjs');
  if (!subcommand) {
    printCallUsage();
    return;
  }
  await runCommand(rest);
}

async function runCatalogCommand(rest = []) {
  const [subcommand = ''] = rest;
  if (!subcommand && process.stdout.isTTY && process.stdin.isTTY) {
    const { runDashboard } = await import('./ui/dashboard.mjs');
    await runDashboard(dashboardContext({
      initialMode: 'catalog',
      version: JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'dev',
    }));
    return;
  }
  const { runCatalogCommand: runCommand, printCatalogUsage } = await import('./lib/catalog-cli.mjs');
  if (!subcommand) {
    printCatalogUsage();
    return;
  }
  await runCommand(rest);
}

async function runHomeCommand(rest = []) {
  const [subcommand = ''] = rest;
  if (!subcommand && process.stdout.isTTY && process.stdin.isTTY) {
    const { runDashboard } = await import('./ui/dashboard.mjs');
    await runDashboard(dashboardContext({
      initialMode: 'home',
      version: JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'dev',
    }));
    return;
  }
  const { runHomeCommand: runCommand, printHomeUsage } = await import('./lib/home-featured-cli.mjs');
  if (!subcommand) {
    printHomeUsage();
    return;
  }
  await runCommand(rest);
}

async function runNotesCommand(rest = []) {
  const [subcommand = ''] = rest;
  if (!subcommand && process.stdout.isTTY && process.stdin.isTTY) {
    const { runDashboard } = await import('./ui/dashboard.mjs');
    await runDashboard(dashboardContext({
      initialMode: 'notes',
      version: JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'dev',
    }));
    return;
  }
  const { runDexNotesCommand, printDexNotesUsage } = await import('./lib/dex-notes-cli.mjs');
  if (!subcommand) {
    printDexNotesUsage();
    return;
  }
  await runDexNotesCommand(rest);
}

function printLinksUsage() {
  console.log('Usage: dex links [list] [group] [--group <id>] [--json]');
  console.log('  dex links');
  console.log('  dex links sheets');
  console.log('  dex links --group admin');
  console.log('  dex links --json');
}

function parseLinksCommandArgs(rest = []) {
  let subcommand = '';
  const flags = new Map();
  const values = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = String(rest[index] || '');
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = String(rest[index + 1] || '');
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index += 1;
        continue;
      }
      flags.set(name, 'true');
      continue;
    }
    if (!subcommand) {
      subcommand = arg;
      continue;
    }
    values.push(arg);
  }
  return { subcommand, flags, values };
}

async function runLinksCommand(rest = []) {
  const parsed = parseLinksCommandArgs(rest);
  const { subcommand, flags, values } = parsed;
  if (!subcommand && flags.size === 0 && values.length === 0 && process.stdout.isTTY && process.stdin.isTTY) {
    const { runDashboard } = await import('./ui/dashboard.mjs');
    await runDashboard(dashboardContext({
      initialMode: 'links',
      version: JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'dev',
    }));
    return;
  }
  const actionToken = normalizeLinkToken(subcommand);

  if (actionToken === 'help' || actionToken === '--help' || actionToken === '-h' || flags.has('--help')) {
    printLinksUsage();
    return;
  }

  const action = !actionToken || actionToken === 'list' ? 'list' : 'group';
  const groupToken = action === 'list'
    ? normalizeLinkToken(flags.get('--group') || values[0] || '')
    : actionToken;

  const groups = listStaffLinkGroups(groupToken);
  if (!groups.length) {
    throw new Error(`links: unknown group "${groupToken}"`);
  }

  const asJson = flags.has('--json');
  if (asJson) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      groups: groups.map((group) => ({
        id: group.id,
        label: group.label,
        links: group.links,
      })),
    }, null, 2));
    return;
  }

  console.log('DEX staff links');
  console.log('--------------');
  for (const group of groups) {
    console.log(`\n[${group.label}]`);
    for (const link of group.links) {
      console.log(`- ${link.label}: ${link.url}`);
    }
  }
}

function parseBooleanFlag(value, fallback = false) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

function normalizeReleaseEnv(value) {
  const raw = String(value || 'test').trim().toLowerCase();
  if (raw === 'prod' || raw === 'production') return 'prod';
  if (raw === 'test' || raw === 'staging' || raw === 'sandbox') return 'test';
  throw new Error(`Unsupported env: ${value}`);
}

function printAssetsUsage() {
  console.log('Usage: dex assets <validate|diff|publish|bucket> [args]');
  console.log('  dex assets validate [--file data/protected.assets.json]');
  console.log('  dex assets diff [--env test|prod] [--file data/protected.assets.json]');
  console.log('  dex assets publish [--env test|prod] [--dry-run] [--file data/protected.assets.json]');
  console.log('  dex assets bucket ensure [--env test|prod] [--name dex-protected-assets] [--dry-run]');
}

function printDeployUsage() {
  console.log('Usage: dex deploy [--remote origin] [--no-set-upstream]');
  console.log('                 [--no-preflight] [--preflight-env test|prod]');
  console.log('Pushes the current branch to remote with upstream setup when needed.');
}

function printReleaseUsage() {
  console.log('Usage: dex release <preflight|publish> [args]');
  console.log('  dex release preflight [--env test|prod]');
  console.log('  dex release publish [--env test|prod] [--dry-run] [--no-preflight]');
}

function printSetupUsage() {
  console.log('Usage: dex setup [--reset] [--repo site|api]');
  console.log('Initializes workspace roots for dexdsl.github.io and dex-api.');
}

function runNodeScript(scriptPath, args = []) {
  const command = [path.resolve(scriptPath), ...args.map((arg) => String(arg || ''))];
  const result = spawnSync(process.execPath, command, {
    cwd: DEX_WORKSPACE_CONTEXT.activeRoot || process.cwd(),
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

async function runReleasePreflight({ env = 'test' } = {}) {
  const normalizedEnv = normalizeReleaseEnv(env);
  const logs = [];

  logs.push(`preflight:env=${normalizedEnv}`);

  const { auditEntryRuntime } = await import('./lib/entry-runtime-audit.mjs');
  const audit = await auditEntryRuntime({
    entriesDir: './entries',
    all: true,
    includeLegacy: false,
    includeRuntime: true,
    includeInventory: true,
    catalogEntriesFile: path.resolve('data', 'catalog.entries.json'),
    catalogEditorialFile: path.resolve('data', 'catalog.editorial.json'),
    protectedAssetsFile: path.resolve('data', 'protected.assets.json'),
  });
  const nonSkipped = audit.reports.filter((report) => !report.skippedLegacy);
  if (!audit.reports.length || !nonSkipped.length) {
    throw new Error('preflight failed: no non-exempt entries were audited.');
  }
  if (audit.failures > 0) {
    const failing = audit.reports.filter((report) => !report.ok).slice(0, 5).map((report) => report.slug).join(', ');
    throw new Error(`preflight failed: entry audit failures (${audit.failures}/${audit.reports.length}) ${failing}`);
  }
  logs.push(`✓ entry audit (${audit.reports.length} entries, inventory=${audit.inventory?.rows?.length || 0})`);

  const {
    readProtectedAssetsFile,
    validateCatalogLookupCoverage,
  } = await import('./lib/protected-assets-publisher.mjs');
  const assetsFile = await readProtectedAssetsFile();
  const coverage = await validateCatalogLookupCoverage({
    assetsData: assetsFile.data,
    catalogFilePath: process.env.DEX_CATALOG_EDITORIAL_PATH,
  });
  if (!coverage.ok) {
    throw new Error(`preflight failed: missing protected asset coverage (${coverage.missing.join(', ')})`);
  }
  if (normalizedEnv === 'prod' && Array.isArray(coverage.exempted) && coverage.exempted.length > 0) {
    throw new Error(`preflight failed: prod cannot use active exemptions (${coverage.exempted.join(', ')})`);
  }
  logs.push(`✓ protected assets coverage (active=${coverage.activeCount} mapped=${coverage.mappedCount} exempt=${coverage.exemptCount})`);

  const { runCatalogCommand } = await import('./lib/catalog-cli.mjs');
  await runCatalogCommand(['validate']);
  logs.push('✓ catalog validate');

  const verifyGenerated = runNodeScript('scripts/verify-generated-html.mjs');
  if (!verifyGenerated.ok) {
    const detail = [verifyGenerated.stdout, verifyGenerated.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`preflight failed: verify-generated-html\n${detail}`);
  }
  logs.push('✓ generated html secure checks');

  return { env: normalizedEnv, logs };
}

async function runDeployCommand(rest = []) {
  const flags = new Map();
  const values = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = String(rest[index] || '');
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = rest[index + 1];
      if (next && !String(next).startsWith('--')) {
        flags.set(name, String(next));
        index += 1;
        continue;
      }
      flags.set(name, 'true');
      continue;
    }
    values.push(arg);
  }
  const subcommand = values[0] || '';
  if (subcommand === 'help' || subcommand === '-h' || subcommand === '--help'
    || flags.has('--help') || values.includes('-h') || values.includes('--help')) {
    printDeployUsage();
    return;
  }

  const remote = String(flags.get('--remote') || 'origin').trim() || 'origin';
  const setUpstream = !flags.has('--no-set-upstream');
  const noPreflight = flags.has('--no-preflight');
  const preflightEnv = normalizeReleaseEnv(flags.get('--preflight-env') || 'test');

  if (!noPreflight) {
    const preflight = await runReleasePreflight({ env: preflightEnv });
    preflight.logs.forEach((line) => console.log(line));
    console.log('preflight:passed');
  }

  const result = runDeployShortcut({ cwd: process.cwd(), remote, setUpstream });
  if (!result.ok) {
    const details = [result.error, result.stderr, result.output].filter(Boolean).join('\n');
    throw new Error(details || 'deploy failed');
  }
  const upstreamMsg = result.usedSetUpstream ? ' (upstream configured)' : '';
  console.log(`deploy: pushed ${result.branch} -> ${result.remote}${upstreamMsg}`);
  if (result.output) console.log(result.output);
  if (result.stderr) console.log(result.stderr);
}

async function runReleaseCommand(rest = []) {
  const parsed = parsePollsCommandArgs(rest);
  const { subcommand, flags } = parsed;
  const action = String(subcommand || '').trim().toLowerCase();
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    printReleaseUsage();
    return;
  }

  const env = normalizeReleaseEnv(flags.get('--env') || flags.get('--target') || 'test');
  const dryRun = parseBooleanFlag(flags.get('--dry-run'), false) || flags.has('--dry-run');
  const noPreflight = flags.has('--no-preflight');

  if (action === 'preflight') {
    const result = await runReleasePreflight({ env });
    result.logs.forEach((line) => console.log(line));
    console.log(`release:preflight passed (${result.env})`);
    return;
  }

  if (action === 'publish') {
    if (!noPreflight) {
      const preflight = await runReleasePreflight({ env });
      preflight.logs.forEach((line) => console.log(line));
      console.log('preflight:passed');
    }
    const {
      publishProtectedAssets,
    } = await import('./lib/protected-assets-publisher.mjs');
    const {
      publishCatalogCuration,
      writeCatalogSnapshotFromLocal,
    } = await import('./lib/catalog-publisher.mjs');

    const assetsResult = await publishProtectedAssets({
      env,
      dryRun,
      apiBase: flags.get('--assets-api-base') || flags.get('--api-base'),
      adminToken: flags.get('--assets-token') || flags.get('--token'),
    });
    console.log(`release:assets ${assetsResult.env} hash=${assetsResult.manifestHash.slice(0, 12)} dryRun=${dryRun ? 'yes' : 'no'}`);

    const catalogResult = await publishCatalogCuration({
      env,
      dryRun,
      apiBase: flags.get('--catalog-api-base') || flags.get('--api-base'),
      adminToken: flags.get('--catalog-token') || flags.get('--token'),
    });
    console.log(`release:catalog ${catalogResult.env} hash=${catalogResult.manifestHash.slice(0, 12)} dryRun=${dryRun ? 'yes' : 'no'}`);

    if (!dryRun) {
      await writeCatalogSnapshotFromLocal();
      console.log('release:snapshot synced');
    }
    console.log(`release:publish complete (${env})`);
    return;
  }

  throw new Error(`Unknown release command: ${action}`);
}

async function runSetupCommand(rest = [], { requestedRepo = 'site' } = {}) {
  if (rest.includes('--help') || rest.includes('-h') || rest.includes('help')) {
    printSetupUsage();
    return;
  }
  const reset = rest.includes('--reset');
  const result = await runDexSetup({
    requestedRepo,
    reset,
  });
  console.log(`setup: wrote ${result.filePath}`);
  console.log(`  site: ${result.config?.repos?.site?.root || '-'}`);
  console.log(`  api: ${result.config?.repos?.api?.root || '-'}`);
  console.log(`  defaultRepo: ${result.config?.defaultRepo || '-'}`);
}

async function runAssetsCommand(rest = []) {
  const {
    buildProtectedAssetsPayload,
    diffProtectedAssets,
    ensureProtectedAssetsBucket,
    publishProtectedAssets,
    readProtectedAssetsFile,
    validateCatalogLookupCoverage,
  } = await import('./lib/protected-assets-publisher.mjs');
  const parsed = parsePollsCommandArgs(rest);
  const { subcommand, flags, values } = parsed;

  if (!subcommand) {
    if (process.stdout.isTTY && process.stdin.isTTY) {
      const { runDashboard } = await import('./ui/dashboard.mjs');
      await runDashboard(dashboardContext({
        initialMode: 'assets',
        version: JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'dev',
      }));
      return;
    }
    printAssetsUsage();
    return;
  }

  const filePath = flags.get('--file');
  const env = normalizeReleaseEnv(flags.get('--env') || flags.get('--target') || 'test');
  const dryRun = parseBooleanFlag(flags.get('--dry-run'), false) || flags.has('--dry-run');

  if (subcommand === 'validate') {
    const { data, filePath: resolvedPath } = await readProtectedAssetsFile(filePath);
    const coverage = await validateCatalogLookupCoverage({
      assetsData: data,
      catalogFilePath: process.env.DEX_CATALOG_EDITORIAL_PATH,
    });
    if (!coverage.ok) {
      throw new Error(`assets:validate missing coverage for active catalog lookups: ${coverage.missing.join(', ')}`);
    }
    if (env === 'prod' && Array.isArray(coverage.exempted) && coverage.exempted.length > 0) {
      throw new Error(`assets:validate prod blocked by active exemptions: ${coverage.exempted.join(', ')}`);
    }
    const built = buildProtectedAssetsPayload(data);
    const exemptionSummary = Array.isArray(coverage.exempted) && coverage.exempted.length
      ? ` activeExemptions=${coverage.exempted.join(',')}`
      : '';
    console.log(`assets:validate passed (${resolvedPath}) lookups=${built.counts.lookups} files=${built.counts.files} entitlements=${built.counts.entitlements} exemptions=${built.payload.exemptions?.length || 0} active=${coverage.activeCount} effective=${coverage.effectiveManifestCount} hash=${built.manifestHash.slice(0, 12)}${exemptionSummary}`);
    return;
  }

  if (subcommand === 'diff') {
    const result = await diffProtectedAssets({
      env,
      filePath,
      apiBase: flags.get('--api-base'),
      adminToken: flags.get('--token'),
    });
    console.log(`assets:diff (${result.env}) local=${result.localHash.slice(0, 12)} remote=${(result.remoteHash || '').slice(0, 12) || 'none'}`);
    console.log(`  lookups      +${result.lookups.added} -${result.lookups.removed} ~${result.lookups.changed} (local=${result.counts.local.lookups} remote=${result.counts.remote.lookups})`);
    console.log(`  files        +${result.files.added} -${result.files.removed} ~${result.files.changed} (local=${result.counts.local.files} remote=${result.counts.remote.files})`);
    console.log(`  entitlements +${result.entitlements.added} -${result.entitlements.removed} ~${result.entitlements.changed} (local=${result.counts.local.entitlements} remote=${result.counts.remote.entitlements})`);
    return;
  }

  if (subcommand === 'publish') {
    const result = await publishProtectedAssets({
      env,
      filePath,
      dryRun,
      apiBase: flags.get('--api-base'),
      adminToken: flags.get('--token'),
    });
    console.log(`assets:publish (${result.env}) lookups=${result.counts.lookups} files=${result.counts.files} entitlements=${result.counts.entitlements} dryRun=${result.dryRun ? 'yes' : 'no'} hash=${result.manifestHash.slice(0, 12)} -> ${result.apiBase}`);
    return;
  }

  if (subcommand === 'bucket') {
    const action = String(values[0] || '').trim().toLowerCase();
    if (action !== 'ensure') {
      throw new Error(`Unknown assets bucket command: ${action || '(empty)'}`);
    }
    const result = await ensureProtectedAssetsBucket({
      env,
      filePath,
      bucketName: flags.get('--name'),
      dryRun,
      apiBase: flags.get('--api-base'),
      adminToken: flags.get('--token'),
    });
    console.log(`assets:bucket:ensure (${result.env}) bucket=${result.bucket} dryRun=${result.dryRun ? 'yes' : 'no'} -> ${result.apiBase}`);
    return;
  }

  throw new Error(`Unknown assets command: ${subcommand}`);
}

function printEntryUsage() {
  console.log('Usage: dex entry <audit|link> [args]');
  console.log('  dex entry audit [--slug <slug>] [--all] [--inventory-only]');
  console.log('  dex entry link --entry <slug> [--catalog <id|href|slug>] [--status draft|active|archived] [--dry-run]');
  console.log('    Optional: --lookup --season --performer --instrument --title --catalog-file data/catalog.editorial.json');
  console.log('    Optional: --catalog-entries-file data/catalog.entries.json');
}

async function runEntryCommand(rest = []) {
  const parsed = parsePollsCommandArgs(rest);
  const { subcommand, flags, values } = parsed;
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printEntryUsage();
    return;
  }

  if (subcommand === 'audit') {
    const { auditEntryRuntime } = await import('./lib/entry-runtime-audit.mjs');
    const slug = flags.get('--slug') || flags.get('--entry') || '';
    const includeAll = flags.has('--all');
    const inventoryOnly = parseBooleanFlag(flags.get('--inventory-only')) || flags.has('--inventory-only');
    const result = await auditEntryRuntime({
      slug: slug || undefined,
      all: includeAll || !slug,
      entriesDir: flags.get('--entries-dir') || './entries',
      includeLegacy: String(flags.get('--include-legacy') || '').toLowerCase() === 'true' || flags.has('--include-legacy'),
      includeRuntime: !inventoryOnly,
      includeInventory: true,
      catalogEntriesFile: flags.get('--catalog-entries-file') || path.resolve('data', 'catalog.entries.json'),
      catalogEditorialFile: flags.get('--catalog-file') || path.resolve('data', 'catalog.editorial.json'),
      protectedAssetsFile: flags.get('--assets-file') || path.resolve('data', 'protected.assets.json'),
    });

    if (!inventoryOnly) {
      for (const report of result.reports) {
        if (report.skippedLegacy) {
          console.log(`SKIP ${report.slug} (legacy exemption)`);
          continue;
        }
        const status = report.ok ? 'PASS' : 'FAIL';
        console.log(`${status} ${report.slug}`);
        for (const issue of report.issues) {
          console.log(`  - ${issue}`);
        }
      }
    }

    const rows = Array.isArray(result?.inventory?.rows) ? result.inventory.rows : [];
    console.log(`entry:inventory rows=${rows.length} linked=${result.inventory.counts.linked} entryOnly=${result.inventory.counts.entryOnly} catalogOnly=${result.inventory.counts.catalogOnly} withAssets=${result.inventory.counts.withAssets}`);
    console.log(`  catalog.entries: ${result.inventory.files.catalogEntriesFile}`);
    console.log(`  catalog.editorial: ${result.inventory.files.catalogEditorialFile}`);
    console.log(`  protected.assets: ${result.inventory.files.protectedAssetsFile}`);
    console.log('ENTRY\tSTATE\tCATALOG\tLOOKUP\tBUCKETS\tFILE_IDS\tDL_HEALTH\tROOT\tBUNDLE\tPDF');
    for (const row of rows) {
      const catalogTag = row.catalog?.source
        ? `${row.catalog.entryId || row.entryId} (${row.catalog.source})`
        : '-';
      const lookupValue = row.lookups?.[0] || '-';
      const buckets = Array.isArray(row.assets?.buckets) && row.assets.buckets.length ? row.assets.buckets.join(',') : '-';
      const fileIds = Array.isArray(row.assets?.fileIds) && row.assets.fileIds.length ? row.assets.fileIds.join(',') : '-';
      const tree = row.downloadTree || {};
      const health = Number.isFinite(Number(tree.criticalCount))
        ? `${tree.criticalCount}c/${Number(tree.warnCount || 0)}w`
        : '-';
      const root = tree.rootFolderUrl ? 'ok' : 'missing';
      const bundle = tree.bundleCoverage || '-';
      const pdf = tree.pdfCoverage || '-';
      console.log(`${row.entryId}\t${row.state}\t${catalogTag}\t${lookupValue}\t${buckets}\t${fileIds}\t${health}\t${root}\t${bundle}\t${pdf}`);
      if (Array.isArray(row.warnings) && row.warnings.length) {
        for (const warning of row.warnings) {
          console.log(`  ! ${row.entryId}: ${warning}`);
        }
      }
      if (Array.isArray(tree.criticalIssues) && tree.criticalIssues.length) {
        for (const issue of tree.criticalIssues) {
          console.log(`  ! ${row.entryId}: download-tree critical ${issue}`);
        }
      }
    }

    if (result.failures > 0) {
      throw new Error(`entry:audit failed for ${result.failures}/${result.reports.length} entries`);
    }
    console.log(`entry:audit passed (${result.reports.length} runtime checks, inventory=${rows.length}).`);
    return;
  }

  if (subcommand === 'link') {
    const {
      canonicalEntryHrefFromId,
      checkCatalogManifestRowLinkage,
      normalizeEntryHref,
      slugFromEntryHref,
    } = await import('./lib/entry-catalog-linkage.mjs');
    const {
      defaultCatalogEditorialData,
      findCatalogManifestEntry,
      readCatalogEditorialFile,
      upsertCatalogManifestEntry,
      writeCatalogEditorialFile,
    } = await import('./lib/catalog-editorial-store.mjs');

    const entryToken = String(flags.get('--entry') || flags.get('--slug') || values[0] || '').trim();
    const catalogToken = String(flags.get('--catalog') || flags.get('--from-catalog') || entryToken).trim();
    if (!entryToken && !catalogToken) {
      throw new Error('entry link requires --entry <slug> or --catalog <id|href|slug>');
    }

    const catalogEntriesFile = path.resolve(flags.get('--catalog-entries-file') || 'data/catalog.entries.json');
    let catalogEntries = [];
    try {
      const source = JSON.parse(await fs.readFile(catalogEntriesFile, 'utf8'));
      catalogEntries = Array.isArray(source?.entries) ? source.entries : [];
    } catch (error) {
      if (String(error?.code || '') !== 'ENOENT') throw error;
    }

    const findCatalogEntry = (token) => {
      const needle = String(token || '').trim().toLowerCase();
      if (!needle) return null;
      return catalogEntries.find((entry) => {
        const id = String(entry?.id || '').trim().toLowerCase();
        const href = String(normalizeEntryHref(entry?.entry_href || '') || '').toLowerCase();
        const slug = String(slugFromEntryHref(entry?.entry_href || '') || '').toLowerCase();
        return id === needle || href === String(normalizeEntryHref(needle)).toLowerCase() || slug === needle;
      }) || null;
    };

    const fromCatalog = findCatalogEntry(catalogToken) || findCatalogEntry(entryToken);
    const derivedEntryId = String(entryToken || fromCatalog?.id || slugFromEntryHref(fromCatalog?.entry_href || '')).trim();
    if (!derivedEntryId) throw new Error('Unable to resolve entry id for linkage.');
    const canonicalHref = normalizeEntryHref(flags.get('--entry-href') || fromCatalog?.entry_href || canonicalEntryHrefFromId(derivedEntryId));

    const catalogFilePath = flags.get('--catalog-file');
    let editorialData;
    let resolvedCatalogFilePath;
    try {
      const loaded = await readCatalogEditorialFile(catalogFilePath);
      editorialData = loaded.data;
      resolvedCatalogFilePath = loaded.filePath;
    } catch (error) {
      if (String(error?.code || '') === 'ENOENT' || String(error?.message || '').includes('ENOENT')) {
        editorialData = defaultCatalogEditorialData();
        resolvedCatalogFilePath = path.resolve(catalogFilePath || 'data/catalog.editorial.json');
      } else {
        throw error;
      }
    }

    const existing = findCatalogManifestEntry(editorialData, derivedEntryId)
      || findCatalogManifestEntry(editorialData, canonicalHref);

    const presence = await checkCatalogManifestRowLinkage({
      entry_id: derivedEntryId,
      entry_href: canonicalHref,
      status: 'active',
    }, { rootDir: process.cwd() });
    const entryPageExists = Array.isArray(presence.existingPaths) && presence.existingPaths.length > 0;

    const explicitStatus = String(flags.get('--status') || '').trim().toLowerCase();
    const status = explicitStatus
      || String(existing?.status || '').trim()
      || (entryPageExists ? 'active' : 'draft');

    const patch = {
      entry_id: derivedEntryId,
      entry_href: canonicalHref,
      title_raw: String(flags.get('--title') || existing?.title_raw || fromCatalog?.title_raw || '').trim(),
      lookup_number: String(flags.get('--lookup') || existing?.lookup_number || fromCatalog?.lookup_raw || '').trim(),
      season: String(flags.get('--season') || existing?.season || fromCatalog?.season || '').trim(),
      performer: String(flags.get('--performer') || existing?.performer || fromCatalog?.performer_raw || '').trim(),
      instrument: String(
        flags.get('--instrument')
        || existing?.instrument
        || ((Array.isArray(fromCatalog?.instrument_labels) && fromCatalog.instrument_labels[0]) || '')
        || '',
      ).trim(),
      status: status || 'draft',
    };

    if (!String(patch.lookup_number || '').trim() && !fromCatalog && !existing) {
      throw new Error('entry link requires --catalog <id|href|slug> or explicit --lookup metadata when no staged row exists.');
    }

    const checked = await checkCatalogManifestRowLinkage(patch, {
      rootDir: process.cwd(),
      requireEntryExistsForStatuses: new Set(['active']),
    });
    if (!checked.ok) {
      throw new Error(`entry link invalid: ${checked.issues.join('; ')}`);
    }

    const dryRun = parseBooleanFlag(flags.get('--dry-run')) || flags.has('--dry-run');
    if (dryRun) {
      console.log(`entry:link dry-run ${patch.entry_id}`);
      console.log(`  href=${patch.entry_href}`);
      console.log(`  lookup=${patch.lookup_number || '-'}`);
      console.log(`  season=${patch.season || '-'}`);
      console.log(`  performer=${patch.performer || '-'}`);
      console.log(`  instrument=${patch.instrument || '-'}`);
      console.log(`  status=${patch.status || '-'}`);
      console.log(`  entryPageExists=${entryPageExists ? 'yes' : 'no'}`);
      return;
    }

    const next = upsertCatalogManifestEntry(editorialData, patch);
    const written = await writeCatalogEditorialFile(next, resolvedCatalogFilePath);
    const linked = findCatalogManifestEntry(written.data, derivedEntryId) || patch;
    console.log(`entry:link wrote ${linked.entry_id} -> ${resolvedCatalogFilePath}`);
    console.log(`  href=${linked.entry_href}`);
    console.log(`  lookup=${linked.lookup_number || '-'}`);
    console.log(`  season=${linked.season || '-'}`);
    console.log(`  performer=${linked.performer || '-'}`);
    console.log(`  instrument=${linked.instrument || '-'}`);
    console.log(`  status=${linked.status || '-'}`);
    console.log(`  entryPageExists=${entryPageExists ? 'yes' : 'no'}`);
    return;
  }

  throw new Error(`Unknown entry command: ${subcommand}`);
}

function parseCsvRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

async function parseCsvFile(filePath) {
  const source = await fs.readFile(path.resolve(filePath), 'utf8');
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvRow(lines[0]).map((value) => value.toLowerCase());
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvRow(lines[index]);
    const row = {};
    for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      const key = headers[headerIndex];
      if (!key) continue;
      row[key] = values[headerIndex] || '';
    }
    rows.push(row);
  }
  return rows;
}

function parseJsonFlag(raw) {
  const source = String(raw || '').trim();
  if (!source) return {};
  return JSON.parse(source);
}

async function resolveNewsletterVars(flags) {
  const varsInline = flags.get('--vars');
  const varsFile = flags.get('--vars-file');
  if (varsFile) {
    const source = await fs.readFile(path.resolve(varsFile), 'utf8');
    return parseJsonFlag(source);
  }
  if (varsInline) return parseJsonFlag(varsInline);
  return {};
}

function openLocalFile(targetPath) {
  const absolute = path.resolve(targetPath);
  const command = process.platform === 'darwin'
    ? { cmd: 'open', args: [absolute] }
    : process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '', absolute] }
      : { cmd: 'xdg-open', args: [absolute] };
  spawn(command.cmd, command.args, { stdio: 'ignore', detached: true }).unref();
}

function printNewsletterUsage() {
  console.log('Usage: dex newsletter <templates|preview|draft|test-send|schedule|send|stats|segment-estimate|import> [args]');
  console.log('Examples:');
  console.log('  dex newsletter draft create --template release-notes --vars \'{"headline":"Dex Notes #042"}\'');
  console.log('  dex newsletter preview --template newsletter --vars-file ./vars.json');
  console.log('  dex newsletter test-send <campaignId> --to you@example.com');
}

async function runNewsletterCommand(rest = []) {
  const {
    createNewsletterCampaign,
    estimateNewsletterSegment,
    getNewsletterCampaignStats,
    importNewsletterSubscribers,
    listNewsletterCampaigns,
    patchNewsletterCampaign,
    scheduleNewsletterCampaign,
    sendNowNewsletterCampaign,
    testSendNewsletterCampaign,
  } = await import('./lib/newsletter-api.mjs');
  const {
    describeNewsletterTemplates,
    renderNewsletterTemplate,
  } = await import('./lib/newsletter-render.mjs');

  if (!rest.length) {
    if (process.stdout.isTTY && process.stdin.isTTY) {
      const { runDashboard } = await import('./ui/dashboard.mjs');
      await runDashboard(dashboardContext({
        initialMode: 'newsletter',
        version: JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'dev',
      }));
      return;
    }
    printNewsletterUsage();
    return;
  }

  const parsed = parsePollsCommandArgs(rest);
  const { subcommand, flags, values } = parsed;

  if (subcommand === 'templates') {
    console.log(describeNewsletterTemplates());
    return;
  }

  if (subcommand === 'preview') {
    const templateKey = flags.get('--template') || 'newsletter';
    const variables = await resolveNewsletterVars(flags);
    const rendered = renderNewsletterTemplate({ templateKey, variables });
    const outPath = path.resolve(flags.get('--out') || path.join(PROJECT_ROOT, 'tmp', `newsletter-preview-${Date.now()}.html`));
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, rendered.html, 'utf8');
    if (String(flags.get('--open') || 'true').toLowerCase() !== 'false') {
      openLocalFile(outPath);
    }
    console.log(`newsletter:preview wrote ${outPath}`);
    return;
  }

  if (subcommand === 'draft') {
    const action = (values[0] || 'list').toLowerCase();

    if (action === 'list') {
      const payload = await listNewsletterCampaigns({ limit: Number(flags.get('--limit') || 50) });
      const campaigns = Array.isArray(payload?.campaigns) ? payload.campaigns : [];
      campaigns.forEach((campaign) => {
        console.log(`${campaign.id}  [${campaign.status}]  ${campaign.audienceSegment}  ${campaign.subject}`);
      });
      if (!campaigns.length) console.log('No newsletter campaigns found.');
      return;
    }

    if (action === 'create') {
      const templateKey = flags.get('--template') || 'newsletter';
      const variables = await resolveNewsletterVars(flags);
      const rendered = renderNewsletterTemplate({ templateKey, variables });
      const name = flags.get('--name') || `Dex Newsletter ${new Date().toISOString().slice(0, 10)}`;
      const audienceSegment = flags.get('--segment') || 'all_subscribers';
      const payload = await createNewsletterCampaign({
        name,
        templateKey: rendered.templateKey,
        subject: flags.get('--subject') || rendered.subject,
        preheader: flags.get('--preheader') || rendered.preheader,
        audienceSegment,
        variables: rendered.variables,
        html: rendered.html,
        text: rendered.text,
      });
      const campaign = payload?.campaign;
      console.log(`newsletter:draft:create wrote ${campaign?.id || 'unknown'}`);
      return;
    }

    if (action === 'edit') {
      const campaignId = values[1] || flags.get('--id');
      if (!campaignId) throw new Error('newsletter:draft:edit requires campaign id');

      const patch = {};
      if (flags.has('--name')) patch.name = flags.get('--name');
      if (flags.has('--subject')) patch.subject = flags.get('--subject');
      if (flags.has('--preheader')) patch.preheader = flags.get('--preheader');
      if (flags.has('--segment')) patch.audienceSegment = flags.get('--segment');

      if (flags.has('--template') || flags.has('--vars') || flags.has('--vars-file')) {
        const rendered = renderNewsletterTemplate({
          templateKey: flags.get('--template') || 'newsletter',
          variables: await resolveNewsletterVars(flags),
        });
        patch.templateKey = rendered.templateKey;
        patch.variables = rendered.variables;
        patch.html = rendered.html;
        patch.text = rendered.text;
        if (!patch.subject) patch.subject = rendered.subject;
        if (!patch.preheader) patch.preheader = rendered.preheader;
      }

      const payload = await patchNewsletterCampaign(campaignId, patch);
      console.log(`newsletter:draft:edit wrote ${payload?.campaign?.id || campaignId}`);
      return;
    }

    throw new Error(`Unknown newsletter draft action: ${action}`);
  }

  if (subcommand === 'test-send') {
    const campaignId = values[0] || flags.get('--id');
    if (!campaignId) throw new Error('newsletter:test-send requires campaign id');
    const to = flags.get('--to') || process.env.DEX_NEWSLETTER_TEST_EMAIL;
    if (!to) throw new Error('newsletter:test-send requires --to or DEX_NEWSLETTER_TEST_EMAIL');
    const payload = await testSendNewsletterCampaign(campaignId, to);
    console.log(`newsletter:test-send queued ${campaignId} -> ${to} (${payload?.id || 'ok'})`);
    return;
  }

  if (subcommand === 'schedule') {
    const campaignId = values[0] || flags.get('--id');
    if (!campaignId) throw new Error('newsletter:schedule requires campaign id');
    const at = flags.get('--at') || new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await scheduleNewsletterCampaign(campaignId, at);
    console.log(`newsletter:schedule wrote ${campaignId} at ${at}`);
    return;
  }

  if (subcommand === 'send') {
    const campaignId = values[0] || flags.get('--id');
    if (!campaignId) throw new Error('newsletter:send requires campaign id');
    await sendNowNewsletterCampaign(campaignId);
    console.log(`newsletter:send queued ${campaignId}`);
    return;
  }

  if (subcommand === 'stats') {
    const campaignId = values[0] || flags.get('--id');
    if (!campaignId) throw new Error('newsletter:stats requires campaign id');
    const payload = await getNewsletterCampaignStats(campaignId);
    const stats = payload?.stats || {};
    console.log(`campaign=${campaignId} queued=${stats.queued || 0} sent=${stats.sent || 0} failed=${stats.failed || 0} delivered=${stats.delivered || 0} bounced=${stats.bounced || 0} complaints=${stats.complaints || 0} opens=${stats.opens || 0} clicks=${stats.clicks || 0}`);
    return;
  }

  if (subcommand === 'segment-estimate') {
    const segment = values[0] || flags.get('--segment') || 'all_subscribers';
    const payload = await estimateNewsletterSegment(segment);
    const estimate = payload?.estimate || {};
    console.log(`segment=${estimate.segment || segment} count=${estimate.count || 0}`);
    return;
  }

  if (subcommand === 'import') {
    const csvPath = flags.get('--csv');
    if (!csvPath) throw new Error('newsletter:import requires --csv <path>');
    const source = flags.get('--source') || 'mailchimp';
    const consentMode = flags.get('--consent-mode') || 'verified';
    const rows = await parseCsvFile(csvPath);
    const mapped = rows.map((row) => {
      const tags = [];
      if (String(row.contributor || '').trim().toLowerCase() === 'true') tags.push('contributor');
      if (String(row.status_watcher || '').trim().toLowerCase() === 'true') tags.push('status-watcher');
      if (String(row.tags || '').trim()) {
        String(row.tags).split(/[|,]/).map((value) => value.trim()).filter(Boolean).forEach((tag) => tags.push(tag));
      }
      return {
        email: row.email || row['email address'] || '',
        auth0Sub: row.auth0_sub || row.auth0sub || '',
        timezone: row.timezone || 'UTC',
        tags,
        consentVerified: String(row.consent_verified || '').trim().toLowerCase() === 'true' || consentMode === 'verified',
        consentEvidence: {
          sourceRow: row,
        },
      };
    });
    const payload = await importNewsletterSubscribers({
      source,
      consentMode,
      rows: mapped,
    });
    console.log(`newsletter:import imported=${payload?.imported || 0} skipped=${payload?.skipped || 0}`);
    return;
  }

  printNewsletterUsage();
}

const repoSelection = stripRepoFlag(process.argv);
if (!isSupportedRepoKey(repoSelection.repo)) {
  console.error(`dex: unsupported --repo value "${repoSelection.repo}" (expected site|api)`);
  process.exit(1);
}
const topLevel = parseTopLevelMode(repoSelection.argv);
const packageJson = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const { runDashboard } = await import('./ui/dashboard.mjs');

if (topLevel.mode === 'direct-command' && topLevel.command === 'setup') {
  await runSetupCommand(topLevel.rest, { requestedRepo: repoSelection.repo });
  process.exit(0);
}

const workspace = await ensureWorkspaceConfig({
  requestedRepo: repoSelection.repo,
  interactive: process.stdout.isTTY && process.stdin.isTTY,
  autoSetup: true,
});

if (!workspace.ok) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    DEX_WORKSPACE_CONTEXT = {
      activeRepo: repoSelection.repo,
      activeRoot: process.cwd(),
      configPath: '',
      config: null,
    };
    console.error(`dex: workspace config unavailable, falling back to cwd=${process.cwd()} (${workspace.reason})`);
  } else {
    console.error(`dex: ${workspace.reason}`);
    process.exit(1);
  }
}
if (workspace.ok) {
  const selectedRoot = resolveRepoRoot(workspace.config, repoSelection.repo);
  if (!selectedRoot.root) {
    console.error(`dex: no configured root for repo ${repoSelection.repo}. Run: dex setup --reset`);
    process.exit(1);
  }
  process.chdir(selectedRoot.root);
  DEX_WORKSPACE_CONTEXT = {
    activeRepo: selectedRoot.repo,
    activeRoot: selectedRoot.root,
    configPath: workspace.filePath,
    config: workspace.config,
  };
}

if (topLevel.mode === 'dashboard') {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('dex: interactive dashboard requires a TTY. Try: dex init');
    process.exit(0);
  }
  await runDashboard(dashboardContext({ paletteOpen: topLevel.paletteOpen, version: packageJson.version || 'dev' }));
  process.exit(0);
}

if (topLevel.mode === 'ink-command') {
  if (topLevel.command === 'doctor' && (!process.stdout.isTTY || !process.stdin.isTTY)) {
    const reports = await scanEntries({ entriesDir: './entries' });
    reports.forEach((r) => {
      const status = r.errors.length ? '❌' : r.warnings.length ? '⚠️' : '✅';
      console.log(`${status} ${r.slug}`);
      r.errors.forEach((e) => console.log(`  - ERROR: ${e}`));
      r.warnings.forEach((w) => console.log(`  - WARN: ${w}`));
    });
    process.exit(reports.some((r) => r.errors.length) ? 1 : 0);
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    if (topLevel.command === 'init') {
      const parsed = parseInitArgs(topLevel.rest);
      await initCommand(parsed.slugArg, parsed.opts);
      process.exit(0);
    }
    console.log(`dex ${topLevel.command}: requires a TTY`);
    process.exit(1);
  }
  const mode = topLevel.command === 'init'
    ? 'init'
    : topLevel.command === 'update'
      ? 'update'
      : topLevel.command === 'status'
        ? 'status'
        : 'doctor';
  await runDashboard(dashboardContext({ initialMode: mode, version: packageJson.version || 'dev' }));
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'view') {
  const viewOpts = parseViewerArgs(topLevel.rest);
  const { server, url, port } = await startViewer({
    cwd: process.cwd(),
    open: viewOpts.open,
    port: viewOpts.port,
    root: viewOpts.root,
  });
  console.log(`Dex viewer running at ${url}`);
  if (viewOpts.root) {
    console.log(`Scoped root: ${path.resolve(viewOpts.root)}`);
  } else {
    console.log('Scoped roots: recents + known output directories');
  }
  if (!viewOpts.open) {
    console.log('Tip: pass --open to launch your browser automatically.');
  }
  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.stdin.resume();
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'polls') {
  await runPollsCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'call') {
  await runCallCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'newsletter') {
  await runNewsletterCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'catalog') {
  await runCatalogCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'home') {
  await runHomeCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'notes') {
  await runNotesCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'assets') {
  await runAssetsCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'entry') {
  await runEntryCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'deploy') {
  await runDeployCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'release') {
  await runReleaseCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'direct-command' && topLevel.command === 'links') {
  await runLinksCommand(topLevel.rest);
  process.exit(0);
}

if (topLevel.mode === 'legacy') {
  // Backward compatibility: treat bare slug as init argument in non-dashboard scripts.
  const parsed = parseInitArgs(topLevel.rest);
  await initCommand(parsed.slugArg, parsed.opts);
}
