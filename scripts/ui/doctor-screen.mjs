import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { scanEntries, repairEntry } from '../lib/doctor.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import { computeWindow } from './rolodex.mjs';

export function DoctorScreen({ onExit } = {}) {
  const [reports, setReports] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await scanEntries({ entriesDir: './entries' });
    setReports(r);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => r.slug.toLowerCase().includes(q));
  }, [reports, query]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered, cursor]);

  useInput((input, key) => {
    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }
    if (key.upArrow) setCursor((i) => Math.max(0, i - 1));
    else if (key.downArrow) setCursor((i) => Math.min(filtered.length - 1, i + 1));
    else if (key.ctrl && key.return) {
      // noop: explicitly avoid single letter repairs
    } else if (key.ctrl && (input === 's' || input === 'S')) {
      const selected = filtered[cursor];
      if (!selected) return;
      setMsg(`Repairing ${selected.slug}...`);
      void repairEntry({ slug: selected.slug, entriesDir: './entries' }).then((res) => {
        setMsg(`Repaired ${selected.slug}: ${res.wroteFiles.map((f) => f.split('/').slice(-2).join('/')).join(', ')}`);
        return load();
      }).catch((e) => setMsg(`Repair failed: ${e.message}`));
    } else if (isBackspaceKey(input, key)) setQuery((q) => q.slice(0, -1));
    else if (shouldAppendWizardChar(input, key)) setQuery((q) => q + input);
  });

  const windowed = computeWindow({ total: filtered.length, cursor, height: 10 });
  const selected = filtered[cursor];

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Text, { color: '#8f98a8' }, `Doctor filter: ${query || '(all)'}`),
    windowed.start > 0 ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
    ...filtered.slice(windowed.start, windowed.end).map((r, idx) => {
      const i = windowed.start + idx;
      const badge = r.errors.length ? '❌' : r.warnings.length ? '⚠️' : '✅';
      return React.createElement(Text, i === cursor ? { key: r.slug, inverse: true } : { key: r.slug }, `${badge} ${r.slug}`);
    }),
    windowed.end < filtered.length ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      React.createElement(Text, { color: '#8f98a8' }, selected ? `Report: ${selected.slug}` : 'Report'),
      ...(selected ? selected.checks.slice(0, 8).map((c) => React.createElement(Text, { key: c }, c)) : [React.createElement(Text, { key: 'none' }, 'No entries')]),
    ),
    React.createElement(Text, { color: '#6e7688' }, '↑/↓ move   Type filter   Ctrl+S repair selected   Esc back'),
    msg ? React.createElement(Text, { color: '#a6e3a1' }, msg) : null,
  );
}
