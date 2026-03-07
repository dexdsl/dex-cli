import process from 'node:process';
import { spawn } from 'node:child_process';
import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import { listStaffLinkGroups } from '../lib/staff-links.mjs';

function toText(value) {
  return String(value || '').trim();
}

function truncate(value, max) {
  const text = toText(value);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function openInDefaultBrowser(url) {
  const target = toText(url);
  if (!target) return { ok: false, error: 'Missing URL' };
  try {
    let cmd = 'xdg-open';
    let args = [target];
    if (process.platform === 'darwin') {
      cmd = 'open';
      args = [target];
    } else if (process.platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '', target];
    }
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function LinksManager({ onExit, width = 100, height = 24 }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusLine, setStatusLine] = useState('Press Enter to open selected link.');

  const groups = useMemo(() => listStaffLinkGroups(), []);
  const rows = useMemo(() => {
    const out = [];
    for (const group of groups) {
      out.push({ type: 'group', id: `group:${group.id}`, label: group.label });
      for (const link of Array.isArray(group.links) ? group.links : []) {
        out.push({
          type: 'link',
          id: `link:${group.id}:${link.id}`,
          groupLabel: group.label,
          label: link.label,
          url: link.url,
        });
      }
      out.push({ type: 'spacer', id: `spacer:${group.id}` });
    }
    return out;
  }, [groups]);

  const linkRowIndexes = useMemo(
    () => rows.flatMap((row, index) => (row.type === 'link' ? [index] : [])),
    [rows],
  );
  const safeSelected = Math.max(0, Math.min(linkRowIndexes.length - 1, selectedIndex));
  const selectedAbsoluteIndex = linkRowIndexes[safeSelected] ?? 0;
  const selectedRow = rows[selectedAbsoluteIndex];

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      if (typeof onExit === 'function') onExit();
      return;
    }
    if (!linkRowIndexes.length) return;
    if (key.upArrow) {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((previous) => Math.min(linkRowIndexes.length - 1, previous + 1));
      return;
    }
    if (input === 'g') {
      setSelectedIndex(0);
      return;
    }
    if (input === 'G') {
      setSelectedIndex(Math.max(0, linkRowIndexes.length - 1));
      return;
    }
    if (key.return || input === 'o') {
      const target = rows[linkRowIndexes[Math.max(0, Math.min(linkRowIndexes.length - 1, selectedIndex))]];
      if (!target || target.type !== 'link') return;
      const opened = openInDefaultBrowser(target.url);
      if (opened.ok) {
        setStatusLine(`Opened ${target.url}`);
      } else {
        setStatusLine(`Open failed: ${opened.error}`);
      }
    }
  });

  const listHeight = Math.max(6, height - 8);
  const windowed = computeWindow({
    total: rows.length,
    cursor: selectedAbsoluteIndex,
    height: listHeight,
    pad: 2,
  });
  const visibleRows = rows.slice(windowed.start, windowed.end);

  return React.createElement(
    Box,
    { flexDirection: 'column', width, height },
    React.createElement(Text, { color: '#8f98a8' }, 'Links Manager (Enter open, o open, ↑/↓ select, g/G jump, Esc exit)'),
    React.createElement(Text, { color: '#6e7688' }, 'Staff operational links'),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      ...visibleRows.map((row, localIndex) => {
        const absoluteIndex = windowed.start + localIndex;
        if (row.type === 'group') {
          return React.createElement(Text, { key: row.id, color: '#8f98a8' }, `[${row.label}]`);
        }
        if (row.type === 'spacer') {
          return React.createElement(Text, { key: row.id }, '');
        }
        const isSelected = absoluteIndex === selectedAbsoluteIndex;
        const maxLabel = Math.max(16, width - 56);
        const maxUrl = Math.max(24, width - 12);
        const line = `${truncate(row.label, maxLabel).padEnd(maxLabel)}  ${truncate(row.url, maxUrl)}`;
        return React.createElement(
          Text,
          isSelected ? { key: row.id, inverse: true } : { key: row.id, color: '#d0d5df' },
          `${isSelected ? '› ' : '  '}${line}`,
        );
      }),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      selectedRow && selectedRow.type === 'link'
        ? React.createElement(Text, { color: '#8f98a8' }, `Selected: ${selectedRow.url}`)
        : null,
      React.createElement(Text, { color: '#8f98a8' }, statusLine),
    ),
  );
}
