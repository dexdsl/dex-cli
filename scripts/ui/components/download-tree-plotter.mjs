import React from 'react';
import { Box, Text } from 'ink';

function toText(value) {
  return String(value == null ? '' : value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bar(value, total, width = 14, fill = '█', empty = '·') {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeValue = Math.max(0, Number(value) || 0);
  const ratio = clamp(safeValue / safeTotal, 0, 1);
  const filled = Math.round(ratio * width);
  return `${fill.repeat(filled)}${empty.repeat(Math.max(0, width - filled))}`;
}

function trunc(text, width) {
  const value = toText(text);
  if (!Number.isFinite(width) || width <= 3) return value;
  if (value.length <= width) return value;
  return `${value.slice(0, width - 1)}…`;
}

function renderBundleCell(label, state) {
  if (!state?.present) return `${label} ·`;
  return `${label} ${state.ok ? '✓' : '!'}`;
}

export function DownloadTreePlotter({
  model,
  width = 40,
  maxBucketRows = 8,
  maxSubtypeRows = 6,
  maxIssueRows = 3,
}) {
  const summary = model?.summary || {};
  const buckets = Array.isArray(model?.buckets) ? model.buckets : [];
  const associatedTypes = model?.associatedTypes || { families: [], subtypes: [] };
  const associatedFamilies = Array.isArray(associatedTypes.families) ? associatedTypes.families : [];
  const subtypes = Array.isArray(associatedTypes.subtypes) ? associatedTypes.subtypes : [];
  const physicalTypes = model?.physicalTypes || { families: [] };
  const physicalFamilies = Array.isArray(physicalTypes.families) ? physicalTypes.families : [];
  const bundles = Array.isArray(model?.bundleRows) ? model.bundleRows : [];
  const critical = Array.isArray(model?.criticalIssues) ? model.criticalIssues : [];
  const warns = Array.isArray(model?.warnIssues) ? model.warnIssues : [];

  const availableWidth = Math.max(24, width - 4);
  const maxAssociatedFamily = Math.max(1, ...associatedFamilies.map((row) => Number(row.count) || 0));
  const maxPhysicalFamily = Math.max(1, ...physicalFamilies.map((row) => Number(row.count) || 0));
  const maxBucketCount = Math.max(1, ...buckets.map((row) => Number(row.fileCount) || 0));

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Text, { color: '#d0d5df' }, trunc(model?.title || 'Download tree', availableWidth)),
    React.createElement(Text, { color: summary.criticalCount > 0 ? '#ff6b6b' : '#a6e3a1' },
      trunc(`health c=${summary.criticalCount || 0} w=${summary.warnCount || 0} files=${summary.enabledFiles || 0}/${summary.totalFiles || 0}`, availableWidth),
    ),
    React.createElement(Text, { color: '#8f98a8' }, trunc(`root ${model?.root?.ok ? 'ok' : 'missing'} · buckets ${summary.bucketCount || buckets.length}`, availableWidth)),
    React.createElement(Text, { color: '#8f98a8' }, trunc(`severity ${bar(summary.criticalCount || 0, Math.max(1, (summary.criticalCount || 0) + (summary.warnCount || 0), 1), 16, '■', '·')}`, availableWidth)),

    React.createElement(Text, { color: '#d0d5df' }, 'associated types'),
    ...associatedFamilies.map((row) => React.createElement(Text, {
      key: `fam-${row.key}`,
      color: row.key === 'unknown' && row.count > 0 ? '#ffcc66' : '#8f98a8',
    }, trunc(`${row.label.padEnd(7, ' ')} ${String(row.count).padStart(3, ' ')} ${bar(row.count, maxAssociatedFamily, 12)}`, availableWidth))),
    subtypes.length
      ? React.createElement(Text, { color: '#8f98a8' }, 'subtypes')
      : null,
    ...subtypes.slice(0, maxSubtypeRows).map((row) => React.createElement(Text, {
      key: `sub-${row.key}`,
      color: '#8f98a8',
    }, trunc(`· ${row.label}: ${row.count}`, availableWidth))),
    subtypes.length > maxSubtypeRows
      ? React.createElement(Text, { color: '#8f98a8' }, `+${subtypes.length - maxSubtypeRows} more subtype rows`)
      : null,

    React.createElement(Text, { color: '#d0d5df' }, 'physical files'),
    ...physicalFamilies.map((row) => React.createElement(Text, {
      key: `pfam-${row.key}`,
      color: row.key === 'unknown' && row.count > 0 ? '#ffcc66' : '#8f98a8',
    }, trunc(`${row.label.padEnd(7, ' ')} ${String(row.count).padStart(3, ' ')} ${bar(row.count, maxPhysicalFamily, 12)}`, availableWidth))),

    React.createElement(Text, { color: '#d0d5df' }, 'buckets'),
    ...buckets.slice(0, maxBucketRows).map((row) => React.createElement(Text, {
      key: `bucket-${row.bucket}`,
      color: row.folderLinkOk ? '#8f98a8' : '#ffcc66',
    }, trunc(`${row.bucket} ${String(row.fileCount).padStart(3, ' ')} ${bar(row.fileCount, maxBucketCount, 10)} a${row.audioCount || 0} v${row.videoCount || 0} p${row.pdfCount || 0}${row.folderLinkOk ? '' : ' !'}`, availableWidth))),
    buckets.length > maxBucketRows
      ? React.createElement(Text, { color: '#8f98a8' }, `+${buckets.length - maxBucketRows} more bucket rows`)
      : null,

    React.createElement(Text, { color: '#d0d5df' }, 'bundles'),
    ...bundles.slice(0, maxBucketRows).map((row) => React.createElement(Text, {
      key: `bundle-${row.bucket}`,
      color: '#8f98a8',
    }, trunc(`${row.bucket} ${renderBundleCell('A', row.audio)} ${renderBundleCell('V', row.video)} ${renderBundleCell('P', row.pdf)}`, availableWidth))),
    bundles.length > maxBucketRows
      ? React.createElement(Text, { color: '#8f98a8' }, `+${bundles.length - maxBucketRows} more bundle rows`)
      : null,

    React.createElement(Text, { color: '#d0d5df' }, 'recording index'),
    React.createElement(Text, { color: model?.recording?.pdf?.ok ? '#a6e3a1' : '#ffcc66' }, trunc(`pdf ${model?.recording?.pdf?.ok ? '✓' : '!'} ${toText(model?.recording?.pdf?.label || '').slice(0, 40)}`, availableWidth)),
    React.createElement(Text, { color: model?.recording?.bundle?.ok ? '#a6e3a1' : '#ffcc66' }, trunc(`bundle ${model?.recording?.bundle?.ok ? '✓' : '!'} ${toText(model?.recording?.bundle?.label || '').slice(0, 40)}`, availableWidth)),

    critical.length ? React.createElement(Text, { color: '#ff6b6b' }, 'critical') : null,
    ...critical.slice(0, maxIssueRows).map((issue) => React.createElement(Text, { key: `critical-${issue}`, color: '#ff6b6b' }, trunc(`• ${issue}`, availableWidth))),
    critical.length > maxIssueRows
      ? React.createElement(Text, { color: '#ff6b6b' }, `+${critical.length - maxIssueRows} more critical`)
      : null,
    warns.length ? React.createElement(Text, { color: '#ffcc66' }, 'warnings') : null,
    ...warns.slice(0, maxIssueRows).map((issue) => React.createElement(Text, { key: `warn-${issue}`, color: '#ffcc66' }, trunc(`• ${issue}`, availableWidth))),
    warns.length > maxIssueRows
      ? React.createElement(Text, { color: '#ffcc66' }, `+${warns.length - maxIssueRows} more warnings`)
      : null,
  );
}
