import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import {
  buildProtectedAssetsPayload,
  diffProtectedAssets,
  ensureProtectedAssetsBucket,
  publishProtectedAssets,
  readProtectedAssetsFile,
  validateCatalogLookupCoverage,
} from '../lib/protected-assets-publisher.mjs';

function safeMessage(error) {
  if (!error) return 'Unknown error';
  return error?.message || String(error);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shortHash(value) {
  const hash = String(value || '').trim();
  return hash ? hash.slice(0, 12) : 'none';
}

export function ProtectedAssetsManager({ onExit, width = 100, height = 24 }) {
  const [data, setData] = useState(null);
  const [filePath, setFilePath] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading protected assets manifest…');
  const [coverageInfo, setCoverageInfo] = useState(null);

  const lookups = useMemo(() => (Array.isArray(data?.lookups) ? data.lookups : []), [data]);
  const selectedLookup = lookups[selectedIndex] || null;

  const reload = useCallback(async ({ keepLookup } = {}) => {
    setBusy(true);
    try {
      const loaded = await readProtectedAssetsFile();
      setData(loaded.data);
      setFilePath(loaded.filePath);
      if (loaded.data.lookups.length > 0) {
        const found = keepLookup
          ? loaded.data.lookups.findIndex((lookup) => lookup.lookupNumber === keepLookup)
          : -1;
        setSelectedIndex(found >= 0 ? found : 0);
      } else {
        setSelectedIndex(0);
      }
      const built = buildProtectedAssetsPayload(loaded.data);
      const coverage = await validateCatalogLookupCoverage({
        assetsData: loaded.data,
        catalogFilePath: process.env.DEX_CATALOG_EDITORIAL_PATH,
      });
      setCoverageInfo(coverage);
      setStatusLine(`Loaded manifest: lookups=${built.counts.lookups} files=${built.counts.files} entitlements=${built.counts.entitlements} hash=${shortHash(built.manifestHash)} active=${coverage.activeCount} missing=${coverage.missing.length}`);
    } catch (error) {
      setStatusLine(`Load failed: ${safeMessage(error)}`);
      setData(null);
      setCoverageInfo(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const runValidate = useCallback(async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const built = buildProtectedAssetsPayload(data);
      const coverage = await validateCatalogLookupCoverage({
        assetsData: data,
        catalogFilePath: process.env.DEX_CATALOG_EDITORIAL_PATH,
      });
      setCoverageInfo(coverage);
      if (!coverage.ok) {
        setStatusLine(`Validation failed: missing mappings for ${coverage.missing.join(', ')}`);
      } else {
        const exempted = Array.isArray(coverage.exempted) && coverage.exempted.length
          ? ` exemptions(active)=${coverage.exempted.join(',')}`
          : '';
        setStatusLine(`Manifest valid: lookups=${built.counts.lookups} files=${built.counts.files} entitlements=${built.counts.entitlements} hash=${shortHash(built.manifestHash)} active=${coverage.activeCount}${exempted}`);
      }
    } catch (error) {
      setStatusLine(`Validation failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, data]);

  const runDiff = useCallback(async (env) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await diffProtectedAssets({ env });
      setStatusLine(`Diff ${result.env}: lookups +${result.lookups.added}/-${result.lookups.removed}/~${result.lookups.changed} · files +${result.files.added}/-${result.files.removed}/~${result.files.changed} · hash ${shortHash(result.localHash)} vs ${shortHash(result.remoteHash)}`);
    } catch (error) {
      setStatusLine(`Diff ${env} failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const runPublish = useCallback(async (env) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await publishProtectedAssets({ env });
      setStatusLine(`Published ${result.env}: lookups=${result.counts.lookups} files=${result.counts.files} entitlements=${result.counts.entitlements} hash=${shortHash(result.manifestHash)}`);
    } catch (error) {
      setStatusLine(`Publish ${env} failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const runEnsureBucket = useCallback(async (env) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ensureProtectedAssetsBucket({ env });
      setStatusLine(`Bucket ensure ${result.env}: ${result.bucket}`);
    } catch (error) {
      setStatusLine(`Bucket ensure ${env} failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!lookups.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((previous) => clamp(previous, 0, lookups.length - 1));
  }, [lookups.length]);

  useInput((input, key) => {
    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((previous) => clamp(previous - 1, 0, Math.max(0, lookups.length - 1)));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((previous) => clamp(previous + 1, 0, Math.max(0, lookups.length - 1)));
      return;
    }

    if (busy) return;

    const lower = String(input || '').toLowerCase();
    if (lower === 'r') { void reload({ keepLookup: selectedLookup?.lookupNumber }); return; }
    if (lower === 'v') { void runValidate(); return; }
    if (lower === 'd') { void runDiff('test'); return; }
    if (lower === 'f') { void runDiff('prod'); return; }
    if (lower === 'p') { void runPublish('test'); return; }
    if (lower === 'o') { void runPublish('prod'); return; }
    if (lower === 'b') { void runEnsureBucket('test'); return; }
    if (lower === 'n') { void runEnsureBucket('prod'); }
  });

  const listWindow = computeWindow({
    total: lookups.length,
    cursor: selectedIndex,
    height: Math.max(4, Math.min(14, height - 10)),
  });

  return React.createElement(Box, { flexDirection: 'column', width, height, minHeight: height },
    React.createElement(Text, { bold: true, color: '#d0d5df' }, 'Protected Assets Manager'),
    React.createElement(Text, { color: '#8f98a8' }, filePath || 'data/protected.assets.json'),
    React.createElement(Box, { marginTop: 1, flexDirection: 'row', gap: 2 },
      React.createElement(Box, { flexDirection: 'column', minWidth: 52, width: Math.min(74, Math.floor(width * 0.58)) },
        React.createElement(Text, { color: '#8f98a8' }, 'Lookups'),
        listWindow.start > 0 ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
        ...lookups.slice(listWindow.start, listWindow.end).map((lookup, localIndex) => {
          const index = listWindow.start + localIndex;
          const line = `${lookup.lookupNumber}  files:${lookup.files.length}  status:${lookup.status}`;
          return React.createElement(Text, index === selectedIndex ? { key: lookup.lookupNumber, inverse: true } : { key: lookup.lookupNumber, color: '#d0d5df' }, line);
        }),
        !lookups.length ? React.createElement(Text, { color: '#8f98a8' }, 'No lookup rows configured yet.') : null,
        listWindow.end < lookups.length ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
      ),
      React.createElement(Box, { flexDirection: 'column', flexGrow: 1 },
        React.createElement(Text, { color: '#8f98a8' }, 'Details'),
        selectedLookup
          ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, {}, `Lookup: ${selectedLookup.lookupNumber}`),
            React.createElement(Text, {}, `Title: ${selectedLookup.title}`),
            React.createElement(Text, {}, `Season: ${selectedLookup.season || '-'}`),
            React.createElement(Text, {}, `Status: ${selectedLookup.status}`),
            React.createElement(Text, {}, `Files: ${selectedLookup.files.length}`),
            React.createElement(Text, {}, `Entitlements: ${selectedLookup.entitlements.length}`),
            ...selectedLookup.files.slice(0, 6).map((file) => React.createElement(Text, { key: `${selectedLookup.lookupNumber}:${file.bucketNumber}`, color: '#8f98a8' }, `  ${file.bucketNumber} → ${file.r2Key}`)),
            selectedLookup.files.length > 6
              ? React.createElement(Text, { color: '#6e7688' }, `  … ${selectedLookup.files.length - 6} more files`)
              : null,
          )
          : React.createElement(Text, { color: '#8f98a8' }, 'Select a lookup row.'),
      ),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      React.createElement(Text, { color: '#8f98a8' }, 'v validate  d diff(test)  f diff(prod)  p publish(test)  o publish(prod)  b ensure bucket(test)  n ensure bucket(prod)  r reload  Esc back'),
      coverageInfo
        ? React.createElement(
          Text,
          { color: coverageInfo.ok ? '#8f98a8' : '#ff6b6b' },
          `coverage active=${coverageInfo.activeCount} mapped=${coverageInfo.mappedCount} exempt=${coverageInfo.exemptCount} missing=${coverageInfo.missing.length}`,
        )
        : null,
      React.createElement(Text, { color: busy ? '#ffcc66' : '#a6e3a1' }, busy ? 'Working…' : statusLine),
    ),
  );
}
