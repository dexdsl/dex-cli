import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_TRIO } from './entry-html.mjs';
import { resolveLifecycleForWrite } from './entry-lifecycle.mjs';
import { prepareTemplate } from './init-core.mjs';
import { loadTagsCatalog } from './tags.mjs';
import { readEntryFolder, writeEntryFolder, generateIndexHtml, normalizeManifestWithFormats, validateEntryFolderData, formatKeysFromTemplate } from './entry-store.mjs';
import { formatSanitizationIssues, verifySanitizedHtml } from './sanitize-generated-html.mjs';

const BUCKETS = ['A', 'B', 'C', 'D', 'E', 'X'];
const esc = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AUTH_CONFIG_CANDIDATES = ['/assets/dex-auth0-config.js', '/assets/dex-auth-config.js'];

function looksBadDriveId(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  return s.includes('/') || s.startsWith('http://') || s.startsWith('https://');
}

function hasScriptSrc(html, src) {
  return new RegExp(`src=["'](?:https?:\\/\\/[^"']+)?${esc(src)}["']`).test(String(html || ''));
}

function hasAuthTrio(html) {
  const required = AUTH_TRIO.filter((src) => !AUTH_CONFIG_CANDIDATES.includes(src));
  if (!required.every((src) => hasScriptSrc(html, src))) return false;
  return AUTH_CONFIG_CANDIDATES.some((src) => hasScriptSrc(html, src));
}

function hasLegacyAuth(html) {
  return html.includes('<!-- Auth0 -->') || html.includes('id="btn-login"') || html.includes('id="btn-profile-container"');
}

export async function scanEntries({ entriesDir = './entries', templateArg } = {}) {
  const template = await prepareTemplate({ templateArg });
  const formatKeys = formatKeysFromTemplate(template.templateHtml);
  const tagsCatalog = await loadTagsCatalog();
  const dir = path.resolve(entriesDir);
  const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const slugs = list.filter((d) => d.isDirectory()).map((d) => d.name).sort();

  const reports = [];
  for (const slug of slugs) {
    const checks = [];
    const warnings = [];
    const errors = [];
    const folder = path.join(dir, slug);
    const entryPath = path.join(folder, 'entry.json');
    const manifestPath = path.join(folder, 'manifest.json');
    const descPath = path.join(folder, 'description.txt');
    const indexPath = path.join(folder, 'index.html');

    const exists = async (p) => fs.access(p).then(() => true).catch(() => false);
    const hasEntry = await exists(entryPath);
    const hasManifest = await exists(manifestPath);
    const hasDesc = await exists(descPath);
    const hasIndex = await exists(indexPath);

    if (!hasEntry) errors.push('entry.json missing');
    if (!hasManifest) warnings.push('manifest.json missing (repair can create skeleton)');
    if (!hasDesc) warnings.push('description.txt missing (repair can migrate)');
    if (!hasIndex) warnings.push('index.html missing (repair can regenerate)');

    let payload = null;
    if (hasEntry) {
      try {
        payload = await readEntryFolder(slug, { entriesDir });
        validateEntryFolderData({ entry: payload.entry, manifest: normalizeManifestWithFormats(payload.manifest, formatKeys), formatKeys });
        checks.push('entry and manifest schema valid');
      } catch (error) {
        errors.push(`schema/parse invalid: ${error.message}`);
      }
    }

    if (payload) {
      const normalized = normalizeManifestWithFormats(payload.manifest, formatKeys);
      const before = JSON.stringify(payload.manifest);
      const after = JSON.stringify(normalized);
      if (before != after) warnings.push('manifest normalization drift detected');

      const expected = generateIndexHtml({ templateHtml: template.templateHtml, entry: payload.entry, descriptionText: payload.descriptionText, manifest: normalized });
      if ((payload.indexHtml || '') !== expected) warnings.push('STALE HTML: index.html differs from deterministic regeneration');
      if (payload.indexHtml && !hasAuthTrio(payload.indexHtml)) warnings.push('auth trio missing from index.html');
      if (payload.indexHtml && hasLegacyAuth(payload.indexHtml)) warnings.push('legacy Auth0 blocks still present');

      const selectedBuckets = payload.entry.selectedBuckets || payload.entry.sidebarPageConfig?.buckets || BUCKETS;
      for (const bucket of selectedBuckets) {
        const audio = Object.values(normalized.audio?.[bucket] || {});
        const video = Object.values(normalized.video?.[bucket] || {});
        if (![...audio, ...video].some((v) => String(v || '').trim())) warnings.push(`bucket ${bucket} has no populated download ids`);
      }

      for (const [kind, byBucket] of Object.entries({ audio: normalized.audio || {}, video: normalized.video || {} })) {
        for (const [bucket, kv] of Object.entries(byBucket)) {
          for (const [fmt, id] of Object.entries(kv || {})) {
            if (looksBadDriveId(id)) warnings.push(`${kind}.${bucket}.${fmt} looks like URL/path, expected plain drive id`);
          }
        }
      }

      const tags = payload.entry.metadata?.tags || payload.entry.sidebarPageConfig?.metadata?.tags || [];
      const unknown = tags.filter((tag) => !tagsCatalog.includes(tag));
      if (unknown.length) warnings.push(`unknown tags: ${unknown.join(', ')}`);
      if (!payload.entry.metadata?.sampleLength && !payload.entry.sidebarPageConfig?.metadata?.sampleLength) warnings.push('metadata.sampleLength missing');
    }

    checks.push(...warnings.map((w) => `⚠ ${w}`), ...errors.map((e) => `❌ ${e}`));
    reports.push({ slug, warnings, errors, checks, ok: errors.length === 0 });
  }

  return reports;
}

export async function repairEntry({ slug, entriesDir = './entries', templateArg, normalizeManifest = true, migrateDescription = true } = {}) {
  const template = await prepareTemplate({ templateArg });
  const formatKeys = formatKeysFromTemplate(template.templateHtml);
  const payload = await readEntryFolder(slug, { entriesDir });
  const manifest = normalizeManifestWithFormats(payload.manifest, formatKeys);
  const descriptionText = String(payload.descriptionText || payload.entry.descriptionText || '').trim();
  const lifecycle = await resolveLifecycleForWrite({
    existingLifecycle: payload.entry.lifecycle,
    entryFolder: payload.folder,
    now: Date.now(),
  });
  const nextEntry = { ...payload.entry, descriptionText, lifecycle };
  const indexHtml = generateIndexHtml({ templateHtml: template.templateHtml, entry: nextEntry, descriptionText, manifest, lifecycle });
  const sanitizedCheck = verifySanitizedHtml(indexHtml);
  if (!sanitizedCheck.ok) {
    throw new Error(`Repair aborted; regenerated HTML failed sanitizer verification: ${formatSanitizationIssues(sanitizedCheck.issues)}`);
  }

  const data = { indexHtml };
  if (normalizeManifest) data.manifest = manifest;
  if (migrateDescription) data.descriptionText = descriptionText;
  data.entry = nextEntry;

  return writeEntryFolder(slug, data, { entriesDir });
}
