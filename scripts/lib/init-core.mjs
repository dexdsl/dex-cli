import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveCanonicalEntry, detectTemplateProblems, extractFormatKeys, injectEntryHtml } from './entry-html.mjs';
import { resolveLifecycleForInit } from './entry-lifecycle.mjs';
import { ALL_BUCKETS, entrySchema, formatZodError, manifestSchemaForFormats, normalizeManifest, sidebarConfigSchema } from './entry-schema.mjs';
import { getAssetOrigin } from './asset-origin.mjs';
import { rewriteLocalAssetLinks } from './rewrite-asset-links.mjs';
import { formatSanitizationIssues, sanitizeGeneratedHtml, verifySanitizedHtml } from './sanitize-generated-html.mjs';
import { pushRecent } from './recents-store.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const CANONICAL_ENTRY_TEMPLATE_PATH = path.join(PROJECT_ROOT, 'entries', 'test-5', 'index.html');

const ensure = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

export async function prepareTemplate({ templateArg } = {}) {
  if (templateArg) {
    const templatePath = path.resolve(templateArg);
    if (!(await ensure(templatePath))) throw new Error(`Template not found: ${templatePath}`);
    const templateHtml = await fs.readFile(templatePath, 'utf8');
    const missing = detectTemplateProblems(templateHtml);
    if (missing.length) throw new Error(`Template validation failed (${templatePath}); missing: ${missing.join(', ')}`);
    return { templatePath, templateHtml, formatKeys: extractFormatKeys(templateHtml) };
  }

  const candidates = [
    path.resolve(process.cwd(), 'index.html'),
    CANONICAL_ENTRY_TEMPLATE_PATH,
    path.join(PROJECT_ROOT, 'entry-template', 'index.html'),
  ];

  const reports = [];
  for (const candidatePath of candidates) {
    if (!(await ensure(candidatePath))) {
      reports.push(`- ${candidatePath}: not found`);
      continue;
    }

    const templateHtml = await fs.readFile(candidatePath, 'utf8');
    const missing = detectTemplateProblems(templateHtml);
    if (!missing.length) {
      return { templatePath: candidatePath, templateHtml, formatKeys: extractFormatKeys(templateHtml) };
    }
    reports.push(`- ${candidatePath}: invalid (missing: ${missing.join(', ')})`);
  }

  throw new Error(
    `No valid template found.\n` +
    `Tried:\n${reports.join('\n')}\n` +
    `Tip: pass --template <path> to force a specific template.`
  );
}

export async function writeEntryFromData({ templateHtml, templatePath, data, opts = {} }) {
  const missing = detectTemplateProblems(templateHtml);
  if (missing.length) throw new Error(`Template validation failed; missing: ${missing.join(', ')}`);

  const formatKeys = extractFormatKeys(templateHtml);
  const canonical = deriveCanonicalEntry({
    canonical: data.canonical,
    sidebarConfig: data.sidebar,
    creditsData: data.creditsData,
  });
  const lifecycle = resolveLifecycleForInit();

  try {
    sidebarConfigSchema.parse(data.sidebar);
  } catch (error) {
    throw new Error(formatZodError(error, 'Sidebar config (wizard step)'));
  }

  normalizeManifest(data.manifest, formatKeys, ALL_BUCKETS);
  try {
    manifestSchemaForFormats(formatKeys.audio, formatKeys.video).parse(data.manifest);
  } catch (error) {
    throw new Error(formatZodError(error, 'Manifest (wizard step)'));
  }

  try {
    entrySchema.parse({
      slug: data.slug,
      title: data.title,
      canonical,
      lifecycle,
      video: data.video,
      sidebarPageConfig: data.sidebar,
      series: data.series,
      selectedBuckets: data.selectedBuckets,
      creditsData: data.creditsData,
      fileSpecs: data.fileSpecs,
      metadata: data.metadata,
    });
  } catch (error) {
    throw new Error(formatZodError(error, 'Entry data'));
  }

  const resolvedDescriptionText = typeof data.descriptionText === 'string'
    ? data.descriptionText
    : '';

  const injected = injectEntryHtml(templateHtml, {
    descriptionText: data.descriptionText,
    descriptionHtml: data.descriptionHtml,
    manifest: data.manifest,
    sidebarConfig: data.sidebar,
    creditsData: data.creditsData,
    canonical,
    lifecycle,
    video: data.video,
    title: data.title,
    authEnabled: true,
  });
  const usingCanonicalTemplate = path.resolve(templatePath || '') === path.resolve(CANONICAL_ENTRY_TEMPLATE_PATH);
  let finalHtml = injected.html;
  if (!usingCanonicalTemplate) {
    const rewrittenHtml = rewriteLocalAssetLinks(injected.html, getAssetOrigin());
    finalHtml = sanitizeGeneratedHtml(rewrittenHtml);
    const sanitizedCheck = verifySanitizedHtml(finalHtml);
    if (!sanitizedCheck.ok) {
      throw new Error(`Generated HTML failed sanitizer verification: ${formatSanitizationIssues(sanitizedCheck.issues)}`);
    }
  }

  const folder = opts.flat ? path.join(path.resolve('.'), data.slug) : path.join(data.outDir, data.slug);
  const files = {
    html: path.join(folder, 'index.html'),
    entry: path.join(folder, 'entry.json'),
    desc: path.join(folder, 'description.txt'),
    manifest: path.join(folder, 'manifest.json'),
  };

  const report = {
    slug: data.slug,
    folder,
    htmlPath: files.html,
    templatePath,
    injectionStrategy: injected.strategy,
    timestamp: new Date().toISOString(),
  };

  const lines = [
    `${opts.dryRun ? '• [dry-run] would write' : '✓ Wrote'} ${files.html}`,
    `${opts.dryRun ? '• [dry-run] would write' : '✓ Wrote'} ${files.entry}`,
    `${opts.dryRun ? '• [dry-run] would write' : '✓ Wrote'} ${files.desc}`,
    `${opts.dryRun ? '• [dry-run] would write' : '✓ Wrote'} ${files.manifest}`,
    `Slug: ${data.slug}`,
    `Template: ${templatePath}`,
  ];

  if (!opts.dryRun) {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(files.html, finalHtml, 'utf8');
    await fs.writeFile(files.entry, `${JSON.stringify({
      slug: data.slug,
      title: data.title,
      canonical,
      lifecycle,
      video: {
        mode: data.video?.mode === 'embed' ? 'embed' : 'url',
        dataUrl: String(data.video?.dataUrl || ''),
        dataUrlOriginal: String(data.video?.dataUrlOriginal || data.video?.dataUrl || ''),
        dataHtml: String(data.video?.dataHtml || ''),
      },
      descriptionText: data.descriptionText || '',
      series: data.series || 'dex',
      selectedBuckets: data.selectedBuckets || data.sidebar?.buckets || [],
      creditsData: data.creditsData,
      fileSpecs: data.fileSpecs || data.sidebar?.fileSpecs,
      metadata: data.metadata || data.sidebar?.metadata,
      sidebarPageConfig: data.sidebar,
    }, null, 2)}\n`, 'utf8');
    await fs.writeFile(files.desc, `${resolvedDescriptionText.trim()}\n`, 'utf8');
    await fs.writeFile(files.manifest, `${JSON.stringify(data.manifest, null, 2)}\n`, 'utf8');

    try {
      await pushRecent(files.html, {
        displayName: data.title || data.slug,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.warn(`[dex] failed to update recent files: ${error?.message || error}`);
    }

    if (opts.open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', files.html] : [files.html];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    }
  }

  return { report, lines };
}

export function buildEmptyManifestSkeleton(formatKeys) {
  const audioKeys = Array.isArray(formatKeys?.audio) ? formatKeys.audio : [];
  const videoKeys = Array.isArray(formatKeys?.video) ? formatKeys.video : [];
  const manifest = { audio: {}, video: {} };

  for (const bucket of ALL_BUCKETS) {
    manifest.audio[bucket] = Object.fromEntries(audioKeys.map((key) => [key, '']));
    manifest.video[bucket] = Object.fromEntries(videoKeys.map((key) => [key, '']));
  }

  return manifest;
}
