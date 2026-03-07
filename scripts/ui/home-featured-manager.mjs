import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import {
  readHomeFeaturedFile,
  reorderHomeFeaturedItems,
  upsertHomeFeaturedItems,
  writeHomeFeaturedFile,
} from '../lib/home-featured-store.mjs';
import {
  diffHomeFeatured,
  publishHomeFeatured,
  pullHomeFeatured,
  writeHomeSnapshotFromLocal,
} from '../lib/home-featured-publisher.mjs';

const PROD_CONFIRMATION_PHRASE = 'PUBLISH PROD';

function toText(value) {
  return String(value || '').trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeMessage(error) {
  return error?.message || String(error || 'Unknown error');
}

export function HomeFeaturedManager({ onExit, width = 100, height = 24 }) {
  const [data, setData] = useState(null);
  const [filePath, setFilePath] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading home featured control plane…');
  const [inputMode, setInputMode] = useState('');
  const [inputValue, setInputValue] = useState('');

  const rows = useMemo(() => (Array.isArray(data?.featured) ? data.featured : []), [data]);
  const selected = rows[selectedIndex] || null;

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const loaded = await readHomeFeaturedFile();
      setData(loaded.data);
      setFilePath(loaded.filePath);
      setSelectedIndex(0);
      setStatusLine(`Loaded ${loaded.data.featured.length} home featured rows.`);
    } catch (error) {
      setStatusLine(`Load failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const persist = useCallback(async (next, message) => {
    setBusy(true);
    try {
      const written = await writeHomeFeaturedFile(next);
      setData(written.data);
      setFilePath(written.filePath);
      await writeHomeSnapshotFromLocal();
      setStatusLine(message);
    } catch (error) {
      setStatusLine(`${message} failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

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
        setStatusLine('Cancelled.');
        return;
      }
      if (key.return) {
        const value = toText(inputValue);
        if (inputMode === 'set-list' && value && data) {
          setInputMode('');
          setInputValue('');
          void persist(upsertHomeFeaturedItems(data, value), 'Updated featured list.');
          return;
        }
        if (inputMode === 'reorder-list' && value && data) {
          setInputMode('');
          setInputValue('');
          void persist(reorderHomeFeaturedItems(data, value), 'Reordered featured list.');
          return;
        }
        if (inputMode === 'publish-prod-confirm') {
          setInputMode('');
          setInputValue('');
          if (value !== PROD_CONFIRMATION_PHRASE) {
            setStatusLine(`Prod publish cancelled. Type exactly: ${PROD_CONFIRMATION_PHRASE}`);
            return;
          }
          void (async () => {
            setBusy(true);
            try {
              const result = await publishHomeFeatured({ env: 'prod', dryRun: false });
              await writeHomeSnapshotFromLocal();
              setStatusLine(`Published home featured to prod (${result.manifestHash.slice(0, 12)}).`);
            } catch (error) {
              setStatusLine(`Publish prod failed: ${safeMessage(error)}`);
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
    if (lower === 'r') { void reload(); return; }
    if (lower === 'a') { setInputMode('set-list'); setInputValue(''); return; }
    if (lower === 'e') { setInputMode('reorder-list'); setInputValue(''); return; }
    if (lower === 'v') {
      void (async () => {
        setBusy(true);
        try {
          await writeHomeSnapshotFromLocal();
          setStatusLine('Home featured validate + snapshot passed.');
        } catch (error) {
          setStatusLine(`Validate failed: ${safeMessage(error)}`);
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
          const result = await diffHomeFeatured({ env });
          setStatusLine(`Diff ${env}: +${result.featured.added} -${result.featured.removed} ~${result.featured.changed}`);
        } catch (error) {
          setStatusLine(`Diff ${env} failed: ${safeMessage(error)}`);
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
          const result = await publishHomeFeatured({ env: 'test', dryRun: false });
          await writeHomeSnapshotFromLocal();
          setStatusLine(`Published home featured test (${result.manifestHash.slice(0, 12)}).`);
        } catch (error) {
          setStatusLine(`Publish test failed: ${safeMessage(error)}`);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    if (lower === 'o') {
      setInputMode('publish-prod-confirm');
      setInputValue('');
      setStatusLine(`Type ${PROD_CONFIRMATION_PHRASE} and press Enter to publish PROD.`);
      return;
    }
    if (lower === 'l' || lower === 'k') {
      const env = lower === 'k' ? 'prod' : 'test';
      void (async () => {
        setBusy(true);
        try {
          const result = await pullHomeFeatured({ env, writeLocal: true });
          if (result.written?.data) setData(result.written.data);
          setStatusLine(`Pulled home featured from ${env}.`);
        } catch (error) {
          setStatusLine(`Pull ${env} failed: ${safeMessage(error)}`);
        } finally {
          setBusy(false);
        }
      })();
    }
  });

  const listWindow = computeWindow({
    total: rows.length,
    cursor: selectedIndex,
    height: Math.max(6, Math.min(16, height - 12)),
  });

  return React.createElement(Box, { flexDirection: 'column', width, height, minHeight: height },
    React.createElement(Text, { bold: true, color: '#d0d5df' }, 'Home Featured Manager'),
    React.createElement(Text, { color: '#ff6b6b' }, 'LIVE / CRITICAL / SENSITIVE INFRASTRUCTURE'),
    React.createElement(Text, { color: '#8f98a8' }, filePath || 'data/home.featured.json'),
    React.createElement(Box, { marginTop: 1, flexDirection: 'row', gap: 2 },
      React.createElement(Box, { flexDirection: 'column', minWidth: 54, width: Math.min(72, Math.floor(width * 0.62)) },
        React.createElement(Text, { color: '#8f98a8' }, 'Featured rows'),
        listWindow.start > 0 ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
        ...rows.slice(listWindow.start, listWindow.end).map((row, localIndex) => {
          const index = listWindow.start + localIndex;
          const line = `${row.slot_index}  ${row.entry_id}  ${row.lookup || '-'}  ${row.video ? 'video' : 'no-video'}`;
          return React.createElement(Text, index === selectedIndex ? { key: `${row.entry_id}-${index}`, inverse: true } : { key: `${row.entry_id}-${index}`, color: '#d0d5df' }, line);
        }),
        !rows.length ? React.createElement(Text, { color: '#8f98a8' }, 'No home featured rows yet.') : null,
        listWindow.end < rows.length ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
      ),
      React.createElement(Box, { flexDirection: 'column', flexGrow: 1 },
        React.createElement(Text, { color: '#8f98a8' }, 'Details'),
        selected
          ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, {}, `Slot: ${selected.slot_index}`),
            React.createElement(Text, {}, `Entry: ${selected.entry_id}`),
            React.createElement(Text, {}, `URL: ${selected.entry_href || '-'}`),
            React.createElement(Text, {}, `Lookup: ${selected.lookup || '-'}`),
            React.createElement(Text, {}, `Artist: ${selected.artist || '-'}`),
            React.createElement(Text, {}, `Video: ${selected.video || '-'}`),
          )
          : React.createElement(Text, { color: '#8f98a8' }, 'Select a featured row.'),
      ),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      inputMode
        ? React.createElement(Text, { color: '#ffcc66' }, inputMode === 'set-list'
          ? `Set entries CSV (id1,id2,...): ${inputValue}`
          : inputMode === 'reorder-list'
            ? `Reorder entries CSV (id1,id2,...): ${inputValue}`
            : `Confirm PROD publish. Type '${PROD_CONFIRMATION_PHRASE}': ${inputValue}`)
        : React.createElement(Text, { color: '#8f98a8' }, 'a set entries  e reorder  v validate  d diff(test)  f diff(prod)  p publish(test)  o publish(prod)  l pull(test)  k pull(prod)  r reload  Esc back'),
      React.createElement(Text, { color: busy ? '#ffcc66' : '#a6e3a1' }, busy ? 'Working…' : statusLine),
    ),
    React.createElement(Text, { color: '#6e7688' }, 'Prod publish requires explicit typed confirmation.'),
  );
}
