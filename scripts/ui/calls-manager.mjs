import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  clearActiveCall,
  listCalls,
  readCallsRegistry,
  setActiveCall,
  writeCallsRegistry,
} from '../lib/calls-store.mjs';

function toText(value) {
  return String(value || '').trim();
}

function safeMessage(error) {
  if (!error) return 'Unknown error';
  return error?.message || String(error);
}

function truncate(value, max) {
  const text = toText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function CallsManager({ onExit, width = 100, height = 24 }) {
  const [registry, setRegistry] = useState(null);
  const [filePath, setFilePath] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading calls registry…');
  const [showDetails, setShowDetails] = useState(false);

  const calls = useMemo(() => listCalls(registry, { status: 'all' }), [registry]);
  const selectedCall = calls[selectedIndex] || null;

  const reload = useCallback(async ({ keepId } = {}) => {
    setBusy(true);
    try {
      const { data, filePath: nextPath } = await readCallsRegistry();
      const nextCalls = listCalls(data, { status: 'all' });
      setRegistry(data);
      setFilePath(nextPath);
      if (nextCalls.length) {
        const keepIndex = keepId ? nextCalls.findIndex((call) => call.id === keepId) : -1;
        setSelectedIndex(keepIndex >= 0 ? keepIndex : 0);
      } else {
        setSelectedIndex(0);
      }
      setStatusLine(`Loaded ${Array.isArray(data.calls) ? data.calls.length : 0} calls.`);
    } catch (error) {
      setStatusLine(`Load failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const persist = useCallback(async (nextRegistry, successMessage) => {
    setBusy(true);
    try {
      const written = await writeCallsRegistry(nextRegistry);
      setRegistry(written.data);
      setFilePath(written.filePath);
      setStatusLine(successMessage);
    } catch (error) {
      setStatusLine(`${successMessage} failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useInput((input, key) => {
    if (busy) return;
    if (key.escape || input === 'q') {
      if (typeof onExit === 'function') onExit();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(Math.max(0, calls.length - 1), prev + 1));
      return;
    }
    if (input === 'r') {
      reload({ keepId: selectedCall?.id }).catch(() => {});
      return;
    }
    if (input === 'v') {
      setShowDetails((prev) => !prev);
      return;
    }
    if (input === 'a') {
      if (!selectedCall || !registry) return;
      const next = setActiveCall(registry, selectedCall.id);
      persist(next, `Set active call: ${selectedCall.id}`).catch(() => {});
      return;
    }
    if (input === 'c') {
      if (!registry) return;
      const next = clearActiveCall(registry);
      persist(next, 'Cleared active call').catch(() => {});
    }
  });

  const listHeight = Math.max(6, height - 12);
  const visibleRows = calls.slice(0, listHeight);

  return React.createElement(
    Box,
    { flexDirection: 'column', width, height },
    React.createElement(Text, { color: '#8f98a8' }, 'Calls Manager (↑/↓ select, a set-active, c clear-active, v details, r reload, Esc exit)'),
    React.createElement(Text, { color: '#6e7688' }, `Registry: ${filePath || '(loading)'}`),
    React.createElement(Text, { color: '#6e7688' }, `activeCallId: ${toText(registry?.activeCallId) || '(none)'}`),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      React.createElement(Text, { color: '#8f98a8' }, 'status   lane      cycle              title'),
      React.createElement(Text, { color: '#444c5e' }, '-'.repeat(Math.max(48, Math.min(width - 2, 90)))),
      ...visibleRows.map((call, index) => {
        const selected = index === selectedIndex;
        const status = toText(call.status).padEnd(7);
        const lane = toText(call.lane).padEnd(9);
        const cycle = truncate(toText(call.cycleLabel || call.cycleCode), 18).padEnd(18);
        const title = truncate(call.title, Math.max(24, width - 44));
        const prefix = selected ? '› ' : '  ';
        const color = selected ? '#ffcc66' : '#d0d5df';
        return React.createElement(Text, { key: call.id, color }, `${prefix}${status} ${lane} ${cycle} ${title}`);
      }),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      React.createElement(Text, { color: busy ? '#ffcc66' : '#8f98a8' }, statusLine),
      selectedCall && showDetails
        ? React.createElement(Text, { color: '#8f98a8' }, JSON.stringify(selectedCall, null, 2))
        : null,
    ),
  );
}
