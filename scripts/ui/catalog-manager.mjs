import fs from 'node:fs/promises';
import path from 'node:path';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import {
  readCatalogEditorialFile,
  setCatalogSpotlight,
  upsertCatalogManifestEntry,
  writeCatalogEditorialFile,
} from '../lib/catalog-editorial-store.mjs';
import {
  readCatalogEditorialSource,
  diffCatalogCuration,
  publishCatalogCuration,
  pullCatalogCuration,
  writeCatalogSnapshotFromLocal,
} from '../lib/catalog-publisher.mjs';

const ROOT = process.cwd();
const CATALOG_ENTRIES_PATH = path.join(ROOT, 'data', 'catalog.entries.json');
const PROD_CONFIRMATION_PHRASE = 'PUBLISH PROD';

function toText(value) {
  return String(value || '').trim();
}

function normalizeHref(value) {
  const raw = toText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.pathname.startsWith('/entry/')) return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
      return raw;
    } catch {
      return raw;
    }
  }
  if (raw.startsWith('/entry/')) return raw.endsWith('/') ? raw : `${raw}/`;
  return raw;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeMessage(error) {
  return error?.message || String(error || 'Unknown error');
}

async function readCatalogEntries() {
  const text = await fs.readFile(CATALOG_ENTRIES_PATH, 'utf8');
  const raw = JSON.parse(text);
  return Array.isArray(raw?.entries) ? raw.entries : [];
}

function resolveEntry(entries = [], token) {
  const needle = toText(token).toLowerCase();
  if (!needle) return null;
  return entries.find((entry) => {
    const id = toText(entry?.id).toLowerCase();
    const href = normalizeHref(entry?.entry_href).toLowerCase();
    const slug = href.replace(/^\/entry\//, '').replace(/\/$/, '');
    return id === needle || href === normalizeHref(needle).toLowerCase() || slug === needle;
  }) || null;
}

export function CatalogManager({ onExit, width = 100, height = 24 }) {
  const [data, setData] = useState(null);
  const [fullRows, setFullRows] = useState([]);
  const [viewMode, setViewMode] = useState('full');
  const [filePath, setFilePath] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading catalog control plane…');
  const [inputMode, setInputMode] = useState('');
  const [inputValue, setInputValue] = useState('');

  const rows = useMemo(() => {
    if (viewMode === 'staged') return Array.isArray(data?.manifest) ? data.manifest : [];
    return Array.isArray(fullRows) ? fullRows : [];
  }, [data, fullRows, viewMode]);
  const selected = rows[selectedIndex] || null;
  const stagedCount = Array.isArray(data?.manifest) ? data.manifest.length : 0;
  const fullCount = Array.isArray(fullRows) ? fullRows.length : 0;

  const withCounts = useCallback((message) => {
    const base = toText(message);
    const viewLabel = `view=${viewMode} full=${fullCount} staged=${stagedCount}`;
    return base ? `${base} | ${viewLabel}` : viewLabel;
  }, [fullCount, stagedCount, viewMode]);

  const applyLoadedSource = useCallback((loaded, keepEntryId) => {
    const stagedRows = Array.isArray(loaded?.data?.manifest) ? loaded.data.manifest : [];
    const allRows = Array.isArray(loaded?.built?.payload?.snapshot?.manifest) ? loaded.built.payload.snapshot.manifest : [];
    setData(loaded.data);
    setFilePath(loaded.filePath);
    setFullRows(allRows);

    const activeRows = viewMode === 'staged' ? stagedRows : allRows;
    if (!activeRows.length) {
      setSelectedIndex(0);
      return { stagedCount: stagedRows.length, fullCount: allRows.length };
    }
    const idx = keepEntryId
      ? activeRows.findIndex((row) => String(row.entry_id) === String(keepEntryId))
      : -1;
    setSelectedIndex(idx >= 0 ? idx : 0);
    return { stagedCount: stagedRows.length, fullCount: allRows.length };
  }, [viewMode]);

  const reload = useCallback(async ({ keepEntryId } = {}) => {
    setBusy(true);
    try {
      const loaded = await readCatalogEditorialSource();
      applyLoadedSource(loaded, keepEntryId);
      setStatusLine(withCounts(`Loaded rows.`));
    } catch (error) {
      setStatusLine(withCounts(`Load failed: ${safeMessage(error)}`));
    } finally {
      setBusy(false);
    }
  }, [applyLoadedSource, withCounts]);

  const persist = useCallback(async (next, message, keepEntryId) => {
    setBusy(true);
    try {
      const written = await writeCatalogEditorialFile(next);
      await writeCatalogSnapshotFromLocal();
      const loaded = await readCatalogEditorialSource(written.filePath);
      applyLoadedSource(loaded, keepEntryId);
      setStatusLine(withCounts(message));
    } catch (error) {
      setStatusLine(withCounts(`${message} failed: ${safeMessage(error)}`));
    } finally {
      setBusy(false);
    }
  }, [applyLoadedSource, withCounts]);

  const stageByToken = useCallback(async (token) => {
    if (!data) return;
    setBusy(true);
    try {
      const entries = await readCatalogEntries();
      const resolved = resolveEntry(entries, token);
      if (!resolved) throw new Error(`Entry not found in catalog.entries.json: ${token}`);

      const patch = {
        entry_id: toText(resolved.id),
        entry_href: normalizeHref(resolved.entry_href),
        title_raw: toText(resolved.title_raw),
        lookup_number: toText(resolved.lookup_raw),
        season: toText(resolved.season),
        performer: toText(resolved.performer_raw),
        instrument: Array.isArray(resolved.instrument_labels) && resolved.instrument_labels.length
          ? toText(resolved.instrument_labels[0])
          : '',
        status: 'active',
      };

      const next = upsertCatalogManifestEntry(data, patch);
      const written = await writeCatalogEditorialFile(next);
      await writeCatalogSnapshotFromLocal();
      const loaded = await readCatalogEditorialSource(written.filePath);
      applyLoadedSource(loaded, patch.entry_id);
      setStatusLine(withCounts(`Staged ${patch.entry_id}`));
    } catch (error) {
      setStatusLine(withCounts(`Stage failed: ${safeMessage(error)}`));
    } finally {
      setBusy(false);
    }
  }, [applyLoadedSource, data, withCounts]);

  const setSpotlight = useCallback(async () => {
    if (!data || !selected || busy) return;
    const next = setCatalogSpotlight(data, {
      entry_id: selected.entry_id,
      cta_label_raw: toText(data?.spotlight?.cta_label_raw || 'VIEW COLLECTION'),
      headline_raw: toText(data?.spotlight?.headline_raw || 'ARTIST SPOTLIGHT'),
    });
    await persist(next, `Spotlight set to ${selected.entry_id}`, selected.entry_id);
  }, [busy, data, persist, selected]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((previous) => clamp(previous, 0, rows.length - 1));
  }, [rows.length]);

  useInput((input, key) => {
    if (inputMode) {
      if (key.escape) {
        setInputMode('');
        setInputValue('');
        setStatusLine(withCounts('Cancelled.'));
        return;
      }
      if (key.return) {
        const next = toText(inputValue);
        if (inputMode === 'stage' && next) {
          setInputMode('');
          setInputValue('');
          void stageByToken(next);
          return;
        }
        if (inputMode === 'publish-prod-confirm') {
            setInputMode('');
            setInputValue('');
            if (next !== PROD_CONFIRMATION_PHRASE) {
            setStatusLine(withCounts(`Prod publish cancelled. Type exactly: ${PROD_CONFIRMATION_PHRASE}`));
            return;
          }
          void (async () => {
            setBusy(true);
            try {
              const result = await publishCatalogCuration({ env: 'prod', dryRun: false });
              await writeCatalogSnapshotFromLocal();
              setStatusLine(withCounts(`Published catalog to prod (${result.manifestHash.slice(0, 12)}).`));
            } catch (error) {
              setStatusLine(withCounts(`Publish prod failed: ${safeMessage(error)}`));
            } finally {
              setBusy(false);
            }
          })();
          return;
        }
        return;
      }
      if (isBackspaceKey(input, key) || key.delete) {
        setInputValue((previous) => previous.slice(0, -1));
        return;
      }
      if (shouldAppendWizardChar(input, key)) {
        setInputValue((previous) => previous + input);
      }
      return;
    }

    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((previous) => clamp(previous - 1, 0, Math.max(0, rows.length - 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((previous) => clamp(previous + 1, 0, Math.max(0, rows.length - 1)));
      return;
    }

    if (busy) return;

    const lower = String(input || '').toLowerCase();
    if (lower === 'r') { void reload({ keepEntryId: selected?.entry_id }); return; }
    if (lower === 'm') {
      const nextMode = viewMode === 'full' ? 'staged' : 'full';
      const keepEntryId = selected?.entry_id;
      setViewMode(nextMode);
      const nextRows = nextMode === 'staged'
        ? (Array.isArray(data?.manifest) ? data.manifest : [])
        : (Array.isArray(fullRows) ? fullRows : []);
      if (nextRows.length) {
        const idx = keepEntryId ? nextRows.findIndex((row) => String(row.entry_id) === String(keepEntryId)) : -1;
        setSelectedIndex(idx >= 0 ? idx : 0);
      } else {
        setSelectedIndex(0);
      }
      setStatusLine(withCounts(`Switched view to ${nextMode} rows.`));
      return;
    }
    if (lower === 'a') { setInputMode('stage'); setInputValue(''); return; }
    if (lower === 's') { void setSpotlight(); return; }
    if (lower === 'v') {
      void (async () => {
        setBusy(true);
        try {
          await writeCatalogSnapshotFromLocal();
          setStatusLine(withCounts('Catalog validate + snapshot passed.'));
        } catch (error) {
          setStatusLine(withCounts(`Catalog validate failed: ${safeMessage(error)}`));
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    if (lower === 'd' || lower === 'f') {
      const env = lower === 'f' ? 'prod' : 'test';
      void (async () => {
        setBusy(true);
        try {
          const result = await diffCatalogCuration({ env });
          setStatusLine(withCounts(`Diff ${env}: +${result.manifest.added} -${result.manifest.removed} ~${result.manifest.changed} spotlight=${result.spotlightChanged ? 'changed' : 'same'}`));
        } catch (error) {
          setStatusLine(withCounts(`Diff ${env} failed: ${safeMessage(error)}`));
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    if (lower === 'p') {
      void (async () => {
        setBusy(true);
        try {
          const result = await publishCatalogCuration({ env: 'test', dryRun: false });
          await writeCatalogSnapshotFromLocal();
          setStatusLine(withCounts(`Published catalog test (${result.manifestHash.slice(0, 12)}).`));
        } catch (error) {
          setStatusLine(withCounts(`Publish test failed: ${safeMessage(error)}`));
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    if (lower === 'o') {
      setInputMode('publish-prod-confirm');
      setInputValue('');
      setStatusLine(withCounts(`Type ${PROD_CONFIRMATION_PHRASE} and press Enter to publish PROD.`));
      return;
    }
    if (lower === 'l' || lower === 'k') {
      const env = lower === 'k' ? 'prod' : 'test';
      void (async () => {
        setBusy(true);
        try {
          await pullCatalogCuration({ env, writeLocal: true });
          const loaded = await readCatalogEditorialSource();
          applyLoadedSource(loaded, selected?.entry_id);
          setStatusLine(withCounts(`Pulled catalog state from ${env}.`));
        } catch (error) {
          setStatusLine(withCounts(`Pull ${env} failed: ${safeMessage(error)}`));
        } finally {
          setBusy(false);
        }
      })();
    }
  }, [applyLoadedSource, busy, data, fullRows, inputMode, onExit, reload, rows.length, selected, setSpotlight, stageByToken, viewMode, withCounts]);

  const listWindow = computeWindow({
    total: rows.length,
    cursor: selectedIndex,
    height: Math.max(6, Math.min(16, height - 12)),
  });

  const warning = 'LIVE / CRITICAL / SENSITIVE INFRASTRUCTURE';

  return React.createElement(Box, { flexDirection: 'column', width, height, minHeight: height },
    React.createElement(Text, { bold: true, color: '#d0d5df' }, 'Catalog Manager'),
    React.createElement(Text, { color: '#ff6b6b' }, warning),
    React.createElement(Text, { color: '#8f98a8' }, filePath || 'data/catalog.editorial.json'),
    React.createElement(Box, { marginTop: 1, flexDirection: 'row', gap: 2 },
      React.createElement(Box, { flexDirection: 'column', minWidth: 54, width: Math.min(72, Math.floor(width * 0.62)) },
        React.createElement(Text, { color: '#8f98a8' }, `Rows (${viewMode})${viewMode === 'staged' ? ' [FILTERED]' : ''}`),
        listWindow.start > 0 ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
        ...rows.slice(listWindow.start, listWindow.end).map((row, localIndex) => {
          const index = listWindow.start + localIndex;
          const line = `${row.entry_id}  ${row.lookup_number || '-'}  ${row.status || 'active'}`;
          return React.createElement(Text, index === selectedIndex ? { key: `${row.entry_id}-${index}`, inverse: true } : { key: `${row.entry_id}-${index}`, color: '#d0d5df' }, line);
        }),
        !rows.length ? React.createElement(Text, { color: '#8f98a8' }, `No ${viewMode} rows yet.`) : null,
        listWindow.end < rows.length ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
      ),
      React.createElement(Box, { flexDirection: 'column', flexGrow: 1 },
        React.createElement(Text, { color: '#8f98a8' }, 'Details'),
        selected
          ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, {}, `ID: ${selected.entry_id}`),
            React.createElement(Text, {}, `Href: ${selected.entry_href || '-'}`),
            React.createElement(Text, {}, `Lookup: ${selected.lookup_number || '-'}`),
            React.createElement(Text, {}, `Season: ${selected.season || '-'}`),
            React.createElement(Text, {}, `Performer: ${selected.performer || '-'}`),
            React.createElement(Text, {}, `Instrument: ${selected.instrument || '-'}`),
            React.createElement(Text, {}, `Status: ${selected.status || 'active'}`),
          )
          : React.createElement(Text, { color: '#8f98a8' }, 'Select a manifest row.'),
        React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
          React.createElement(Text, { color: '#8f98a8' }, 'Spotlight'),
          React.createElement(Text, {}, `Entry: ${toText(data?.spotlight?.entry_id) || '-'}`),
          React.createElement(Text, {}, `Headline: ${toText(data?.spotlight?.headline_raw) || 'ARTIST SPOTLIGHT'}`),
          React.createElement(Text, {}, `CTA: ${toText(data?.spotlight?.cta_label_raw) || 'VIEW COLLECTION'}`),
        ),
      ),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      inputMode
        ? React.createElement(Text, { color: '#ffcc66' }, inputMode === 'stage'
          ? `Stage entry token (slug/href/id): ${inputValue}`
          : `Confirm PROD publish. Type '${PROD_CONFIRMATION_PHRASE}': ${inputValue}`)
        : React.createElement(Text, { color: '#8f98a8' }, 'm toggle(full/staged)  a stage  s spotlight  v validate  d diff(test)  f diff(prod)  p publish(test)  o publish(prod)  l pull(test)  k pull(prod)  r reload  Esc back'),
      React.createElement(Text, { color: busy ? '#ffcc66' : '#a6e3a1' }, busy ? 'Working…' : statusLine),
    ),
    React.createElement(Text, { color: '#6e7688' }, 'Prod publish requires explicit typed confirmation.'),
  );
}
