import { parseAssetReferenceTokenWithKinds } from './asset-ref.mjs';

function toText(value) {
  return String(value ?? '').trim();
}

function lowerKey(value) {
  return toText(value).toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function segmentSupportsType(segment, type) {
  const normalizedType = toText(type).toLowerCase();
  if (!normalizedType) return false;
  const direct = toText(segment?.type).toLowerCase();
  if (direct === normalizedType) return true;
  const available = asArray(segment?.availableTypes)
    .map((item) => toText(item).toLowerCase())
    .filter(Boolean);
  return available.includes(normalizedType);
}

function parseToken(raw, { allowedKinds, context }) {
  const tokenRaw = toText(raw);
  if (!tokenRaw) {
    return {
      raw: '',
      ok: false,
      parsed: null,
      error: '',
    };
  }
  try {
    const parsed = parseAssetReferenceTokenWithKinds(tokenRaw, {
      allowedKinds,
      context,
    });
    return {
      raw: tokenRaw,
      ok: true,
      parsed,
      error: '',
    };
  } catch (error) {
    return {
      raw: tokenRaw,
      ok: false,
      parsed: null,
      error: String(error?.message || error || 'invalid token'),
    };
  }
}

function isPdfLike(segment) {
  const mime = toText(segment?.mime).toLowerCase();
  const r2Key = toText(segment?.r2Key).toLowerCase();
  const rawUrl = toText(segment?.rawUrl).toLowerCase();
  return mime.includes('pdf') || r2Key.endsWith('.pdf') || rawUrl.includes('.pdf');
}

function inferSubtype(segment = {}) {
  const key = `${toText(segment?.r2Key).toLowerCase()} ${toText(segment?.rawUrl).toLowerCase()} ${toText(segment?.label).toLowerCase()}`;
  if (/(^|\\W)4k(\\W|$)|2160/.test(key)) return '4k';
  if (/1080/.test(key)) return '1080p';
  if (/720/.test(key)) return '720p';
  const ext = key.match(/\\.([a-z0-9]{2,6})(?:\\?|$)/);
  if (ext && ext[1]) return ext[1];
  const mime = toText(segment?.mime).toLowerCase();
  if (mime.includes('/')) return mime.split('/')[1] || 'unknown';
  return toText(segment?.type).toLowerCase() || 'unknown';
}

export function buildDownloadTreeHealth({
  lookupNumber,
  buckets = [],
  formatKeys = { audio: [], video: [] },
  downloadData = {},
} = {}) {
  const normalizedLookup = toText(lookupNumber);
  const importedSegments = asArray(downloadData?.importedSegments).map((segment) => ({
    ...segment,
    bucket: toText(segment?.bucket).toUpperCase(),
    bucketNumber: toText(segment?.bucketNumber),
    type: toText(segment?.type).toLowerCase(),
    availableTypes: asArray(segment?.availableTypes)
      .map((item) => toText(item).toLowerCase())
      .filter(Boolean),
    fileId: toText(segment?.fileId),
    r2Key: toText(segment?.r2Key),
    mime: toText(segment?.mime),
    driveFileId: toText(segment?.driveFileId),
    enabled: segment?.enabled !== false,
  }));
  const enabledSegments = importedSegments.filter((segment) => segment.enabled);
  const importSummary = downloadData?.importSummary && typeof downloadData.importSummary === 'object'
    ? downloadData.importSummary
    : {};
  const rootFolderUrl = toText(importSummary.rootFolderUrl);
  const bucketFolderUrls = importSummary.bucketFolderUrls && typeof importSummary.bucketFolderUrls === 'object'
    ? importSummary.bucketFolderUrls
    : {};
  const selectedBuckets = asArray(buckets).map((bucket) => toText(bucket).toUpperCase()).filter(Boolean);
  const activeBuckets = Array.from(new Set(enabledSegments.map((segment) => segment.bucket).filter(Boolean)));
  const allBuckets = Array.from(new Set([...selectedBuckets, ...activeBuckets])).sort();

  const criticalIssues = [];
  const warnIssues = [];
  const bundleRows = [];

  if (!rootFolderUrl) {
    criticalIssues.push('Recording index root folder link (A1) is missing.');
  }

  const bucketsView = allBuckets.map((bucket) => {
    const bucketSegments = enabledSegments.filter((segment) => segment.bucket === bucket);
    const folderUrl = toText(bucketFolderUrls[bucket]);
    const active = bucketSegments.length > 0;
    if (active && !folderUrl) {
      criticalIssues.push(`Bucket ${bucket} folder link is missing (${bucket === 'X' ? 'F2' : `${bucket}2`}).`);
    }
    const unknownTypes = bucketSegments.filter((segment) => segment.type === 'unknown').length;
    if (unknownTypes > 0) {
      warnIssues.push(`Bucket ${bucket} has ${unknownTypes} file(s) with unknown media type.`);
    }
    const missingDriveIds = bucketSegments.filter((segment) => !isPdfLike(segment) && !segment.driveFileId).length;
    if (missingDriveIds > 0) {
      warnIssues.push(`Bucket ${bucket} has ${missingDriveIds} non-PDF file(s) without Drive IDs.`);
    }
    return {
      bucket,
      active,
      folderUrl,
      folderLinkOk: Boolean(folderUrl),
      fileCount: bucketSegments.length,
      audioCount: bucketSegments.filter((segment) => segmentSupportsType(segment, 'audio')).length,
      videoCount: bucketSegments.filter((segment) => segmentSupportsType(segment, 'video')).length,
      unknownCount: unknownTypes,
    };
  });

  if (enabledSegments.length === 0) {
    criticalIssues.push('No enabled files imported from recording index.');
  }

  for (const bucket of allBuckets) {
    const bucketSegments = enabledSegments.filter((segment) => segment.bucket === bucket);
    const hasAudio = bucketSegments.some((segment) => segmentSupportsType(segment, 'audio'));
    const hasVideo = bucketSegments.some((segment) => segmentSupportsType(segment, 'video'));
    for (const [type, keys] of [['audio', asArray(formatKeys?.audio)], ['video', asArray(formatKeys?.video)]]) {
      const hasType = type === 'audio' ? hasAudio : hasVideo;
      for (const formatKey of keys) {
        const tokenRaw = toText(downloadData?.[type]?.[bucket]?.[formatKey]);
        const expectedValue = normalizedLookup ? `lookup:${normalizedLookup}:${bucket}:${type}` : '';
        const parsed = parseToken(tokenRaw, {
          allowedKinds: ['bundle'],
          context: `${type} ${bucket}/${formatKey}`,
        });
        const tokenValue = toText(parsed.parsed?.value || '');
        const prefix = expectedValue.toLowerCase();
        const prefixOk = !hasType || (parsed.ok && tokenValue.toLowerCase() === prefix);
        if (hasType && !tokenRaw) {
          criticalIssues.push(`Missing bundle token for ${type} ${bucket}/${formatKey}.`);
        } else if (hasType && !parsed.ok) {
          criticalIssues.push(`Invalid bundle token for ${type} ${bucket}/${formatKey}: ${parsed.error}`);
        } else if (hasType && !prefixOk) {
          criticalIssues.push(`Bundle token mismatch for ${type} ${bucket}/${formatKey} (expected bundle:${expectedValue}).`);
        }
        bundleRows.push({
          bucket,
          type,
          formatKey,
          hasSegments: hasType,
          tokenRaw,
          expected: expectedValue ? `bundle:${expectedValue}` : '',
          ok: hasType ? prefixOk : true,
          issue: hasType && !prefixOk ? 'mismatch' : '',
        });
      }
    }
    if (selectedBuckets.includes(bucket) && bucketSegments.length === 0) {
      warnIssues.push(`Selected bucket ${bucket} has no enabled files.`);
    }
  }

  const pdfToken = parseToken(downloadData?.recordingIndexPdfRef, {
    allowedKinds: ['lookup', 'asset'],
    context: 'Recording index PDF token',
  });
  const bundleToken = parseToken(downloadData?.recordingIndexBundleRef, {
    allowedKinds: ['bundle'],
    context: 'Recording index bundle token',
  });

  if (!pdfToken.raw) {
    criticalIssues.push('Recording index PDF token is missing.');
  } else if (!pdfToken.ok) {
    criticalIssues.push(`Recording index PDF token is invalid: ${pdfToken.error}`);
  }

  if (!bundleToken.raw) {
    criticalIssues.push('Recording index bundle token is missing.');
  } else if (!bundleToken.ok) {
    criticalIssues.push(`Recording index bundle token is invalid: ${bundleToken.error}`);
  } else if (normalizedLookup) {
    const expectedBundle = `recording-index:${normalizedLookup}:all`.toLowerCase();
    const actual = toText(bundleToken.parsed?.value).toLowerCase();
    if (actual !== expectedBundle) {
      criticalIssues.push(`Recording index bundle token mismatch (expected bundle:${expectedBundle}).`);
    }
  }

  const filesView = importedSegments.map((segment) => {
    const warnings = [];
    if (!segment.enabled) warnings.push('disabled');
    if (segment.type === 'unknown') warnings.push('unknown type');
    if (!isPdfLike(segment) && !segment.driveFileId) warnings.push('missing drive id');
    return {
      bucket: segment.bucket,
      bucketNumber: segment.bucketNumber,
      fileId: segment.fileId,
      type: segment.type || 'unknown',
      subtype: inferSubtype(segment),
      mime: segment.mime,
      r2Key: segment.r2Key,
      driveFileIdPresent: Boolean(segment.driveFileId),
      enabled: segment.enabled,
      availableTypes: Array.isArray(segment.availableTypes) ? segment.availableTypes.slice() : [],
      warning: warnings.join(', '),
    };
  });
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
  for (const file of filesView) {
    const physicalFamily = file.type === 'audio' || file.type === 'video' || file.type === 'pdf'
      ? file.type
      : 'unknown';
    physicalTypeCounts[physicalFamily] += 1;
    const available = Array.isArray(file.availableTypes) ? file.availableTypes : [];
    if (available.length > 0) {
      let supported = 0;
      for (const mediaType of available) {
        if (!Object.prototype.hasOwnProperty.call(associatedTypeCounts, mediaType)) continue;
        associatedTypeCounts[mediaType] += 1;
        supported += 1;
      }
      if (supported === 0) associatedTypeCounts.unknown += 1;
    } else {
      associatedTypeCounts[physicalFamily] += 1;
    }
    subtypeCounts.set(file.subtype || 'unknown', Number(subtypeCounts.get(file.subtype || 'unknown') || 0) + 1);
  }

  const summary = {
    criticalCount: criticalIssues.length,
    warnCount: warnIssues.length,
    ok: criticalIssues.length === 0,
    totalFiles: importedSegments.length,
    enabledFiles: enabledSegments.length,
    bucketCount: allBuckets.length,
    bundleRows: bundleRows.length,
  };

  return {
    root: {
      folderUrl: rootFolderUrl,
      ok: Boolean(rootFolderUrl),
    },
    buckets: bucketsView,
    files: filesView,
    bundles: bundleRows,
    associatedTypeCounts,
    physicalTypeCounts,
    subtypeCounts: Array.from(subtypeCounts.entries())
      .map(([subtype, count]) => ({ subtype, count }))
      .sort((a, b) => b.count - a.count || a.subtype.localeCompare(b.subtype)),
    recordingIndex: {
      pdf: pdfToken,
      bundle: bundleToken,
    },
    criticalIssues,
    warnIssues,
    summary,
  };
}
