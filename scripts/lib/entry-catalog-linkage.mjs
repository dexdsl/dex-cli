import fs from 'node:fs/promises';
import path from 'node:path';

function toText(value) {
  return String(value || '').trim();
}

export function normalizeEntryHref(value) {
  const raw = toText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.pathname.startsWith('/entry/')) {
        return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
      }
      return raw;
    } catch {
      return raw;
    }
  }
  if (raw.startsWith('/entry/')) return raw.endsWith('/') ? raw : `${raw}/`;
  return raw;
}

export function slugFromEntryHref(value) {
  const href = normalizeEntryHref(value);
  if (!href.startsWith('/entry/')) return '';
  return href.replace(/^\/entry\//, '').replace(/\/$/, '');
}

export function canonicalEntryHrefFromId(entryId) {
  const id = toText(entryId);
  return id ? `/entry/${id}/` : '';
}

export function deriveEntryIdFromCatalogRow(row = {}) {
  const entryId = toText(row.entry_id);
  if (entryId) return entryId;
  return slugFromEntryHref(row.entry_href);
}

export function resolveEntryLinkageFromInitData(data = {}, catalogLink = {}) {
  const slug = toText(catalogLink.entryId || data.slug);
  const entryId = slug;
  const entryHref = normalizeEntryHref(catalogLink.entryHref || canonicalEntryHrefFromId(entryId));
  const lookupNumber = toText(catalogLink.lookupNumber || data?.sidebar?.lookupNumber);
  const season = toText(catalogLink.season || data?.creditsData?.season || data?.sidebar?.credits?.season);
  const performer = toText(
    catalogLink.performer
      || (Array.isArray(data?.creditsData?.artist) ? data.creditsData.artist[0] : '')
      || (Array.isArray(data?.sidebar?.credits?.artist) ? data.sidebar.credits.artist[0] : ''),
  );
  const instrument = toText(
    catalogLink.instrument
      || (Array.isArray(data?.creditsData?.instruments) ? data.creditsData.instruments[0] : '')
      || (Array.isArray(data?.sidebar?.credits?.instruments) ? data.sidebar.credits.instruments[0] : ''),
  );
  const status = toText(catalogLink.status || 'draft') || 'draft';
  const titleRaw = toText(catalogLink.titleRaw || data.title);
  return {
    entryId,
    entryHref,
    lookupNumber,
    season,
    performer,
    instrument,
    status,
    titleRaw,
  };
}

export function resolveCatalogManifestPatchFromInitData(data = {}, catalogLink = {}) {
  const linkage = resolveEntryLinkageFromInitData(data, catalogLink);
  return {
    entry_id: linkage.entryId,
    entry_href: linkage.entryHref,
    title_raw: linkage.titleRaw,
    lookup_number: linkage.lookupNumber,
    season: linkage.season,
    performer: linkage.performer,
    instrument: linkage.instrument,
    status: linkage.status,
  };
}

export function resolveEntryCandidatePaths(entryId, {
  rootDir = process.cwd(),
  includeEntries = true,
  includeDocs = true,
} = {}) {
  const id = toText(entryId);
  if (!id) return [];
  const out = [];
  if (includeEntries) out.push(path.resolve(rootDir, 'entries', id, 'index.html'));
  if (includeDocs) out.push(path.resolve(rootDir, 'docs', 'entry', id, 'index.html'));
  return out;
}

export async function checkCatalogManifestRowLinkage(row = {}, options = {}) {
  const status = toText(row.status || 'active') || 'active';
  const entryId = deriveEntryIdFromCatalogRow(row);
  const entryHref = normalizeEntryHref(row.entry_href || canonicalEntryHrefFromId(entryId));
  const issues = [];

  if (!entryId) issues.push('entry_id is required or derivable from entry_href');
  if (!entryHref || !entryHref.startsWith('/entry/')) issues.push('entry_href must be canonical /entry/<slug>/');
  if (entryId && entryHref && slugFromEntryHref(entryHref) && slugFromEntryHref(entryHref) !== entryId) {
    issues.push(`entry_id (${entryId}) does not match entry_href (${entryHref})`);
  }

  const requireEntryExistsForStatuses = options.requireEntryExistsForStatuses || new Set(['active']);
  const shouldRequireExistence = requireEntryExistsForStatuses.has(status);
  const candidatePaths = resolveEntryCandidatePaths(entryId, options);
  const existingPaths = [];
  for (const candidate of candidatePaths) {
    try {
      await fs.access(candidate);
      existingPaths.push(candidate);
    } catch {
      // ignore
    }
  }
  if (shouldRequireExistence && !existingPaths.length) {
    issues.push(`linked entry page missing for ${entryId || '(unknown id)'}`);
  }

  return {
    status,
    entryId,
    entryHref,
    candidatePaths,
    existingPaths,
    issues,
    ok: issues.length === 0,
  };
}

export async function assertCatalogManifestRowLinkage(row = {}, options = {}) {
  const checked = await checkCatalogManifestRowLinkage(row, options);
  if (checked.ok) return checked;
  throw new Error(`Catalog linkage invalid: ${checked.issues.join('; ')}`);
}

export async function assertCatalogManifestLinkageSet(rows = [], options = {}) {
  const failures = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const checked = await checkCatalogManifestRowLinkage(row, options);
    if (!checked.ok) failures.push({ row, checked });
  }
  if (failures.length) {
    const details = failures
      .slice(0, 10)
      .map((failure) => `${toText(failure.row?.entry_id || failure.row?.entry_href || '(unknown)')}: ${failure.checked.issues.join('; ')}`)
      .join(' | ');
    throw new Error(`Catalog linkage failed for ${failures.length} row(s): ${details}`);
  }
  return {
    ok: true,
    count: Array.isArray(rows) ? rows.length : 0,
  };
}
