import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import {
  ensureSeason,
  readCatalogSeasonsFile,
  writeCatalogSeasonsFile,
} from '../lib/catalog-seasons-store.mjs';
import {
  CATALOG_UNANNOUNCED_MESSAGE_DEFAULT,
  CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT,
} from '../lib/catalog-seasons-schema.mjs';

function safeMessage(error) {
  if (!error) return 'Unknown error';
  return error?.message || String(error);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseTokens(raw) {
  return String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function nextSeasonId(seasons = []) {
  let max = 0;
  for (const season of seasons) {
    const match = String(season?.id || '').toUpperCase().match(/^S(\d+)$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `S${max + 1}`;
}

export function CatalogSeasonsManager({ onExit, width = 100, height = 24 }) {
  const [data, setData] = useState(null);
  const [filePath, setFilePath] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading catalog seasons…');
  const [editingField, setEditingField] = useState('');
  const [editingValue, setEditingValue] = useState('');

  const seasons = useMemo(() => (Array.isArray(data?.seasons) ? data.seasons : []), [data]);
  const selectedSeason = seasons[selectedIndex] || null;

  const reload = useCallback(async ({ keepId } = {}) => {
    setBusy(true);
    try {
      const currentId = keepId || null;
      const loaded = await readCatalogSeasonsFile();
      setData(loaded.data);
      setFilePath(loaded.filePath);
      if (Array.isArray(loaded.data.seasons) && loaded.data.seasons.length) {
        const foundIndex = currentId ? loaded.data.seasons.findIndex((season) => season.id === currentId) : -1;
        setSelectedIndex(foundIndex >= 0 ? foundIndex : 0);
      } else {
        setSelectedIndex(0);
      }
      setStatusLine(`Loaded ${loaded.data.seasons.length} season config rows.`);
    } catch (error) {
      setStatusLine(`Load failed: ${safeMessage(error)}`);
      setData({ version: 'catalog-seasons-v1', updatedAt: new Date().toISOString(), seasons: [] });
    } finally {
      setBusy(false);
    }
  }, []);

  const persist = useCallback(async (nextData, message, keepId) => {
    setBusy(true);
    try {
      const written = await writeCatalogSeasonsFile(nextData);
      setData(written.data);
      setFilePath(written.filePath);
      if (keepId) {
        const idx = written.data.seasons.findIndex((season) => season.id === keepId);
        setSelectedIndex(idx >= 0 ? idx : 0);
      }
      setStatusLine(message);
    } catch (error) {
      setStatusLine(`${message} failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const patchSelected = useCallback(async (patchFactory, message) => {
    if (!data || !selectedSeason || busy) return;
    try {
      const patch = patchFactory(selectedSeason);
      const next = ensureSeason(data, selectedSeason.id, patch);
      await persist(next, message, selectedSeason.id);
    } catch (error) {
      setStatusLine(`${message} failed: ${safeMessage(error)}`);
    }
  }, [busy, data, persist, selectedSeason]);

  const addSeason = useCallback(async () => {
    if (!data || busy) return;
    const seasonId = nextSeasonId(seasons);
    const orderMatch = seasonId.match(/^S(\d+)$/);
    const order = orderMatch ? Number(orderMatch[1]) : 0;
    const next = ensureSeason(data, seasonId, {
      label: `season ${order || seasonId}`,
      order,
      unannounced: {
        enabled: true,
        count: 1,
        message: CATALOG_UNANNOUNCED_MESSAGE_DEFAULT,
        tokenPool: [...CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT],
        style: 'redacted',
      },
    });
    await persist(next, `Added ${seasonId}`, seasonId);
  }, [busy, data, persist, seasons]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!seasons.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((previous) => clamp(previous, 0, seasons.length - 1));
  }, [seasons.length]);

  const startEdit = useCallback((field) => {
    if (!selectedSeason) return;
    if (field === 'label') setEditingValue(String(selectedSeason.label || ''));
    if (field === 'order') setEditingValue(String(selectedSeason.order || 0));
    if (field === 'message') setEditingValue(String(selectedSeason.unannounced?.message || CATALOG_UNANNOUNCED_MESSAGE_DEFAULT));
    if (field === 'tokens') setEditingValue(String((selectedSeason.unannounced?.tokenPool || CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT).join(',')));
    setEditingField(field);
  }, [selectedSeason]);

  const applyEdit = useCallback(async () => {
    if (!editingField || !selectedSeason || !data) return;
    const value = String(editingValue || '').trim();
    try {
      let patch = null;
      if (editingField === 'label') {
        if (!value) throw new Error('Label cannot be empty.');
        patch = { label: value };
      } else if (editingField === 'order') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error('Order must be numeric.');
        patch = { order: Math.round(parsed) };
      } else if (editingField === 'message') {
        if (!value) throw new Error('Message cannot be empty.');
        patch = { unannounced: { message: value } };
      } else if (editingField === 'tokens') {
        const tokenPool = parseTokens(value);
        if (!tokenPool.length) throw new Error('Token pool cannot be empty.');
        patch = { unannounced: { tokenPool } };
      }

      if (patch) {
        const next = ensureSeason(data, selectedSeason.id, patch);
        await persist(next, `Updated ${selectedSeason.id}`, selectedSeason.id);
      }
      setEditingField('');
      setEditingValue('');
    } catch (error) {
      setStatusLine(`Edit failed: ${safeMessage(error)}`);
    }
  }, [data, editingField, editingValue, persist, selectedSeason]);

  useInput((input, key) => {
    if (editingField) {
      if (key.escape) {
        setEditingField('');
        setEditingValue('');
        return;
      }
      if (key.return) {
        void applyEdit();
        return;
      }
      if (isBackspaceKey(input, key) || key.delete) {
        setEditingValue((previous) => previous.slice(0, -1));
        return;
      }
      if (shouldAppendWizardChar(input, key)) {
        setEditingValue((previous) => previous + input);
      }
      return;
    }

    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((previous) => clamp(previous - 1, 0, Math.max(0, seasons.length - 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((previous) => clamp(previous + 1, 0, Math.max(0, seasons.length - 1)));
      return;
    }

    if (busy) return;

    const lower = String(input || '').toLowerCase();
    if (lower === 'r') { void reload({ keepId: selectedSeason?.id }); return; }
    if (lower === 'n') { void addSeason(); return; }
    if (lower === 'e') {
      void patchSelected(
        (season) => ({ unannounced: { enabled: !Boolean(season.unannounced?.enabled) } }),
        `Toggled teaser for ${selectedSeason?.id || ''}`,
      );
      return;
    }
    if (lower === '+' || input === '=') {
      void patchSelected(
        (season) => ({ unannounced: { count: Math.min(3, Number(season.unannounced?.count || 1) + 1) } }),
        `Incremented teaser count for ${selectedSeason?.id || ''}`,
      );
      return;
    }
    if (lower === '-') {
      void patchSelected(
        (season) => ({ unannounced: { count: Math.max(0, Number(season.unannounced?.count || 1) - 1) } }),
        `Decremented teaser count for ${selectedSeason?.id || ''}`,
      );
      return;
    }
    if (lower === 'l') { startEdit('label'); return; }
    if (lower === 'o') { startEdit('order'); return; }
    if (lower === 'm') { startEdit('message'); return; }
    if (lower === 'p') { startEdit('tokens'); return; }
  });

  const listWindow = computeWindow({
    total: seasons.length,
    cursor: selectedIndex,
    height: Math.max(4, Math.min(14, height - 10)),
  });

  return React.createElement(Box, { flexDirection: 'column', width, height, minHeight: height },
    React.createElement(Text, { bold: true, color: '#d0d5df' }, 'Catalog Season Manager'),
    React.createElement(Text, { color: '#8f98a8' }, filePath || 'data/catalog.seasons.json'),
    React.createElement(Box, { marginTop: 1, flexDirection: 'row', gap: 2 },
      React.createElement(Box, { flexDirection: 'column', minWidth: 46, width: Math.min(58, Math.floor(width * 0.54)) },
        React.createElement(Text, { color: '#8f98a8' }, 'Seasons'),
        listWindow.start > 0 ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
        ...seasons.slice(listWindow.start, listWindow.end).map((season, localIndex) => {
          const index = listWindow.start + localIndex;
          const teaser = season.unannounced || {};
          const line = `${season.id}  order:${season.order}  teaser:${teaser.enabled ? 'on' : 'off'}  count:${teaser.count}`;
          return React.createElement(Text, index === selectedIndex ? { key: season.id, inverse: true } : { key: season.id, color: '#d0d5df' }, line);
        }),
        !seasons.length ? React.createElement(Text, { color: '#8f98a8' }, 'No season rows.') : null,
        listWindow.end < seasons.length ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
      ),
      React.createElement(Box, { flexDirection: 'column', flexGrow: 1 },
        React.createElement(Text, { color: '#8f98a8' }, 'Details'),
        selectedSeason
          ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, {}, `ID: ${selectedSeason.id}`),
            React.createElement(Text, {}, `Label: ${selectedSeason.label}`),
            React.createElement(Text, {}, `Order: ${selectedSeason.order}`),
            React.createElement(Text, {}, `Teaser enabled: ${selectedSeason.unannounced?.enabled ? 'yes' : 'no'}`),
            React.createElement(Text, {}, `Teaser count: ${selectedSeason.unannounced?.count}`),
            React.createElement(Text, {}, `Teaser style: ${selectedSeason.unannounced?.style || 'redacted'}`),
            React.createElement(Text, {}, `Message: ${selectedSeason.unannounced?.message || CATALOG_UNANNOUNCED_MESSAGE_DEFAULT}`),
            React.createElement(Text, {}, `Tokens: ${(selectedSeason.unannounced?.tokenPool || CATALOG_UNANNOUNCED_TOKEN_POOL_DEFAULT).join(', ')}`),
          )
          : React.createElement(Text, { color: '#8f98a8' }, 'Select a season row.'),
      ),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      editingField
        ? React.createElement(Text, { color: '#ffcc66' }, `Editing ${editingField}: ${editingValue}`)
        : React.createElement(Text, { color: '#8f98a8' }, 'n add  e toggle teaser  +/- count  l label  o order  m message  p token pool  r reload  Esc back'),
      React.createElement(Text, { color: busy ? '#ffcc66' : '#a6e3a1' }, busy ? 'Working…' : statusLine),
    ),
    React.createElement(Text, { color: '#6e7688' }, 'Enter confirms edit · Esc cancels edit or exits manager.'),
  );
}
