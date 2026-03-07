import fs from 'node:fs/promises';
import path from 'node:path';
import { deriveCanonicalEntry, descriptionTextFromSeed, extractFormatKeys, injectEntryHtml } from './entry-html.mjs';
import { resolveLifecycleForWrite } from './entry-lifecycle.mjs';
import { ALL_BUCKETS, entrySchema, manifestSchemaForFormats, normalizeManifest } from './entry-schema.mjs';
import { getAssetOrigin } from './asset-origin.mjs';
import { rewriteLocalAssetLinks } from './rewrite-asset-links.mjs';
import { formatSanitizationIssues, sanitizeGeneratedHtml, verifySanitizedHtml } from './sanitize-generated-html.mjs';
import { pushRecent } from './recents-store.mjs';

export async function readEntryFolder(slug, { entriesDir = './entries' } = {}) {
  const folder = path.join(path.resolve(entriesDir), slug);
  const entryPath = path.join(folder, 'entry.json');
  const descPath = path.join(folder, 'description.txt');
  const legacyDescPath = path.join(folder, 'description.html');
  const manifestPath = path.join(folder, 'manifest.json');
  const indexPath = path.join(folder, 'index.html');

  const entry = JSON.parse(await fs.readFile(entryPath, 'utf8'));
  if (entry?.sidebarPageConfig && typeof entry.sidebarPageConfig === 'object') {
    if (!entry.sidebarPageConfig.downloads || typeof entry.sidebarPageConfig.downloads !== 'object') {
      entry.sidebarPageConfig.downloads = {};
    }
    const legacyRecordingIndexPdfRef = String(entry.sidebarPageConfig.recordingIndexPdfRef || '').trim();
    if (legacyRecordingIndexPdfRef && !String(entry.sidebarPageConfig.downloads.recordingIndexPdfRef || '').trim()) {
      entry.sidebarPageConfig.downloads.recordingIndexPdfRef = legacyRecordingIndexPdfRef;
    }
    const legacyRecordingIndexBundleRef = String(entry.sidebarPageConfig.recordingIndexBundleRef || '').trim();
    if (legacyRecordingIndexBundleRef && !String(entry.sidebarPageConfig.downloads.recordingIndexBundleRef || '').trim()) {
      entry.sidebarPageConfig.downloads.recordingIndexBundleRef = legacyRecordingIndexBundleRef;
    }
    const legacyRecordingIndexSourceUrl = String(entry.sidebarPageConfig.recordingIndexSourceUrl || '').trim();
    if (legacyRecordingIndexSourceUrl && !String(entry.sidebarPageConfig.downloads.recordingIndexSourceUrl || '').trim()) {
      entry.sidebarPageConfig.downloads.recordingIndexSourceUrl = legacyRecordingIndexSourceUrl;
    }
    if ('recordingIndexPdfRef' in entry.sidebarPageConfig) {
      delete entry.sidebarPageConfig.recordingIndexPdfRef;
    }
    if ('recordingIndexBundleRef' in entry.sidebarPageConfig) {
      delete entry.sidebarPageConfig.recordingIndexBundleRef;
    }
    if ('recordingIndexSourceUrl' in entry.sidebarPageConfig) {
      delete entry.sidebarPageConfig.recordingIndexSourceUrl;
    }
  }
  let descriptionText = '';
  try {
    descriptionText = await fs.readFile(descPath, 'utf8');
  } catch {
    try {
      descriptionText = descriptionTextFromSeed(entry);
      if (!descriptionText) descriptionText = await fs.readFile(legacyDescPath, 'utf8');
    } catch {
      descriptionText = descriptionTextFromSeed(entry);
    }
  }

  let manifest = { audio: {}, video: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {}

  let indexHtml = '';
  try { indexHtml = await fs.readFile(indexPath, 'utf8'); } catch {}

  return { slug, folder, paths: { entryPath, descPath, legacyDescPath, manifestPath, indexPath }, entry, descriptionText: String(descriptionText || '').trim(), manifest, indexHtml };
}

export async function writeEntryFolder(slug, data, { entriesDir = './entries' } = {}) {
  const folder = path.join(path.resolve(entriesDir), slug);
  await fs.mkdir(folder, { recursive: true });
  const wroteFiles = [];
  const lifecycle = data.entry
    ? await resolveLifecycleForWrite({
      existingLifecycle: data.entry.lifecycle,
      entryFolder: folder,
      now: Date.now(),
    })
    : null;
  const entryToWrite = data.entry
    ? {
      ...data.entry,
      canonical: deriveCanonicalEntry({
        canonical: data.entry.canonical,
        sidebarConfig: data.entry.sidebarPageConfig,
        creditsData: data.entry.creditsData,
      }),
      lifecycle,
    }
    : null;

  if (entryToWrite) {
    if (!entryToWrite.sidebarPageConfig.downloads || typeof entryToWrite.sidebarPageConfig.downloads !== 'object') {
      entryToWrite.sidebarPageConfig.downloads = {};
    }
    const legacyRecordingIndexPdfRef = String(entryToWrite.sidebarPageConfig.recordingIndexPdfRef || '').trim();
    if (legacyRecordingIndexPdfRef && !String(entryToWrite.sidebarPageConfig.downloads.recordingIndexPdfRef || '').trim()) {
      entryToWrite.sidebarPageConfig.downloads.recordingIndexPdfRef = legacyRecordingIndexPdfRef;
    }
    const legacyRecordingIndexBundleRef = String(entryToWrite.sidebarPageConfig.recordingIndexBundleRef || '').trim();
    if (legacyRecordingIndexBundleRef && !String(entryToWrite.sidebarPageConfig.downloads.recordingIndexBundleRef || '').trim()) {
      entryToWrite.sidebarPageConfig.downloads.recordingIndexBundleRef = legacyRecordingIndexBundleRef;
    }
    const legacyRecordingIndexSourceUrl = String(entryToWrite.sidebarPageConfig.recordingIndexSourceUrl || '').trim();
    if (legacyRecordingIndexSourceUrl && !String(entryToWrite.sidebarPageConfig.downloads.recordingIndexSourceUrl || '').trim()) {
      entryToWrite.sidebarPageConfig.downloads.recordingIndexSourceUrl = legacyRecordingIndexSourceUrl;
    }
    if ('recordingIndexPdfRef' in entryToWrite.sidebarPageConfig) {
      delete entryToWrite.sidebarPageConfig.recordingIndexPdfRef;
    }
    if ('recordingIndexBundleRef' in entryToWrite.sidebarPageConfig) {
      delete entryToWrite.sidebarPageConfig.recordingIndexBundleRef;
    }
    if ('recordingIndexSourceUrl' in entryToWrite.sidebarPageConfig) {
      delete entryToWrite.sidebarPageConfig.recordingIndexSourceUrl;
    }
    const file = path.join(folder, 'entry.json');
    await fs.writeFile(file, `${JSON.stringify(entryToWrite, null, 2)}
`, 'utf8');
    wroteFiles.push(file);
  }
  if (typeof data.descriptionText === 'string') {
    const file = path.join(folder, 'description.txt');
    await fs.writeFile(file, `${data.descriptionText.trim()}
`, 'utf8');
    wroteFiles.push(file);
  }
  if (data.manifest) {
    const file = path.join(folder, 'manifest.json');
    await fs.writeFile(file, `${JSON.stringify(data.manifest, null, 2)}
`, 'utf8');
    wroteFiles.push(file);
  }
  if (typeof data.indexHtml === 'string') {
    const file = path.join(folder, 'index.html');
    const sanitizedHtml = sanitizeGeneratedHtml(data.indexHtml);
    const sanitizedCheck = verifySanitizedHtml(sanitizedHtml);
    if (!sanitizedCheck.ok) {
      throw new Error(`Refusing to write unsanitized index.html for ${slug}: ${formatSanitizationIssues(sanitizedCheck.issues)}`);
    }
    await fs.writeFile(file, sanitizedHtml, 'utf8');
    try {
      await pushRecent(file, {
        displayName: entryToWrite?.title || slug,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.warn(`[dex] failed to update recent files: ${error?.message || error}`);
    }
    wroteFiles.push(file);
  }

  return { wroteFiles };
}

export function normalizeManifestWithFormats(manifest, formatKeys) {
  return normalizeManifest(manifest, formatKeys, ALL_BUCKETS);
}

export function validateEntryFolderData({ entry, manifest, formatKeys }) {
  entrySchema.parse(entry);
  manifestSchemaForFormats(formatKeys.audio || [], formatKeys.video || []).parse(manifest);
}

export function generateIndexHtml({ templateHtml, entry, descriptionText, manifest, lifecycle }) {
  const canonical = deriveCanonicalEntry({
    canonical: entry?.canonical,
    sidebarConfig: entry?.sidebarPageConfig,
    creditsData: entry?.creditsData,
  });
  const injected = injectEntryHtml(templateHtml, {
    descriptionText,
    descriptionHtml: entry.descriptionHtml,
    manifest,
    sidebarConfig: entry.sidebarPageConfig,
    creditsData: entry.creditsData,
    canonical,
    lifecycle: lifecycle || entry?.lifecycle,
    video: entry.video,
    title: entry.title,
    authEnabled: true,
  }).html;
  const rewrittenHtml = rewriteLocalAssetLinks(injected, getAssetOrigin());
  const sanitizedHtml = sanitizeGeneratedHtml(rewrittenHtml);
  const sanitizedCheck = verifySanitizedHtml(sanitizedHtml);
  if (!sanitizedCheck.ok) {
    throw new Error(`Generated HTML failed sanitizer verification: ${formatSanitizationIssues(sanitizedCheck.issues)}`);
  }
  return sanitizedHtml;
}

export function diffSummary(oldHtml, newHtml) {
  if (oldHtml === newHtml) return 'No changes';
  return `Changed bytes: ${Math.abs((oldHtml || '').length - (newHtml || '').length)}`;
}

export function formatKeysFromTemplate(templateHtml) {
  return extractFormatKeys(templateHtml);
}
