import fs from 'node:fs/promises';
import path from 'node:path';

const GOOGLE_SHEETS_HOSTS = new Set([
  'docs.google.com',
  'spreadsheets.google.com',
]);

const LOOKUP_BUCKET_NUMBER_PATTERN = /(?:^|[^A-Za-z0-9])([A-Z])\s*[.\-]\s*0*([0-9]{1,6})(?:[^0-9]|$)/i;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

const AUDIO_EXTENSIONS = new Set(['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a']);
const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'mkv', 'webm']);

function toText(value) {
  return String(value ?? '').trim();
}

function slugifyToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'entry';
}

function normalizeSheetUrl(url) {
  const raw = toText(url);
  if (!raw) {
    throw new Error('Recording index sheet URL is required.');
  }
  const candidate = (() => {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^docs\.google\.com\/spreadsheets\/d\//i.test(raw)) return `https://${raw}`;
    if (/^\/spreadsheets\/d\//i.test(raw)) return `https://docs.google.com${raw}`;
    return raw;
  })();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid recording index sheet URL: ${raw}`);
  }
  if (!GOOGLE_SHEETS_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Recording index URL must be a Google Sheets URL: ${raw}`);
  }

  const idMatch = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/i);
  if (!idMatch) {
    throw new Error(`Unable to read Google Sheet ID from URL: ${raw}`);
  }
  const sheetId = toText(idMatch[1]);
  if (!sheetId) {
    throw new Error(`Unable to read Google Sheet ID from URL: ${raw}`);
  }

  let gid = toText(parsed.searchParams.get('gid'));
  if (!gid && parsed.hash) {
    const hashMatch = parsed.hash.match(/gid=([0-9]+)/i);
    if (hashMatch) gid = toText(hashMatch[1]);
  }
  if (!gid) gid = '0';

  const base = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  return {
    sheetUrl: `${base}/edit?gid=${encodeURIComponent(gid)}#gid=${encodeURIComponent(gid)}`,
    sheetId,
    gid,
    xlsxExportUrl: `${base}/export?format=xlsx&gid=${encodeURIComponent(gid)}`,
    pdfExportUrl: `${base}/export?format=pdf&gid=${encodeURIComponent(gid)}`,
  };
}

function inferFileExtension(value) {
  const raw = toText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname || '';
    const extMatch = pathname.toLowerCase().match(/\.([a-z0-9]{2,8})$/i);
    if (extMatch) return extMatch[1].toLowerCase();
  } catch {
    const extMatch = raw.toLowerCase().match(/\.([a-z0-9]{2,8})(?:\?|#|$)/i);
    if (extMatch) return extMatch[1].toLowerCase();
  }
  return '';
}

function inferMimeFromExtension(extension, fallbackType = 'unknown') {
  const ext = toText(extension).toLowerCase();
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'aif' || ext === 'aiff') return 'audio/aiff';
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'pdf') return 'application/pdf';
  if (fallbackType === 'audio') return 'audio/*';
  if (fallbackType === 'video') return 'video/*';
  return '';
}

function inferAvailableTypes({ extension, rowText, label }) {
  const ext = toText(extension).toLowerCase();
  const text = `${toText(label)} ${toText(rowText)}`.toLowerCase();
  const available = new Set();
  if (AUDIO_EXTENSIONS.has(ext)) available.add('audio');
  if (VIDEO_EXTENSIONS.has(ext)) available.add('video');
  if (/\b(4k|2160p?|1080p?|720p?|video|mov|mp4|prores|h264|h265)\b/.test(text)) available.add('video');
  if (/\b(audio|wav|aiff?|flac|mix|master|mono|stereo|ste)\b/.test(text)) available.add('audio');
  return Array.from(available);
}

function inferType({ extension, rowText, label }) {
  const ext = toText(extension).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return { type: 'audio', reason: 'extension' };
  if (VIDEO_EXTENSIONS.has(ext)) return { type: 'video', reason: 'extension' };
  const text = `${toText(label)} ${toText(rowText)}`.toLowerCase();
  if (/\b(4k|2160p?|1080p?|720p?|video|mov|mp4|prores|h264|h265)\b/.test(text)) return { type: 'video', reason: 'label-token' };
  if (/\b(audio|wav|aiff?|flac|mix|master|mono|stereo|ste|mp3)\b/.test(text)) return { type: 'audio', reason: 'label-token' };
  if (/(audio|wav|aiff|flac|mix|master|stereo|ste|mp3)/.test(text)) return { type: 'audio', reason: 'label-token' };
  if (/(video|mov|mp4|footage|camera|frame)/.test(text)) return { type: 'video', reason: 'label-token' };
  return { type: 'unknown', reason: 'fallback' };
}

function extractBucketNumber(value) {
  const raw = toText(value);
  if (!raw) return null;
  const match = raw.match(LOOKUP_BUCKET_NUMBER_PATTERN);
  if (!match) return null;
  const bucket = match[1].toUpperCase();
  const numeric = Number(match[2]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return {
    bucket,
    number: numeric,
    bucketNumber: `${bucket}.${numeric}`,
  };
}

function extractDriveFileId(urlValue) {
  const raw = toText(urlValue);
  if (!raw) return '';
  let text = raw;
  try {
    const parsed = new URL(raw);
    const idParam = toText(parsed.searchParams.get('id'));
    if (DRIVE_FILE_ID_PATTERN.test(idParam)) return idParam;
    text = `${parsed.pathname} ${parsed.hash} ${parsed.search}`;
  } catch {
    // continue with raw
  }
  const pathMatch = text.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (pathMatch) return pathMatch[1];
  const openMatch = text.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (openMatch) return openMatch[1];
  return '';
}

function padNumber(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(3, '0');
}

function resolvePdfBucketNumber(files) {
  const existing = new Set(
    (files || [])
      .map((item) => toText(item.bucketNumber).toUpperCase())
      .filter(Boolean),
  );
  let next = 1;
  while (existing.has(`X.${next}`)) next += 1;
  return `X.${next}`;
}

async function loadXlsxModule() {
  try {
    const mod = await import('xlsx');
    return mod?.default || mod;
  } catch {
    throw new Error('Missing dependency "xlsx". Run npm install to enable recording index import.');
  }
}

async function fetchWithTimeout(url, {
  timeoutMs = 12000,
  retries = 2,
} = {}) {
  const safeTimeout = Math.max(1000, Number(timeoutMs) || 12000);
  const safeRetries = Math.max(0, Number(retries) || 0);
  let attempt = 0;
  let lastError = null;
  while (attempt <= safeRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), safeTimeout);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      clearTimeout(timeout);
      return Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      attempt += 1;
      if (attempt > safeRetries) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

function cellText(cell) {
  if (!cell) return '';
  if (typeof cell.w === 'string' && cell.w.trim()) return cell.w.trim();
  if (cell.v == null) return '';
  return String(cell.v).trim();
}

function cellLink(cell) {
  const target = toText(cell?.l?.Target || cell?.l?.target || '');
  if (target) return target;
  const value = cellText(cell);
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

const BUCKET_ORDER = new Map(['A', 'B', 'C', 'D', 'E', 'X'].map((bucket, index) => [bucket, index]));

function detectGridBucketColumns(XLSX, worksheet, range) {
  const strictGrid = [
    { bucket: 'A', column: 0 },
    { bucket: 'B', column: 1 },
    { bucket: 'C', column: 2 },
    { bucket: 'D', column: 3 },
    { bucket: 'E', column: 4 },
    { bucket: 'X', column: 5 },
  ]
    .filter((entry) => entry.column >= range.s.c && entry.column <= range.e.c)
    .map((entry) => ({
      ...entry,
      folderCell: XLSX.utils.encode_cell({ r: 1, c: entry.column }),
    }));
  return strictGrid;
}

function parseWorksheetSegmentsGrid(XLSX, worksheet) {
  const ref = toText(worksheet?.['!ref']);
  if (!ref) {
    return {
      segments: [],
      folderLinks: { rootFolderUrl: '', bucketFolderUrls: {} },
    };
  }
  const range = XLSX.utils.decode_range(ref);
  const gridColumns = detectGridBucketColumns(XLSX, worksheet, range);
  if (!gridColumns.length) {
    return {
      segments: [],
      folderLinks: { rootFolderUrl: '', bucketFolderUrls: {} },
    };
  }
  const rootFolderUrl = cellLink(worksheet.A1);
  const bucketFolderUrls = {};
  const activeColumns = [];
  for (const mapping of gridColumns) {
    const folderUrl = cellLink(worksheet[mapping.folderCell]);
    if (!folderUrl) continue;
    bucketFolderUrls[mapping.bucket] = folderUrl;
    activeColumns.push(mapping);
  }
  if (!activeColumns.length) {
    return {
      segments: [],
      folderLinks: {
        rootFolderUrl,
        bucketFolderUrls,
      },
    };
  }

  const startRow = 3; // row 4 in sheet (0-indexed)
  const segments = [];
  const bucketCounters = new Map();
  const seenBucketNumbers = new Set();
  for (let r = startRow; r <= range.e.r; r += 1) {
    for (const mapping of activeColumns) {
      if (mapping.column > range.e.c) continue;
      const addr = XLSX.utils.encode_cell({ r, c: mapping.column });
      const cell = worksheet[addr];
      if (!cell) continue;
      const label = cellText(cell);
      const rawUrl = cellLink(cell);
      if (!label && !rawUrl) continue;
      if (!rawUrl) continue;

      const parsedBucket = extractBucketNumber(label);
      let segmentNumber = 0;
      let bucketNumber = '';
      if (parsedBucket && parsedBucket.bucket === mapping.bucket) {
        segmentNumber = parsedBucket.number;
        bucketNumber = parsedBucket.bucketNumber;
      } else {
        segmentNumber = (bucketCounters.get(mapping.bucket) || 0) + 1;
        bucketNumber = `${mapping.bucket}.${segmentNumber}`;
      }
      bucketCounters.set(mapping.bucket, Math.max(bucketCounters.get(mapping.bucket) || 0, segmentNumber));
      const dedupeKey = bucketNumber.toLowerCase();
      if (seenBucketNumbers.has(dedupeKey)) continue;
      seenBucketNumbers.add(dedupeKey);

      const extension = inferFileExtension(rawUrl);
      const inferred = inferType({
        extension,
        label,
        rowText: `${mapping.bucket} ${segmentNumber} ${label}`,
      });
      const availableTypes = inferAvailableTypes({
        extension,
        label,
        rowText: `${mapping.bucket} ${segmentNumber} ${label}`,
      });
      segments.push({
        bucketNumber,
        bucket: mapping.bucket,
        segmentNumber,
        rowNumber: r + 1,
        label: toText(label) || `${bucketNumber} segment`,
        rawUrl,
        driveFileId: extractDriveFileId(rawUrl),
        extension,
        type: inferred.type,
        typeReason: inferred.reason,
        availableTypes,
        mime: inferMimeFromExtension(extension, inferred.type),
      });
    }
  }

  segments.sort((a, b) => {
    const left = BUCKET_ORDER.get(a.bucket) ?? 999;
    const right = BUCKET_ORDER.get(b.bucket) ?? 999;
    if (left !== right) return left - right;
    return a.segmentNumber - b.segmentNumber;
  });

  return {
    segments,
    folderLinks: {
      rootFolderUrl,
      bucketFolderUrls,
    },
  };
}

function parseWorksheetSegmentsLegacy(XLSX, worksheet) {
  const ref = toText(worksheet?.['!ref']);
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const rowCells = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[addr];
      if (!cell) continue;
      const display = cellText(cell);
      const link = cellLink(cell);
      if (!display && !link) continue;
      rowCells.push({ display, link, c });
    }
    if (!rowCells.length) continue;
    rows.push({ rowNumber: r + 1, cells: rowCells });
  }

  const segments = [];
  const seenBucketNumbers = new Set();
  for (const row of rows) {
    const displays = row.cells.map((cell) => cell.display).filter(Boolean);
    const rowText = displays.join(' ').trim();
    const bucketInfo = (() => {
      for (const value of displays) {
        const parsed = extractBucketNumber(value);
        if (parsed) return parsed;
      }
      return null;
    })();
    if (!bucketInfo) continue;
    const urlValue = (() => {
      const linkCell = row.cells.find((cell) => cell.link);
      if (linkCell) return linkCell.link;
      const explicit = displays.find((value) => /^https?:\/\//i.test(value));
      return explicit || '';
    })();
    if (!urlValue) continue;

    const bucketNumberKey = bucketInfo.bucketNumber.toLowerCase();
    if (seenBucketNumbers.has(bucketNumberKey)) continue;
    seenBucketNumbers.add(bucketNumberKey);

    const extension = inferFileExtension(urlValue);
    const inferred = inferType({ extension, rowText, label: rowText });
    const availableTypes = inferAvailableTypes({ extension, rowText, label: rowText });
    const label = toText(
      displays.find((value) => {
        const parsed = extractBucketNumber(value);
        return !parsed;
      }) || `${bucketInfo.bucketNumber} segment`,
    );
    segments.push({
      bucketNumber: bucketInfo.bucketNumber,
      bucket: bucketInfo.bucket,
      segmentNumber: bucketInfo.number,
      rowNumber: row.rowNumber,
      label,
      rawUrl: urlValue,
      driveFileId: extractDriveFileId(urlValue),
      extension,
      type: inferred.type,
      typeReason: inferred.reason,
      availableTypes,
      mime: inferMimeFromExtension(extension, inferred.type),
    });
  }

  segments.sort((a, b) => {
    const bucketDiff = a.bucket.localeCompare(b.bucket);
    if (bucketDiff !== 0) return bucketDiff;
    return a.segmentNumber - b.segmentNumber;
  });
  return segments;
}

function parseWorksheetSegments(XLSX, worksheet) {
  const grid = parseWorksheetSegmentsGrid(XLSX, worksheet);
  if (Array.isArray(grid.segments) && grid.segments.length > 0) {
    return grid;
  }
  return {
    segments: parseWorksheetSegmentsLegacy(XLSX, worksheet),
    folderLinks: grid.folderLinks || { rootFolderUrl: '', bucketFolderUrls: {} },
  };
}

function normalizeSegmentsForLookup(segments, {
  entrySlug,
} = {}) {
  const slug = slugifyToken(entrySlug);
  return segments.map((segment, index) => {
    const ext = toText(segment.extension).toLowerCase() || (segment.type === 'audio' ? 'wav' : segment.type === 'video' ? 'mov' : 'bin');
    const label = segment.label || `${segment.bucketNumber} segment`;
    return {
      bucketNumber: segment.bucketNumber,
      bucket: segment.bucket,
      segmentNumber: segment.segmentNumber,
      label,
      sourceLabel: label,
      rawUrl: segment.rawUrl,
      driveFileId: segment.driveFileId || '',
      type: segment.type,
      typeReason: segment.typeReason || '',
      availableTypes: Array.isArray(segment.availableTypes) ? segment.availableTypes.slice() : [],
      fileId: `${slug}-${segment.bucket.toLowerCase()}-${padNumber(segment.segmentNumber)}`,
      r2Key: `${slug}/${segment.bucket.toLowerCase()}/${padNumber(segment.segmentNumber)}.${ext}`,
      sizeBytes: 0,
      mime: segment.mime || inferMimeFromExtension(ext, segment.type),
      position: index + 1,
      enabled: true,
      role: 'media',
    };
  });
}

function buildBundleTokensByBucketType(segments, lookupNumber) {
  const segmentSupportsType = (segment, type) => {
    const normalizedType = toText(type).toLowerCase();
    const direct = toText(segment?.type).toLowerCase();
    if (direct === normalizedType) return true;
    const available = Array.isArray(segment?.availableTypes)
      ? segment.availableTypes
      : [];
    return available.some((item) => toText(item).toLowerCase() === normalizedType);
  };
  const out = {};
  for (const segment of segments) {
    if (!segment.enabled) continue;
    if (segmentSupportsType(segment, 'audio')) {
      const audioKey = `${segment.bucket}:audio`;
      if (!out[audioKey]) out[audioKey] = `bundle:lookup:${lookupNumber}:${segment.bucket}:audio`;
    }
    if (segmentSupportsType(segment, 'video')) {
      const videoKey = `${segment.bucket}:video`;
      if (!out[videoKey]) out[videoKey] = `bundle:lookup:${lookupNumber}:${segment.bucket}:video`;
    }
  }
  return out;
}

export function parseRecordingIndexSheetUrl(url) {
  return normalizeSheetUrl(url);
}

export async function importRecordingIndexFromSheet({
  sheetUrl,
  fallbackXlsxPath,
  lookupNumber,
  entrySlug,
  timeoutMs = 12000,
  retries = 2,
} = {}) {
  const normalizedLookup = toText(lookupNumber);
  if (!normalizedLookup) {
    throw new Error('Lookup number is required before importing recording index.');
  }
  const normalizedSlug = slugifyToken(entrySlug || normalizedLookup);
  const sheet = normalizeSheetUrl(sheetUrl);

  let workbookBuffer = null;
  let sourceMode = 'live';
  let sourceLabel = sheet.xlsxExportUrl;
  let fetchError = null;
  try {
    workbookBuffer = await fetchWithTimeout(sheet.xlsxExportUrl, {
      timeoutMs,
      retries,
    });
  } catch (error) {
    fetchError = error;
    const fallbackPath = toText(fallbackXlsxPath);
    if (!fallbackPath) {
      throw new Error(`Recording index fetch failed and no fallback XLSX provided (${error?.message || String(error)})`);
    }
    const absolute = path.resolve(fallbackPath);
    workbookBuffer = await fs.readFile(absolute);
    sourceMode = 'fallback';
    sourceLabel = absolute;
  }

  const XLSX = await loadXlsxModule();
  const workbook = XLSX.read(workbookBuffer, {
    type: 'buffer',
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    sheetStubs: true,
  });
  const firstSheetName = workbook.SheetNames?.[0];
  if (!firstSheetName) {
    throw new Error('Recording index workbook has no sheets.');
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const parsed = parseWorksheetSegments(XLSX, worksheet);
  const parsedSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
  const folderLinks = parsed.folderLinks && typeof parsed.folderLinks === 'object'
    ? parsed.folderLinks
    : { rootFolderUrl: '', bucketFolderUrls: {} };
  if (!parsedSegments.length) {
    throw new Error('No per-file segment links were found in recording index sheet.');
  }
  if (!toText(folderLinks.rootFolderUrl)) {
    throw new Error('Recording index root folder link is missing at A1.');
  }
  const usedBuckets = Array.from(new Set(parsedSegments.map((segment) => segment.bucket)));
  for (const bucket of usedBuckets) {
    const folderUrl = toText(folderLinks.bucketFolderUrls?.[bucket]);
    if (!folderUrl) {
      throw new Error(`Recording index bucket folder link is missing at ${bucket === 'X' ? 'F2' : `${bucket}2`} for bucket ${bucket}.`);
    }
  }

  const files = normalizeSegmentsForLookup(parsedSegments, {
    entrySlug: normalizedSlug,
  });
  const pdfAssetId = `${normalizedSlug}-recording-index-pdf`;
  const bundleAllToken = `bundle:recording-index:${normalizedLookup}:all`;
  const pdfBucketNumber = resolvePdfBucketNumber(files);

  const pdfFile = {
    bucketNumber: pdfBucketNumber,
    bucket: 'X',
    segmentNumber: Number(String(pdfBucketNumber).split('.')[1] || 1),
    label: 'Recording Index PDF',
    sourceLabel: 'Recording Index PDF',
    rawUrl: sheet.pdfExportUrl,
    driveFileId: '',
    type: 'pdf',
    availableTypes: ['pdf'],
    fileId: pdfAssetId,
    r2Key: `${normalizedSlug}/recording-index/recording-index.pdf`,
    sizeBytes: 0,
    mime: 'application/pdf',
    position: files.length + 1,
    enabled: true,
    role: 'recording_index_pdf',
  };

  const filesWithPdf = [...files, pdfFile];
  const bundleTokensByBucketType = buildBundleTokensByBucketType(files, normalizedLookup);
  const supportsType = (file, type) => {
    const normalizedType = toText(type).toLowerCase();
    const direct = toText(file?.type).toLowerCase();
    if (direct === normalizedType) return true;
    const available = Array.isArray(file?.availableTypes) ? file.availableTypes : [];
    return available.some((item) => toText(item).toLowerCase() === normalizedType);
  };
  const counts = {
    totalFiles: files.length,
    audioFiles: files.filter((file) => supportsType(file, 'audio')).length,
    videoFiles: files.filter((file) => supportsType(file, 'video')).length,
    unknownFiles: files.filter((file) => !supportsType(file, 'audio') && !supportsType(file, 'video')).length,
    buckets: Array.from(new Set(files.map((file) => file.bucket))).sort(),
  };

  return {
    sheet: {
      ...sheet,
      rootFolderUrl: toText(folderLinks.rootFolderUrl),
      bucketFolderUrls: folderLinks.bucketFolderUrls || {},
    },
    source: {
      mode: sourceMode,
      value: sourceLabel,
      warning: fetchError ? String(fetchError?.message || fetchError || '') : '',
    },
    files: filesWithPdf,
    segments: files,
    bundleTokensByBucketType,
    recordingIndex: {
      sheetUrl: sheet.sheetUrl,
      sheetId: sheet.sheetId,
      gid: sheet.gid,
      pdfAssetId,
      bundleAllToken,
      recordingIndexPdfRef: `asset:${pdfAssetId}`,
      recordingIndexBundleRef: bundleAllToken,
      recordingIndexSourceUrl: sheet.sheetUrl,
    },
    counts,
  };
}
