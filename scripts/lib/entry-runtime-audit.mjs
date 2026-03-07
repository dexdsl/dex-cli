import fs from 'node:fs/promises';
import path from 'node:path';
import {
  checkCatalogManifestRowLinkage,
  deriveEntryIdFromCatalogRow,
  normalizeEntryHref,
  slugFromEntryHref,
} from './entry-catalog-linkage.mjs';
import { isAssetReferenceToken, parseAssetReferenceTokenWithKinds } from './asset-ref.mjs';

const REQUIRED_SCRIPT_IDS = [
  'dex-sidebar-config',
  'dex-sidebar-page-config',
  'dex-manifest',
];

const AUTH_TRIO_PATTERNS = [
  /\/assets\/vendor\/auth0-spa-js\.umd\.min\.js/i,
  /\/assets\/dex-auth0-config\.js|\/assets\/dex-auth-config\.js/i,
  /\/assets\/dex-auth\.js/i,
];

const REQUIRED_RUNTIME_MARKERS = [
  'id="scroll-gradient-bg"',
  'id="gooey-mesh-wrapper"',
  'class="dex-breadcrumb"',
];

const FORBIDDEN_RUNTIME_SCRIPT_HOST_PATTERNS = [
  /https?:\/\/(?:[^"'\s]+\.)?squarespace\.com/i,
  /https?:\/\/(?:[^"'\s]+\.)?squarespace-cdn\.com/i,
  /https?:\/\/(?:[^"'\s]+\.)?sqspcdn\.com/i,
  /https?:\/\/(?:[^"'\s]+\.)?legacysite\.com/i,
];

function toText(value) {
  return String(value || '').trim();
}

function isExecutableInlineScriptType(typeValue) {
  const type = toText(typeValue).toLowerCase();
  if (!type) return true;
  return type === 'text/javascript'
    || type === 'application/javascript'
    || type === 'module'
    || type === 'text/ecmascript'
    || type === 'application/ecmascript';
}

function collectForbiddenRuntimeHostMarkers(text) {
  const source = String(text || '');
  const markers = [];

  const scriptSrcRx = /<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let scriptMatch = null;
  while ((scriptMatch = scriptSrcRx.exec(source)) !== null) {
    const src = toText(scriptMatch[1]);
    if (!src) continue;
    const hit = FORBIDDEN_RUNTIME_SCRIPT_HOST_PATTERNS.find((pattern) => pattern.test(src));
    if (hit) markers.push(String(hit));
  }

  const inlineScriptRx = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let inlineMatch = null;
  while ((inlineMatch = inlineScriptRx.exec(source)) !== null) {
    const attrs = String(inlineMatch[1] || '');
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (!isExecutableInlineScriptType(typeMatch?.[1] || '')) continue;
    const body = String(inlineMatch[2] || '');
    if (!body.trim()) continue;
    const hit = FORBIDDEN_RUNTIME_SCRIPT_HOST_PATTERNS.find((pattern) => pattern.test(body));
    if (hit) markers.push(String(hit));
  }

  return Array.from(new Set(markers));
}

function parseRecordingIndexPdfToken(value) {
  const raw = toText(value);
  if (!raw) {
    return {
      tokenRaw: '',
      parsed: null,
      error: '',
    };
  }
  try {
    const parsed = parseAssetReferenceTokenWithKinds(raw, {
      allowedKinds: ['lookup', 'asset'],
      context: 'recording index pdf token',
    });
    return {
      tokenRaw: raw,
      parsed,
      error: '',
    };
  } catch (error) {
    return {
      tokenRaw: raw,
      parsed: null,
      error: toText(error?.message || error || 'invalid recording index pdf token'),
    };
  }
}

function parseRecordingIndexBundleToken(value) {
  const raw = toText(value);
  if (!raw) {
    return {
      tokenRaw: '',
      parsed: null,
      error: '',
    };
  }
  try {
    const parsed = parseAssetReferenceTokenWithKinds(raw, {
      allowedKinds: ['bundle'],
      context: 'recording index bundle token',
    });
    return {
      tokenRaw: raw,
      parsed,
      error: '',
    };
  } catch (error) {
    return {
      tokenRaw: raw,
      parsed: null,
      error: toText(error?.message || error || 'invalid recording index bundle token'),
    };
  }
}

function parseRecordingIndexSourceUrl(value) {
  const raw = toText(value);
  if (!raw) {
    return {
      urlRaw: '',
      parsed: null,
      error: '',
    };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      urlRaw: raw,
      parsed: null,
      error: 'recording index source URL is invalid',
    };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return {
      urlRaw: raw,
      parsed: null,
      error: 'recording index source URL must use http(s)',
    };
  }
  return {
    urlRaw: raw,
    parsed,
    error: '',
  };
}

function textKey(value) {
  return toText(value).toLowerCase();
}

function lookupKey(value) {
  return toText(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*/g, '.')
    .toLowerCase();
}

function collectStringLeaves(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringLeaves(item, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStringLeaves(item, out));
    return out;
  }
  if (typeof value === 'string') out.push(value);
  return out;
}

function extractJsonScriptById(html, id) {
  const rx = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const match = String(html || '').match(rx);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverEntrySlugs(entriesDir) {
  const absolute = path.resolve(entriesDir);
  const dirents = await fs.readdir(absolute, { withFileTypes: true }).catch(() => []);
  return dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readJsonIfPresent(filePath, fallbackValue) {
  const absolute = path.resolve(filePath);
  if (!(await exists(absolute))) {
    return {
      filePath: absolute,
      data: fallbackValue,
      missing: true,
    };
  }
  const text = await fs.readFile(absolute, 'utf8');
  return {
    filePath: absolute,
    data: JSON.parse(text),
    missing: false,
  };
}

async function readExemptions() {
  const filePath = path.resolve('data', 'entry-runtime-audit.exemptions.json');
  if (!(await exists(filePath))) return { skipSlugs: [], skipPrefixes: [], notes: '' };
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return {
    skipSlugs: Array.isArray(raw.skipSlugs) ? raw.skipSlugs.map((value) => toText(value)).filter(Boolean) : [],
    skipPrefixes: Array.isArray(raw.skipPrefixes) ? raw.skipPrefixes.map((value) => toText(value)).filter(Boolean) : [],
    notes: toText(raw.notes),
  };
}

function isExemptSlug(slug, exemptions) {
  if (!slug) return false;
  if ((exemptions.skipSlugs || []).includes(slug)) return true;
  return (exemptions.skipPrefixes || []).some((prefix) => prefix && slug.startsWith(prefix));
}

function toLookupList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = toText(value);
    if (!normalized) continue;
    const key = lookupKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeCatalogEntryFromSource(entry = {}) {
  const entryId = toText(entry.id) || slugFromEntryHref(entry.entry_href);
  return {
    entryId: toText(entryId),
    entryHref: normalizeEntryHref(entry.entry_href || (entryId ? `/entry/${entryId}/` : '')),
    lookupNumber: toText(entry.lookup_raw),
    season: toText(entry.season),
    performer: toText(entry.performer_raw),
    instrument: toText(
      (Array.isArray(entry.instrument_labels) && entry.instrument_labels[0])
      || (Array.isArray(entry.instrument_family) && entry.instrument_family[0])
      || '',
    ),
    titleRaw: toText(entry.title_raw),
    status: toText(entry.status || 'active') || 'active',
  };
}

function normalizeCatalogEntryFromEditorial(row = {}) {
  const entryId = deriveEntryIdFromCatalogRow(row);
  return {
    entryId: toText(entryId),
    entryHref: normalizeEntryHref(row.entry_href || (entryId ? `/entry/${entryId}/` : '')),
    lookupNumber: toText(row.lookup_number),
    season: toText(row.season),
    performer: toText(row.performer),
    instrument: toText(row.instrument),
    titleRaw: toText(row.title_raw),
    status: toText(row.status || 'active') || 'active',
  };
}

function ensureInventoryRow(rowsById, entryId) {
  const id = toText(entryId);
  if (!id) return null;
  if (!rowsById.has(id)) {
    rowsById.set(id, {
      entryId: id,
      entryHref: normalizeEntryHref(`/entry/${id}/`),
      entryPageExists: false,
      sources: {
        entryPage: false,
        catalogEntries: false,
        catalogEditorial: false,
      },
      catalog: {
        source: '',
        entryId: id,
        entryHref: '',
        lookupNumber: '',
        season: '',
        performer: '',
        instrument: '',
        titleRaw: '',
        status: '',
      },
      lookups: [],
      assets: {
        matchedLookups: [],
        buckets: [],
        fileIds: [],
        files: [],
        lookupFiles: {},
      },
      recordingIndex: {
        pdfTokenRaw: '',
        pdfKind: '',
        pdfValue: '',
        pdfValid: false,
        bundleTokenRaw: '',
        bundleKind: '',
        bundleValue: '',
        bundleValid: false,
        sourceUrlRaw: '',
        sourceUrlValid: false,
        resolved: false,
        resolvedLookup: '',
        resolvedFileId: '',
        pdfLike: false,
        bundleResolved: false,
        resolvedBundleToken: '',
        error: '',
      },
      warnings: [],
      state: 'unlinked',
    });
  }
  return rowsById.get(id);
}

function mergeCatalogIntoRow(row, record, sourceLabel) {
  if (!row || !record) return;
  const nextSource = !row.catalog.source
    ? sourceLabel
    : (row.catalog.source === sourceLabel ? sourceLabel : 'both');
  row.catalog.source = nextSource;
  if (toText(record.entryId)) row.catalog.entryId = toText(record.entryId);
  if (toText(record.entryHref)) row.catalog.entryHref = normalizeEntryHref(record.entryHref);
  if (toText(record.lookupNumber)) row.catalog.lookupNumber = toText(record.lookupNumber);
  if (toText(record.season)) row.catalog.season = toText(record.season);
  if (toText(record.performer)) row.catalog.performer = toText(record.performer);
  if (toText(record.instrument)) row.catalog.instrument = toText(record.instrument);
  if (toText(record.titleRaw)) row.catalog.titleRaw = toText(record.titleRaw);
  if (toText(record.status)) row.catalog.status = toText(record.status);
  if (toText(record.entryHref)) row.entryHref = normalizeEntryHref(record.entryHref);
  row.lookups = toLookupList([...(row.lookups || []), record.lookupNumber]);
}

function parseProtectedAssetLookupRows(rawData = {}) {
  const lookups = Array.isArray(rawData.lookups) ? rawData.lookups : [];
  const map = new Map();
  for (const entry of lookups) {
    const lookupNumber = toText(entry.lookupNumber || entry.lookup_number);
    if (!lookupNumber) continue;
    const files = Array.isArray(entry.files) ? entry.files : [];
    const parseAvailableTypes = (file) => {
      const direct = Array.isArray(file?.availableTypes) ? file.availableTypes : null;
      if (direct) {
        return direct.map((item) => toText(item).toLowerCase()).filter(Boolean);
      }
      const jsonRaw = toText(file?.available_types_json || file?.availableTypesJson);
      if (jsonRaw) {
        try {
          const parsed = JSON.parse(jsonRaw);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => toText(item).toLowerCase()).filter(Boolean);
          }
        } catch {
          return jsonRaw.split(',').map((item) => toText(item).toLowerCase()).filter(Boolean);
        }
      }
      const raw = file?.available_types;
      if (Array.isArray(raw)) return raw.map((item) => toText(item).toLowerCase()).filter(Boolean);
      return [];
    };
    const normalizedFiles = files.map((file) => ({
      lookupNumber,
      bucketNumber: toText(file.bucketNumber || file.bucket_number),
      bucket: toText(file.bucket),
      fileId: toText(file.fileId || file.file_id),
      driveFileId: toText(file.driveFileId || file.drive_file_id),
      r2Key: toText(file.r2Key || file.r2_key),
      mime: toText(file.mime),
      sizeBytes: Number(file.sizeBytes ?? file.size_bytes ?? 0) || 0,
      label: toText(file.label),
      sourceLabel: toText(file.sourceLabel || file.source_label || file.label),
      type: toText(file.type || file.media_type).toLowerCase() || '',
      availableTypes: parseAvailableTypes(file),
      role: toText(file.role || file.file_role).toLowerCase() || 'media',
    }));
    map.set(lookupKey(lookupNumber), {
      lookupNumber,
      files: normalizedFiles,
      recordingIndex: entry.recordingIndex && typeof entry.recordingIndex === 'object'
        ? {
          sheetUrl: toText(entry.recordingIndex.sheetUrl),
          sheetId: toText(entry.recordingIndex.sheetId),
          gid: toText(entry.recordingIndex.gid),
          pdfAssetId: toText(entry.recordingIndex.pdfAssetId),
          bundleAllToken: toText(entry.recordingIndex.bundleAllToken),
          rootFolderUrl: toText(entry.recordingIndex.rootFolderUrl),
          bucketFolderUrls: entry.recordingIndex.bucketFolderUrls && typeof entry.recordingIndex.bucketFolderUrls === 'object'
            ? { ...entry.recordingIndex.bucketFolderUrls }
            : {},
        }
        : null,
    });
  }
  return map;
}

function filterInventoryRows(rows = [], slug) {
  const needle = textKey(slug);
  if (!needle) return rows;
  return rows.filter((row) => {
    const idMatch = textKey(row.entryId) === needle;
    const hrefMatch = textKey(normalizeEntryHref(row.entryHref)) === textKey(normalizeEntryHref(needle));
    const slugMatch = textKey(slugFromEntryHref(row.entryHref)) === needle;
    return idMatch || hrefMatch || slugMatch;
  });
}

function summarizeInventory(rows = []) {
  const counts = {
    total: rows.length,
    linked: 0,
    entryOnly: 0,
    catalogOnly: 0,
    withAssets: 0,
  };
  for (const row of rows) {
    if (row.state === 'linked') counts.linked += 1;
    else if (row.state === 'entry-only') counts.entryOnly += 1;
    else if (row.state === 'catalog-only') counts.catalogOnly += 1;
    if (Array.isArray(row.assets?.files) && row.assets.files.length > 0) counts.withAssets += 1;
  }
  return counts;
}

function bucketCodeFromFile(file = {}) {
  const explicit = toText(file.bucket).toUpperCase();
  if (explicit) return explicit;
  const ref = toText(file.bucketNumber);
  const match = ref.match(/^([A-Z])\./i);
  return match ? match[1].toUpperCase() : '';
}

function isPdfLikeInventoryFile(file = {}) {
  const mime = toText(file.mime).toLowerCase();
  const r2Key = toText(file.r2Key).toLowerCase();
  const label = `${toText(file.label).toLowerCase()} ${toText(file.sourceLabel).toLowerCase()}`;
  return mime.includes('pdf') || r2Key.endsWith('.pdf') || label.includes('recording index pdf');
}

function normalizeInventoryAvailableTypes(file = {}) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(file.availableTypes) ? file.availableTypes : []) {
    const normalized = toText(value).toLowerCase();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isRecordingIndexDocument(file = {}, recordingMeta = null) {
  const role = toText(file.role).toLowerCase();
  if (role === 'recording_index_pdf') return true;
  const pdfAssetId = toText(recordingMeta?.pdfAssetId).toLowerCase();
  if (pdfAssetId && toText(file.fileId).toLowerCase() === pdfAssetId) return true;
  return false;
}

function inferInventoryMediaFamily(file = {}) {
  const explicit = toText(file.type).toLowerCase();
  if (explicit === 'audio' || explicit === 'video' || explicit === 'pdf') return explicit;
  const available = normalizeInventoryAvailableTypes(file);
  if (available.includes('audio') && available.includes('video')) return 'unknown';
  if (available.includes('audio')) return 'audio';
  if (available.includes('video')) return 'video';
  if (available.includes('pdf')) return 'pdf';
  const mime = toText(file.mime).toLowerCase();
  const r2Key = toText(file.r2Key).toLowerCase();
  const label = `${toText(file.label).toLowerCase()} ${toText(file.sourceLabel).toLowerCase()} ${toText(file.fileId).toLowerCase()}`;
  if (mime.startsWith('audio/') || /\.(wav|aif|aiff|mp3|flac|m4a)(\?|$)/.test(r2Key) || /\b(wav|aif|aiff|mp3|flac|m4a|audio|ste|stereo)\b/.test(label)) return 'audio';
  if (mime.startsWith('video/') || /\.(mov|mp4|mxf|mkv)(\?|$)/.test(r2Key) || /(4k|1080|720|prores|h264|h265|video)/.test(label)) return 'video';
  if (mime.includes('pdf') || /\.pdf(\?|$)/.test(r2Key) || /\b(pdf|recording index)\b/.test(label)) return 'pdf';
  return 'unknown';
}

function inferInventorySubtype(file = {}) {
  const r2Key = toText(file.r2Key).toLowerCase();
  const label = `${toText(file.label).toLowerCase()} ${toText(file.sourceLabel).toLowerCase()} ${toText(file.fileId).toLowerCase()}`;
  if (/(^|\W)4k(\W|$)|2160/.test(label) || /2160|4k/.test(r2Key)) return '4k';
  if (/1080/.test(label) || /1080/.test(r2Key)) return '1080p';
  if (/720/.test(label) || /720/.test(r2Key)) return '720p';
  const ext = r2Key.match(/\.([a-z0-9]{2,6})(?:\?|$)/);
  if (ext && ext[1]) return ext[1];
  const mime = toText(file.mime).toLowerCase();
  if (mime.includes('/')) return mime.split('/')[1] || 'unknown';
  return 'unknown';
}

function inventoryFileSupportsType(file = {}, type) {
  const wanted = toText(type).toLowerCase();
  if (!wanted) return false;
  const available = normalizeInventoryAvailableTypes(file);
  if (available.length > 0) return available.includes(wanted);
  return inferInventoryMediaFamily(file) === wanted;
}

function buildInventoryDownloadTree(row = {}) {
  const lookupNumber = toText(row.catalog?.lookupNumber || row.lookups?.[0] || '');
  const lookupFiles = lookupNumber
    ? (row.assets?.lookupFiles?.[lookupNumber] || [])
    : (row.assets?.files || []);
  const files = Array.isArray(lookupFiles) ? lookupFiles : [];
  const normalizedFiles = files.map((file) => ({
    ...file,
    bucketCode: bucketCodeFromFile(file),
    availableTypes: normalizeInventoryAvailableTypes(file),
    mediaFamily: inferInventoryMediaFamily(file),
    mediaSubtype: inferInventorySubtype(file),
    role: toText(file.role).toLowerCase() || 'media',
  }));
  const recordingByLookup = row.assets?.recordingIndexByLookup && typeof row.assets.recordingIndexByLookup === 'object'
    ? row.assets.recordingIndexByLookup
    : {};
  const recordingMeta = lookupNumber ? (recordingByLookup[lookupNumber] || null) : null;
  const rootFolderUrl = toText(recordingMeta?.rootFolderUrl);
  const bucketFolderUrls = recordingMeta?.bucketFolderUrls && typeof recordingMeta.bucketFolderUrls === 'object'
    ? recordingMeta.bucketFolderUrls
    : {};
  const mediaFiles = normalizedFiles.filter((file) => !isRecordingIndexDocument(file, recordingMeta));

  const buckets = [];
  const bucketSeen = new Set();
  for (const file of mediaFiles) {
    const bucket = file.bucketCode;
    if (!bucket || bucketSeen.has(bucket)) continue;
    bucketSeen.add(bucket);
    buckets.push(bucket);
  }
  buckets.sort();

  const criticalIssues = [];
  const warnIssues = [];
  if (!mediaFiles.length) {
    criticalIssues.push('no mapped files');
  }
  if (!rootFolderUrl) {
    criticalIssues.push('missing root folder link (A1)');
  }
  for (const bucket of buckets) {
    const bucketFiles = mediaFiles.filter((file) => file.bucketCode === bucket);
    const requiresFolderLink = bucketFiles.length > 0;
    if (!requiresFolderLink) continue;
    if (!toText(bucketFolderUrls[bucket])) {
      criticalIssues.push(`missing bucket folder link (${bucket === 'X' ? 'F2' : `${bucket}2`})`);
    }
  }
  const unknownMimeCount = mediaFiles.filter((file) => !toText(file.mime)).length;
  if (unknownMimeCount > 0) {
    warnIssues.push(`${unknownMimeCount} file(s) missing mime`);
  }
  const missingDriveIdCount = mediaFiles.filter((file) => !toText(file.driveFileId) && !/\.pdf$/i.test(toText(file.r2Key))).length;
  if (missingDriveIdCount > 0) {
    warnIssues.push(`${missingDriveIdCount} file(s) missing driveFileId`);
  }

  const recordingIndex = row.recordingIndex || {};
  if (!toText(recordingIndex.pdfTokenRaw)) criticalIssues.push('missing recording index pdf token');
  else if (!recordingIndex.pdfValid) criticalIssues.push('invalid recording index pdf token');
  if (!toText(recordingIndex.bundleTokenRaw)) criticalIssues.push('missing recording index bundle token');
  else if (!recordingIndex.bundleValid) criticalIssues.push('invalid recording index bundle token');

  const bundleCoverage = recordingIndex.bundleResolved ? 'ok' : (toText(recordingIndex.bundleTokenRaw) ? 'partial' : 'missing');
  const pdfCoverage = recordingIndex.resolved && recordingIndex.pdfLike ? 'ok' : (toText(recordingIndex.pdfTokenRaw) ? 'partial' : 'missing');
  const associatedTypeCounts = {
    audio: 0,
    video: 0,
    pdf: 0,
    unknown: 0,
  };
  const physicalTypeCounts = {
    audio: 0,
    video: 0,
    pdf: 0,
    unknown: 0,
  };
  const subtypeCounts = new Map();
  const bundleRows = [];
  for (const bucket of buckets) {
    const bucketFiles = mediaFiles.filter((file) => file.bucketCode === bucket);
    const audioPresent = bucketFiles.some((file) => inventoryFileSupportsType(file, 'audio'));
    const videoPresent = bucketFiles.some((file) => inventoryFileSupportsType(file, 'video'));
    const pdfPresent = bucketFiles.some((file) => inventoryFileSupportsType(file, 'pdf'));
    bundleRows.push({
      bucket,
      audio: { present: audioPresent, ok: audioPresent },
      video: { present: videoPresent, ok: videoPresent },
      pdf: { present: pdfPresent, ok: pdfPresent },
    });
  }
  for (const file of normalizedFiles) {
    const physicalFamily = Object.prototype.hasOwnProperty.call(physicalTypeCounts, file.mediaFamily)
      ? file.mediaFamily
      : 'unknown';
    physicalTypeCounts[physicalFamily] += 1;
    if (file.availableTypes.length > 0) {
      let supported = 0;
      for (const mediaType of file.availableTypes) {
        if (!Object.prototype.hasOwnProperty.call(associatedTypeCounts, mediaType)) continue;
        associatedTypeCounts[mediaType] += 1;
        supported += 1;
      }
      if (supported === 0) associatedTypeCounts.unknown += 1;
    } else if (Object.prototype.hasOwnProperty.call(associatedTypeCounts, file.mediaFamily)) {
      associatedTypeCounts[file.mediaFamily] += 1;
    } else {
      associatedTypeCounts.unknown += 1;
    }
    const subtype = file.mediaSubtype || 'unknown';
    subtypeCounts.set(subtype, Number(subtypeCounts.get(subtype) || 0) + 1);
  }
  return {
    lookupNumber,
    rootFolderUrl,
    activeBuckets: buckets,
    fileCount: normalizedFiles.length,
    criticalCount: criticalIssues.length,
    warnCount: warnIssues.length,
    criticalIssues,
    warnIssues,
    bundleCoverage,
    pdfCoverage,
    files: normalizedFiles.map((file) => ({
      bucket: file.bucketCode || '',
      bucketNumber: toText(file.bucketNumber),
      fileId: toText(file.fileId),
      r2Key: toText(file.r2Key),
      mime: toText(file.mime),
      type: file.mediaFamily,
      subtype: file.mediaSubtype,
      role: file.role,
      availableTypes: file.availableTypes.slice(),
    })),
    associatedTypeCounts,
    physicalTypeCounts,
    subtypeCounts: Array.from(subtypeCounts.entries())
      .map(([subtype, count]) => ({ subtype, count }))
      .sort((a, b) => b.count - a.count || a.subtype.localeCompare(b.subtype)),
    bundleRows,
    bucketFolderLinks: buckets.map((bucket) => ({
      bucket,
      url: toText(bucketFolderUrls[bucket]),
      ok: Boolean(toText(bucketFolderUrls[bucket])),
    })),
  };
}

export async function collectEntryCatalogAssetInventory({
  entriesDir = './entries',
  slug,
  catalogEntriesFile = path.resolve('data', 'catalog.entries.json'),
  catalogEditorialFile = path.resolve('data', 'catalog.editorial.json'),
  protectedAssetsFile = path.resolve('data', 'protected.assets.json'),
  discoveredSlugs = [],
} = {}) {
  const rowsById = new Map();

  const baseSlugs = Array.isArray(discoveredSlugs) && discoveredSlugs.length
    ? [...discoveredSlugs]
    : await discoverEntrySlugs(entriesDir);
  for (const discovered of baseSlugs) {
    const row = ensureInventoryRow(rowsById, discovered);
    if (!row) continue;
    row.entryPageExists = true;
    row.sources.entryPage = true;
    row.entryHref = normalizeEntryHref(`/entry/${discovered}/`);
  }

  const catalogEntriesSource = await readJsonIfPresent(catalogEntriesFile, { entries: [] });
  const catalogEntries = Array.isArray(catalogEntriesSource.data?.entries)
    ? catalogEntriesSource.data.entries
    : [];
  for (const entry of catalogEntries) {
    const normalized = normalizeCatalogEntryFromSource(entry);
    if (!normalized.entryId) continue;
    const row = ensureInventoryRow(rowsById, normalized.entryId);
    if (!row) continue;
    row.sources.catalogEntries = true;
    mergeCatalogIntoRow(row, normalized, 'catalog.entries');
  }

  const catalogEditorialSource = await readJsonIfPresent(catalogEditorialFile, { manifest: [] });
  const editorialRows = Array.isArray(catalogEditorialSource.data?.manifest)
    ? catalogEditorialSource.data.manifest
    : [];
  for (const entry of editorialRows) {
    const normalized = normalizeCatalogEntryFromEditorial(entry);
    if (!normalized.entryId) continue;
    const row = ensureInventoryRow(rowsById, normalized.entryId);
    if (!row) continue;
    row.sources.catalogEditorial = true;
    mergeCatalogIntoRow(row, normalized, 'editorial');
  }

  const protectedAssetsSource = await readJsonIfPresent(protectedAssetsFile, { lookups: [] });
  const assetsByLookup = parseProtectedAssetLookupRows(protectedAssetsSource.data || {});

  const rows = filterInventoryRows(
    Array.from(rowsById.values())
      .map((row) => {
        const lookups = toLookupList([...(row.lookups || []), row.catalog.lookupNumber]);
        row.lookups = lookups;
        const matchedLookups = lookups
          .map((lookup) => assetsByLookup.get(lookupKey(lookup)))
          .filter(Boolean);

        const files = [];
        const buckets = [];
        const fileIds = [];
        const lookupFiles = {};
        const recordingIndexByLookup = {};
        const bucketSeen = new Set();
        const fileSeen = new Set();
        for (const lookup of matchedLookups) {
          const lookupKey = toText(lookup.lookupNumber);
          if (lookupKey) lookupFiles[lookupKey] = [];
          if (lookupKey && lookup.recordingIndex) {
            recordingIndexByLookup[lookupKey] = { ...lookup.recordingIndex };
          }
          for (const file of lookup.files || []) {
            files.push({ ...file });
            if (lookupKey) lookupFiles[lookupKey].push({ ...file });
            if (!isRecordingIndexDocument(file, lookup.recordingIndex)) {
              const bucketValue = toText(file.bucketNumber || file.bucket);
              if (bucketValue) {
                const key = textKey(bucketValue);
                if (!bucketSeen.has(key)) {
                  bucketSeen.add(key);
                  buckets.push(bucketValue);
                }
              }
            }
            const fileValue = toText(file.fileId || file.driveFileId);
            if (fileValue) {
              const key = textKey(fileValue);
              if (!fileSeen.has(key)) {
                fileSeen.add(key);
                fileIds.push(fileValue);
              }
            }
          }
        }

        row.assets = {
          matchedLookups: matchedLookups.map((item) => item.lookupNumber),
          buckets,
          fileIds,
          files,
          lookupFiles,
          recordingIndexByLookup,
        };

        const hasCatalog = row.sources.catalogEntries || row.sources.catalogEditorial;
        if (row.entryPageExists && hasCatalog) row.state = 'linked';
        else if (row.entryPageExists && !hasCatalog) row.state = 'entry-only';
        else if (!row.entryPageExists && hasCatalog) row.state = 'catalog-only';
        else row.state = 'unlinked';

        const fromCatalog = toText(row.catalog.lookupNumber);
        const fromLookups = toLookupList(row.lookups);
        if (fromCatalog && fromLookups.length > 1) {
          const mismatch = fromLookups.some((value) => textKey(value) !== textKey(fromCatalog));
          if (mismatch) {
            row.warnings.push(`lookup mismatch across linked sources (${fromLookups.join(', ')})`);
          }
        }

        return row;
      })
      .sort((a, b) => a.entryId.localeCompare(b.entryId)),
    slug,
  );

  return {
    rows,
    counts: summarizeInventory(rows),
    files: {
      catalogEntriesFile: catalogEntriesSource.filePath,
      catalogEditorialFile: catalogEditorialSource.filePath,
      protectedAssetsFile: protectedAssetsSource.filePath,
    },
  };
}

function auditEntryHtml(slug, html, { includeLegacy = false } = {}) {
  const issues = [];
  const text = String(html || '');

  for (const scriptId of REQUIRED_SCRIPT_IDS) {
    if (!new RegExp(`<script[^>]*id=["']${scriptId}["']`, 'i').test(text)) {
      issues.push(`missing script#${scriptId}`);
    }
  }

  for (const pattern of AUTH_TRIO_PATTERNS) {
    if (!pattern.test(text)) issues.push(`missing auth trio marker ${pattern}`);
  }

  for (const marker of REQUIRED_RUNTIME_MARKERS) {
    if (!text.includes(marker)) issues.push(`missing runtime marker ${marker}`);
  }

  const runtimeHostMarkers = collectForbiddenRuntimeHostMarkers(text);
  for (const marker of runtimeHostMarkers) {
    issues.push(`forbidden legacy host marker ${marker}`);
  }

  const manifest = extractJsonScriptById(text, 'dex-manifest');
  if (!manifest) {
    issues.push('missing parseable dex-manifest json payload');
  } else {
    const leaves = collectStringLeaves(manifest);
    for (const value of leaves) {
      const raw = toText(value);
      if (!raw) continue;
      if (!isAssetReferenceToken(raw)) {
        issues.push(`dex-manifest contains unsupported token "${raw}" (expected lookup:/asset:/bundle:)`);
        break;
      }
    }
  }

  const sidebarConfig = extractJsonScriptById(text, 'dex-sidebar-config');
  if (sidebarConfig) {
    const driveBase = toText(sidebarConfig?.downloads?.driveBase);
    if (/^https?:\/\/drive\.google\.com\//i.test(driveBase)) {
      issues.push('sidebar config exposes driveBase URL; expected lookup-only download flow');
    }
  }

  const pageConfig = extractJsonScriptById(text, 'dex-sidebar-page-config');
  const recordingPdfToken = parseRecordingIndexPdfToken(
    pageConfig?.downloads?.recordingIndexPdfRef || pageConfig?.recordingIndexPdfRef || '',
  );
  if (recordingPdfToken.error) {
    issues.push(`invalid recording index pdf token (${recordingPdfToken.error})`);
  }
  const recordingBundleToken = parseRecordingIndexBundleToken(
    pageConfig?.downloads?.recordingIndexBundleRef || pageConfig?.recordingIndexBundleRef || '',
  );
  if (recordingBundleToken.error) {
    issues.push(`invalid recording index bundle token (${recordingBundleToken.error})`);
  }
  const recordingSourceUrl = parseRecordingIndexSourceUrl(
    pageConfig?.downloads?.recordingIndexSourceUrl || pageConfig?.recordingIndexSourceUrl || '',
  );
  if (recordingSourceUrl.error) {
    issues.push(`invalid recording index source URL (${recordingSourceUrl.error})`);
  }

  return {
    slug,
    ok: issues.length === 0,
    skippedLegacy: false,
    issues,
    recordingIndex: {
      pdfTokenRaw: recordingPdfToken.tokenRaw,
      pdfKind: recordingPdfToken.parsed?.kind || '',
      pdfValue: recordingPdfToken.parsed?.value || '',
      pdfValid: Boolean(recordingPdfToken.parsed),
      bundleTokenRaw: recordingBundleToken.tokenRaw,
      bundleKind: recordingBundleToken.parsed?.kind || '',
      bundleValue: recordingBundleToken.parsed?.value || '',
      bundleValid: Boolean(recordingBundleToken.parsed),
      sourceUrlRaw: recordingSourceUrl.urlRaw,
      sourceUrlValid: Boolean(recordingSourceUrl.parsed),
      error: toText(
        recordingPdfToken.error
        || recordingBundleToken.error
        || recordingSourceUrl.error,
      ),
    },
  };
}

export async function auditEntryRuntime({
  entriesDir = './entries',
  slug,
  all = false,
  includeLegacy = false,
  includeRuntime = true,
  includeInventory = true,
  catalogEntriesFile = path.resolve('data', 'catalog.entries.json'),
  catalogEditorialFile = path.resolve('data', 'catalog.editorial.json'),
  protectedAssetsFile = path.resolve('data', 'protected.assets.json'),
} = {}) {
  const discovered = await discoverEntrySlugs(entriesDir);
  const targets = [];
  if (toText(slug)) targets.push(toText(slug));
  if (all || !targets.length) {
    for (const found of discovered) {
      if (!targets.includes(found)) targets.push(found);
    }
  }

  const reports = [];
  if (includeRuntime) {
    const exemptions = await readExemptions();
    for (const targetSlug of targets) {
      if (!includeLegacy && isExemptSlug(targetSlug, exemptions)) {
        reports.push({
          slug: targetSlug,
          ok: true,
          skippedLegacy: true,
          issues: [],
        });
        continue;
      }
      const htmlPath = path.resolve(entriesDir, targetSlug, 'index.html');
      const htmlExists = await exists(htmlPath);
      if (!htmlExists) {
        reports.push({ slug: targetSlug, ok: false, skippedLegacy: false, issues: [`missing ${htmlPath}`] });
        continue;
      }
      const html = await fs.readFile(htmlPath, 'utf8');
      reports.push(auditEntryHtml(targetSlug, html, { includeLegacy }));
    }
  }

  const inventory = includeInventory
    ? await collectEntryCatalogAssetInventory({
      entriesDir,
      slug,
      catalogEntriesFile,
      catalogEditorialFile,
      protectedAssetsFile,
      discoveredSlugs: discovered,
    })
    : {
      rows: [],
      counts: summarizeInventory([]),
      files: {
        catalogEntriesFile: path.resolve(catalogEntriesFile),
        catalogEditorialFile: path.resolve(catalogEditorialFile),
        protectedAssetsFile: path.resolve(protectedAssetsFile),
      },
    };

  const reportsBySlug = new Map(
    reports.map((report) => [toText(report.slug), report]),
  );
  for (const row of inventory.rows || []) {
    const slugKey = toText(row.entryId);
    if (!slugKey) continue;
    const report = reportsBySlug.get(slugKey);
    if (!report || report.skippedLegacy) continue;
    const reportRecordingIndex = report.recordingIndex || {
      pdfTokenRaw: '',
      pdfKind: '',
      pdfValue: '',
      pdfValid: false,
      bundleTokenRaw: '',
      bundleKind: '',
      bundleValue: '',
      bundleValid: false,
      sourceUrlRaw: '',
      sourceUrlValid: false,
      error: '',
    };
    row.recordingIndex = {
      pdfTokenRaw: toText(reportRecordingIndex.pdfTokenRaw),
      pdfKind: toText(reportRecordingIndex.pdfKind),
      pdfValue: toText(reportRecordingIndex.pdfValue),
      pdfValid: Boolean(reportRecordingIndex.pdfValid),
      bundleTokenRaw: toText(reportRecordingIndex.bundleTokenRaw),
      bundleKind: toText(reportRecordingIndex.bundleKind),
      bundleValue: toText(reportRecordingIndex.bundleValue),
      bundleValid: Boolean(reportRecordingIndex.bundleValid),
      sourceUrlRaw: toText(reportRecordingIndex.sourceUrlRaw),
      sourceUrlValid: Boolean(reportRecordingIndex.sourceUrlValid),
      resolved: false,
      resolvedLookup: '',
      resolvedFileId: '',
      pdfLike: false,
      bundleResolved: false,
      resolvedBundleToken: '',
      error: toText(reportRecordingIndex.error),
    };
    row.downloadTree = buildInventoryDownloadTree(row);
    const isActiveLinked = row.state === 'linked'
      && toText(row.catalog?.status || '').toLowerCase() === 'active';

    const recordingIndex = reportRecordingIndex;
    const pdfTokenRaw = toText(recordingIndex.pdfTokenRaw);
    const bundleTokenRaw = toText(recordingIndex.bundleTokenRaw);
    if (isActiveLinked) {
      if (!pdfTokenRaw) {
        report.issues.push('recording index pdf token is required for active linked entries');
      } else if (!recordingIndex.pdfValid) {
        const detail = toText(recordingIndex.error) || 'invalid recording index pdf token';
        report.issues.push(`recording index pdf token is invalid (${detail})`);
      }
      if (!bundleTokenRaw) {
        report.issues.push('recording index bundle token is required for active linked entries');
      } else if (!recordingIndex.bundleValid) {
        const detail = toText(recordingIndex.error) || 'invalid recording index bundle token';
        report.issues.push(`recording index bundle token is invalid (${detail})`);
      }
    }

    const lookupNumber = toText(row.catalog?.lookupNumber);
    const lookupFiles = lookupNumber
      ? (row.assets?.lookupFiles?.[lookupNumber] || [])
      : (row.assets?.files || []);
    if (pdfTokenRaw && recordingIndex.pdfValid) {
      let resolvedFile = null;
      if (recordingIndex.pdfKind === 'asset') {
        resolvedFile = (lookupFiles || []).find((file) => textKey(file.fileId) === textKey(recordingIndex.pdfValue)) || null;
      } else if (recordingIndex.pdfKind === 'lookup') {
        resolvedFile = (lookupFiles || []).find((file) => textKey(file.bucketNumber) === textKey(recordingIndex.pdfValue)) || null;
      }
      if (!resolvedFile) {
        if (isActiveLinked) {
          report.issues.push(`recording index pdf token does not resolve to protected assets for lookup ${lookupNumber || '(unknown)'}`);
        }
      } else {
        const mime = toText(resolvedFile.mime).toLowerCase();
        const r2Key = toText(resolvedFile.r2Key).toLowerCase();
        const pdfLike = mime.includes('pdf') || r2Key.endsWith('.pdf');
        row.recordingIndex.resolved = true;
        row.recordingIndex.resolvedLookup = lookupNumber;
        row.recordingIndex.resolvedFileId = toText(resolvedFile.fileId || resolvedFile.bucketNumber);
        row.recordingIndex.pdfLike = pdfLike;
        if (!pdfLike && isActiveLinked) {
          report.issues.push(`recording index token resolves to non-pdf asset (${resolvedFile.fileId || resolvedFile.bucketNumber || 'unknown'})`);
        }
      }
    }

    const bundleMetadata = lookupNumber
      ? (row.assets?.recordingIndexByLookup?.[lookupNumber] || null)
      : null;
    if (bundleTokenRaw && recordingIndex.bundleValid) {
      const expectedBundle = toText(bundleMetadata?.bundleAllToken);
      const actualBundleToken = `bundle:${toText(recordingIndex.bundleValue)}`;
      if (expectedBundle) {
        if (textKey(actualBundleToken) !== textKey(expectedBundle)) {
          if (isActiveLinked) {
            report.issues.push(
              `recording index bundle token mismatch for lookup ${lookupNumber || '(unknown)'} (${actualBundleToken} != ${expectedBundle})`,
            );
          }
        } else {
          row.recordingIndex.bundleResolved = true;
          row.recordingIndex.resolvedBundleToken = actualBundleToken;
        }
      } else {
        const normalizedLookup = lookupNumber.replace(/\s+/g, ' ').trim();
        const expectedPrefix = `recording-index:${normalizedLookup}:all`.toLowerCase();
        if (!toText(recordingIndex.bundleValue).toLowerCase().startsWith(expectedPrefix)) {
          if (isActiveLinked) {
            report.issues.push(
              `recording index bundle token does not match lookup ${lookupNumber || '(unknown)'}`,
            );
          }
        } else {
          row.recordingIndex.bundleResolved = true;
          row.recordingIndex.resolvedBundleToken = actualBundleToken;
        }
      }
    }
  }

  for (const row of inventory.rows || []) {
    row.downloadTree = buildInventoryDownloadTree(row);
  }

  for (const report of reports) {
    report.ok = Array.isArray(report.issues) && report.issues.length === 0;
  }
  const failures = reports.filter((report) => !report.ok).length;
  return {
    reports,
    failures,
    skipped: reports.filter((report) => report.skippedLegacy).length,
    inventory,
  };
}

export async function verifyCatalogEntryLinkage({
  catalogFile = path.resolve('data', 'catalog.editorial.json'),
} = {}) {
  const text = await fs.readFile(catalogFile, 'utf8');
  const raw = JSON.parse(text);
  const rows = Array.isArray(raw.manifest) ? raw.manifest : [];
  const activeRows = rows.filter((row) => toText(row.status || 'active') === 'active');
  const failures = [];
  for (const row of activeRows) {
    const checked = await checkCatalogManifestRowLinkage(row, { rootDir: process.cwd() });
    if (!checked.ok) failures.push({ row, checked });
  }
  return {
    count: activeRows.length,
    failures,
    ids: activeRows.map((row) => deriveEntryIdFromCatalogRow(row)).filter(Boolean),
  };
}
