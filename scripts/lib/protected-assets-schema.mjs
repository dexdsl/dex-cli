import { z } from 'zod';
import { BUCKETS } from './entry-schema.mjs';

export const PROTECTED_ASSETS_VERSION = 'protected-assets-v1';
export const PROTECTED_ASSETS_SYNC_STRATEGY = 'manifest-publish';
export const PROTECTED_ASSETS_DEFAULT_ALLOWED_BUCKETS = [...BUCKETS];
export const PROTECTED_ASSETS_DEFAULT_STORAGE_BUCKET = 'dex-protected-assets';

const LOOKUP_SUBMISSION_PATTERN = /^SUB\d{2,4}-[A-Z]\.[A-Za-z]{3}\s[A-Za-z]{2}\s(?:AV|A|V|O)\d{4}$/i;
const LOOKUP_CATALOG_PATTERN = /^[A-Z]\.[A-Za-z]{3}\.\s[A-Za-z]{2}\s(?:AV|A|V|O)\d{4}(?:\sS\d+)?$/i;
const BUCKET_NUMBER_PATTERN = /^([A-Z])\.([0-9]{1,6})$/;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const SEASON_PATTERN = /^S\d+$/i;
const FILE_TYPE_VALUES = new Set(['audio', 'video', 'pdf', 'unknown']);
const FILE_ROLE_VALUES = new Set(['media', 'recording_index_pdf']);
const STATUS_VALUES = new Set([
  'draft',
  'submitted',
  'pending',
  'reviewing',
  'triage',
  'in_review',
  'needs_info',
  'approved',
  'accepted',
  'rejected',
  'in_library',
  'closed',
]);
const ENTITLEMENT_TYPE_VALUES = new Set([
  'auth0_sub',
  'email',
  'email_domain',
  'membership_tier',
  'role',
  'public',
]);

const isoDateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'Invalid ISO timestamp',
});

const entitlementSchema = z.object({
  type: z.string().trim().min(1).max(64),
  value: z.string().trim().min(1).max(240),
});

const recordingIndexSchema = z.object({
  sheetUrl: z.string().trim().min(1).max(1024),
  sheetId: z.string().trim().min(1).max(160),
  gid: z.string().trim().min(1).max(32),
  pdfAssetId: z.string().trim().min(1).max(160),
  bundleAllToken: z.string().trim().min(1).max(240),
  rootFolderUrl: z.string().trim().max(1024).optional(),
  bucketFolderUrls: z.record(z.string().trim().max(1024)).optional(),
});

const exemptionSchema = z.object({
  lookupNumber: z.string().trim().min(1).max(120),
  downloadsMode: z.literal('none'),
  reason: z.string().trim().min(1).max(240),
});

const fileSchema = z.object({
  bucketNumber: z.string().trim().min(3).max(32),
  fileId: z.string().trim().min(1).max(64).optional(),
  bucket: z.string().trim().min(1).max(8),
  r2Key: z.string().trim().min(1).max(512),
  driveFileId: z.string().trim().max(160).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  mime: z.string().trim().min(1).max(160).optional(),
  position: z.number().int().min(1).max(9999).optional(),
  label: z.string().trim().max(160).optional(),
  type: z.string().trim().max(32).optional(),
  availableTypes: z.array(z.string().trim().min(1).max(32)).optional(),
  role: z.string().trim().max(64).optional(),
  sourceLabel: z.string().trim().max(240).optional(),
});

const lookupSchema = z.object({
  lookupNumber: z.string().trim().min(1).max(80),
  title: z.string().trim().max(240).optional(),
  status: z.string().trim().max(64).optional(),
  season: z.string().trim().max(32).optional(),
  files: z.array(fileSchema).min(1),
  entitlements: z.array(entitlementSchema).min(1),
  recordingIndex: recordingIndexSchema.optional(),
});

const protectedAssetsSchema = z.object({
  version: z.literal(PROTECTED_ASSETS_VERSION),
  updatedAt: isoDateString,
  settings: z.object({
    storageBucket: z.string().trim().min(1).max(120).optional(),
    allowedBuckets: z.array(z.string().trim().min(1).max(8)).min(1).optional(),
    syncStrategy: z.literal(PROTECTED_ASSETS_SYNC_STRATEGY).optional(),
  }).optional(),
  lookups: z.array(lookupSchema),
  exemptions: z.array(exemptionSchema).optional(),
});

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLookupNumber(value) {
  const normalized = normalizeText(value);
  if (!LOOKUP_SUBMISSION_PATTERN.test(normalized) && !LOOKUP_CATALOG_PATTERN.test(normalized)) {
    throw new Error(`Invalid lookupNumber: ${normalized || '(empty)'}`);
  }
  return normalized;
}

function normalizeBucketList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const bucket = normalizeText(value).toUpperCase();
    if (!bucket) continue;
    if (!PROTECTED_ASSETS_DEFAULT_ALLOWED_BUCKETS.includes(bucket)) {
      throw new Error(`Unsupported bucket code: ${bucket}`);
    }
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    out.push(bucket);
  }
  if (!out.length) {
    return [...PROTECTED_ASSETS_DEFAULT_ALLOWED_BUCKETS];
  }
  return out;
}

function normalizeStatus(value) {
  const status = normalizeText(value).toLowerCase() || 'submitted';
  if (!STATUS_VALUES.has(status)) {
    throw new Error(`Unsupported status value: ${value}`);
  }
  return status;
}

function normalizeSeason(value) {
  const season = normalizeText(value).toUpperCase();
  if (!season) return '';
  if (!SEASON_PATTERN.test(season)) {
    throw new Error(`Invalid season value: ${value}`);
  }
  return season;
}

function parseBucketNumber(value) {
  const normalized = normalizeText(value).toUpperCase();
  const match = normalized.match(BUCKET_NUMBER_PATTERN);
  if (!match) {
    throw new Error(`Invalid bucketNumber: ${value}`);
  }
  return {
    bucket: match[1],
    number: match[2],
    bucketNumber: `${match[1]}.${match[2]}`,
  };
}

function normalizeDriveFileId(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (!DRIVE_FILE_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid driveFileId: ${value}`);
  }
  return normalized;
}

function normalizeFileType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return 'unknown';
  if (!FILE_TYPE_VALUES.has(normalized)) {
    throw new Error(`Unsupported file type: ${value}`);
  }
  return normalized;
}

function normalizeAvailableTypes(values = [], fallbackType = 'unknown') {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) continue;
    if (!FILE_TYPE_VALUES.has(normalized)) {
      throw new Error(`Unsupported availableTypes value: ${value}`);
    }
    if (normalized === 'unknown') continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  const fallback = normalizeFileType(fallbackType);
  if (!out.length && fallback !== 'unknown') {
    out.push(fallback);
  }
  return out;
}

function normalizeFileRole(value) {
  const normalized = normalizeText(value).toLowerCase() || 'media';
  if (!FILE_ROLE_VALUES.has(normalized)) {
    throw new Error(`Unsupported file role: ${value}`);
  }
  return normalized;
}

function isPdfLikeFile(file = {}) {
  const mime = normalizeText(file.mime).toLowerCase();
  const r2Key = normalizeText(file.r2Key).toLowerCase();
  const label = normalizeText(file.label || file.sourceLabel).toLowerCase();
  if (mime.includes('pdf')) return true;
  if (r2Key.endsWith('.pdf')) return true;
  if (label.includes('recording index') || label.includes('pdf')) return true;
  return false;
}

function normalizeFile(file, index, allowedBuckets, lookupNumber) {
  const parsed = fileSchema.parse(file);
  const bucketRef = parseBucketNumber(parsed.bucketNumber);
  const bucket = normalizeText(parsed.bucket).toUpperCase();
  if (!allowedBuckets.includes(bucket)) {
    throw new Error(`Lookup ${lookupNumber}: bucket ${bucket} is not allowed`);
  }
  if (bucketRef.bucket !== bucket) {
    throw new Error(`Lookup ${lookupNumber}: bucketNumber ${bucketRef.bucketNumber} does not match bucket ${bucket}`);
  }

  const r2Key = normalizeText(parsed.r2Key);
  if (!r2Key) {
    throw new Error(`Lookup ${lookupNumber}: r2Key missing for ${bucketRef.bucketNumber}`);
  }

  const type = normalizeFileType(parsed.type);
  const availableTypes = normalizeAvailableTypes(parsed.availableTypes, type);
  const role = normalizeFileRole(parsed.role);
  const label = normalizeText(parsed.label);
  const sourceLabel = normalizeText(parsed.sourceLabel) || label;

  return {
    bucketNumber: bucketRef.bucketNumber,
    fileId: normalizeText(parsed.fileId) || bucketRef.bucketNumber,
    bucket,
    r2Key,
    driveFileId: normalizeDriveFileId(parsed.driveFileId),
    sizeBytes: Number.isFinite(Number(parsed.sizeBytes)) ? Number(parsed.sizeBytes) : 0,
    mime: normalizeText(parsed.mime),
    position: Number.isFinite(Number(parsed.position)) ? Number(parsed.position) : index + 1,
    label,
    sourceLabel,
    type,
    availableTypes,
    role,
  };
}

function normalizeEntitlements(entitlements, lookupNumber) {
  const out = [];
  const seen = new Set();
  for (const entry of entitlements || []) {
    const parsed = entitlementSchema.parse(entry);
    const type = normalizeText(parsed.type).toLowerCase();
    const value = normalizeText(parsed.value);
    if (!type || !value) continue;
    if (!ENTITLEMENT_TYPE_VALUES.has(type)) {
      throw new Error(`Lookup ${lookupNumber}: unsupported entitlement type ${type}`);
    }
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, value });
  }
  if (!out.length) {
    throw new Error(`Lookup ${lookupNumber}: at least one entitlement is required`);
  }
  return out;
}

function normalizeRecordingIndex(recordingIndex, files, lookupNumber) {
  if (!recordingIndex) return null;
  const parsed = recordingIndexSchema.parse(recordingIndex);
  const sheetUrl = normalizeText(parsed.sheetUrl);
  const sheetId = normalizeText(parsed.sheetId);
  const gid = normalizeText(parsed.gid);
  const pdfAssetId = normalizeText(parsed.pdfAssetId);
  const bundleAllToken = normalizeText(parsed.bundleAllToken);
  const rootFolderUrl = normalizeText(parsed.rootFolderUrl);
  const bucketFolderUrls = parsed.bucketFolderUrls && typeof parsed.bucketFolderUrls === 'object'
    ? parsed.bucketFolderUrls
    : {};

  let parsedUrl;
  try {
    parsedUrl = new URL(sheetUrl);
  } catch {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.sheetUrl is invalid`);
  }
  if (!/google\.com$/i.test(parsedUrl.hostname)) {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.sheetUrl must be a Google URL`);
  }
  if (!sheetId) {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.sheetId is required`);
  }
  if (!gid) {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.gid is required`);
  }
  if (!pdfAssetId) {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.pdfAssetId is required`);
  }
  if (!bundleAllToken || !/^bundle:/i.test(bundleAllToken)) {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.bundleAllToken must start with bundle:`);
  }
  if (rootFolderUrl) {
    let parsedRoot;
    try {
      parsedRoot = new URL(rootFolderUrl);
    } catch {
      throw new Error(`Lookup ${lookupNumber}: recordingIndex.rootFolderUrl is invalid`);
    }
    if (!/^https?:$/i.test(parsedRoot.protocol)) {
      throw new Error(`Lookup ${lookupNumber}: recordingIndex.rootFolderUrl must use http(s)`);
    }
  }
  const normalizedBucketFolderUrls = {};
  for (const [bucketRaw, urlRaw] of Object.entries(bucketFolderUrls || {})) {
    const bucket = normalizeText(bucketRaw).toUpperCase();
    if (!bucket) continue;
    if (!BUCKETS.includes(bucket)) {
      throw new Error(`Lookup ${lookupNumber}: recordingIndex.bucketFolderUrls has unsupported bucket ${bucket}`);
    }
    const url = normalizeText(urlRaw);
    if (!url) continue;
    let parsedBucketUrl;
    try {
      parsedBucketUrl = new URL(url);
    } catch {
      throw new Error(`Lookup ${lookupNumber}: recordingIndex.bucketFolderUrls.${bucket} is invalid`);
    }
    if (!/^https?:$/i.test(parsedBucketUrl.protocol)) {
      throw new Error(`Lookup ${lookupNumber}: recordingIndex.bucketFolderUrls.${bucket} must use http(s)`);
    }
    normalizedBucketFolderUrls[bucket] = parsedBucketUrl.toString();
  }
  const pdfFile = (files || []).find((file) => normalizeText(file.fileId).toLowerCase() === pdfAssetId.toLowerCase());
  if (!pdfFile) {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.pdfAssetId does not match any fileId (${pdfAssetId})`);
  }
  const mime = normalizeText(pdfFile.mime).toLowerCase();
  const r2Key = normalizeText(pdfFile.r2Key).toLowerCase();
  if (!mime.includes('pdf') && !r2Key.endsWith('.pdf')) {
    throw new Error(`Lookup ${lookupNumber}: recordingIndex.pdfAssetId must resolve to a PDF-like file`);
  }

  return {
    sheetUrl: parsedUrl.toString(),
    sheetId,
    gid,
    pdfAssetId,
    bundleAllToken,
    rootFolderUrl,
    bucketFolderUrls: normalizedBucketFolderUrls,
  };
}

function normalizeLookup(entry, allowedBuckets) {
  const parsed = lookupSchema.parse(entry);
  const lookupNumber = normalizeLookupNumber(parsed.lookupNumber);

  const files = parsed.files.map((file, index) => normalizeFile(file, index, allowedBuckets, lookupNumber));
  if (!files.length) {
    throw new Error(`Lookup ${lookupNumber}: must include at least one file`);
  }

  const fileIdSet = new Set();
  const bucketNumberSet = new Set();
  const r2KeySet = new Set();
  for (const file of files) {
    const fileIdKey = file.fileId.toLowerCase();
    if (fileIdSet.has(fileIdKey)) {
      throw new Error(`Lookup ${lookupNumber}: duplicate fileId ${file.fileId}`);
    }
    fileIdSet.add(fileIdKey);

    const bucketNumberKey = file.bucketNumber.toLowerCase();
    if (bucketNumberSet.has(bucketNumberKey)) {
      throw new Error(`Lookup ${lookupNumber}: duplicate bucketNumber ${file.bucketNumber}`);
    }
    bucketNumberSet.add(bucketNumberKey);

    const r2Key = file.r2Key.toLowerCase();
    if (r2KeySet.has(r2Key)) {
      throw new Error(`Lookup ${lookupNumber}: duplicate r2Key ${file.r2Key}`);
    }
    r2KeySet.add(r2Key);
  }

  files.sort((a, b) => {
    const positionDiff = a.position - b.position;
    if (positionDiff !== 0) return positionDiff;
    return a.bucketNumber.localeCompare(b.bucketNumber);
  });

  const recordingIndex = normalizeRecordingIndex(parsed.recordingIndex, files, lookupNumber);
  if (recordingIndex) {
    for (const file of files) {
      if (normalizeText(file.fileId).toLowerCase() === recordingIndex.pdfAssetId.toLowerCase()) {
        file.role = 'recording_index_pdf';
        if (!file.availableTypes.includes('pdf')) file.availableTypes = [...file.availableTypes, 'pdf'];
        if (file.type === 'unknown') file.type = 'pdf';
      }
    }
  }
  for (const file of files) {
    if (file.role === 'recording_index_pdf' && !isPdfLikeFile(file)) {
      throw new Error(`Lookup ${lookupNumber}: recording_index_pdf role must resolve to PDF-like file (${file.fileId || file.bucketNumber})`);
    }
  }

  return {
    lookupNumber,
    title: normalizeText(parsed.title) || 'Untitled asset lookup',
    status: normalizeStatus(parsed.status),
    season: normalizeSeason(parsed.season),
    files,
    entitlements: normalizeEntitlements(parsed.entitlements, lookupNumber),
    ...(recordingIndex ? { recordingIndex } : {}),
  };
}

function normalizeSettings(settings = {}) {
  return {
    storageBucket: normalizeText(settings.storageBucket) || PROTECTED_ASSETS_DEFAULT_STORAGE_BUCKET,
    allowedBuckets: normalizeBucketList(settings.allowedBuckets),
    syncStrategy: PROTECTED_ASSETS_SYNC_STRATEGY,
  };
}

function normalizeExemptions(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const parsed = exemptionSchema.parse(value);
    const lookupNumber = normalizeText(parsed.lookupNumber);
    if (!lookupNumber) continue;
    const key = lookupNumber.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate exemptions lookupNumber: ${lookupNumber}`);
    }
    seen.add(key);
    out.push({
      lookupNumber,
      downloadsMode: 'none',
      reason: normalizeText(parsed.reason),
    });
  }
  out.sort((a, b) => a.lookupNumber.localeCompare(b.lookupNumber));
  return out;
}

export function normalizeProtectedAssetsFile(rawValue) {
  const parsed = protectedAssetsSchema.parse(rawValue);
  const settings = normalizeSettings(parsed.settings || {});
  const lookupSet = new Set();
  const globalBucketNumberSet = new Set();
  const globalR2KeySet = new Set();

  const lookups = parsed.lookups.map((entry) => normalizeLookup(entry, settings.allowedBuckets));
  const exemptions = normalizeExemptions(parsed.exemptions || []);

  for (const lookup of lookups) {
    const lookupKey = lookup.lookupNumber.toLowerCase();
    if (lookupSet.has(lookupKey)) {
      throw new Error(`Duplicate lookupNumber: ${lookup.lookupNumber}`);
    }
    lookupSet.add(lookupKey);

    for (const file of lookup.files) {
      const bucketNumberKey = file.bucketNumber.toLowerCase();
      if (globalBucketNumberSet.has(bucketNumberKey)) {
        throw new Error(`Duplicate bucketNumber across lookups: ${file.bucketNumber}`);
      }
      globalBucketNumberSet.add(bucketNumberKey);

      const r2KeyKey = file.r2Key.toLowerCase();
      if (globalR2KeySet.has(r2KeyKey)) {
        throw new Error(`Duplicate r2Key across lookups: ${file.r2Key}`);
      }
      globalR2KeySet.add(r2KeyKey);
    }
  }

  lookups.sort((a, b) => a.lookupNumber.localeCompare(b.lookupNumber));

  return {
    version: PROTECTED_ASSETS_VERSION,
    updatedAt: new Date(parsed.updatedAt).toISOString(),
    settings,
    lookups,
    exemptions,
  };
}

export function validateProtectedAssetsFile(rawValue) {
  return normalizeProtectedAssetsFile(rawValue);
}

export const protectedAssetsJsonSchema = protectedAssetsSchema;
