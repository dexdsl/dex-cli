import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import {
  createIncidentRecord,
  incidentImpactValues,
  incidentStateValues,
  insertIncident,
  readStatusBundle,
  resolveIncident,
  writeIncidentPage,
  writeStatusBundle,
} from '../lib/status-store.mjs';
import { emitStatusIncidentHook, resolveEventsEnv } from '../lib/worker-hooks.mjs';

function safeMessage(error) {
  if (!error) return 'Unknown error';
  return error?.message || String(error);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cycleIn(values, current, step) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return current;
  const index = list.indexOf(current);
  const start = index >= 0 ? index : 0;
  return list[(start + step + list.length) % list.length];
}

function formatDate(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 'n/a';
  return new Date(parsed).toISOString().replace('T', ' ').slice(0, 16);
}

function formatState(value) {
  return String(value || 'unknown').replace(/^\w/, (letter) => letter.toUpperCase());
}

function resolveStatusEventsEnv() {
  try {
    return resolveEventsEnv(process.env.DEX_STATUS_EVENTS_ENV || process.env.DEX_EVENTS_ENV || 'prod');
  } catch {
    return 'prod';
  }
}

export function StatusManager({ onExit, width = 100, height = 24 }) {
  const statusEventsEnv = resolveStatusEventsEnv();
  const [bundle, setBundle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading status files…');
  const [selectedIncidentIndex, setSelectedIncidentIndex] = useState(0);
  const [editor, setEditor] = useState(null);
  const [editorFieldIndex, setEditorFieldIndex] = useState(0);
  const [editorTyping, setEditorTyping] = useState(false);
  const [editorBuffer, setEditorBuffer] = useState('');

  const incidents = useMemo(() => (Array.isArray(bundle?.live?.incidents) ? bundle.live.incidents : []), [bundle?.live?.incidents]);
  const components = useMemo(() => (Array.isArray(bundle?.live?.components) ? bundle.live.components : []), [bundle?.live?.components]);
  const selectedIncident = incidents[selectedIncidentIndex] || null;

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const next = await readStatusBundle();
      setBundle(next);
      setSelectedIncidentIndex((previous) => clamp(previous, 0, Math.max(0, next.live.incidents.length - 1)));
      setStatusLine(`Loaded ${next.live.incidents.length} incidents (${next.live.components.length} components).`);
    } catch (error) {
      setStatusLine(`Status load failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const openEditor = useCallback(() => {
    setEditor({
      fields: {
        id: '',
        title: '',
        impact: 'minor',
        state: 'investigating',
        components: '',
        summary: '',
      },
    });
    setEditorFieldIndex(0);
    setEditorTyping(false);
    setEditorBuffer('');
    setStatusLine('Create incident mode. Fill fields then press S to save.');
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setEditorFieldIndex(0);
    setEditorTyping(false);
    setEditorBuffer('');
  }, []);

  const saveEditor = useCallback(async () => {
    if (!bundle || !editor || busy) return;
    setBusy(true);
    try {
      const draft = createIncidentRecord(editor.fields, bundle.live);
      const page = await writeIncidentPage(draft);
      const incident = { ...draft, link: page.href };
      const nextLive = insertIncident(bundle.live, incident);
      const nextFallback = insertIncident(bundle.fallback, incident);
      const written = await writeStatusBundle({ live: nextLive, fallback: nextFallback });
      setBundle(written);
      setSelectedIncidentIndex(0);
      closeEditor();
      const hookResult = await emitStatusIncidentHook({
        env: statusEventsEnv,
        incident,
        state: incident.state,
      });
      if (hookResult.ok) {
        setStatusLine(`Created ${incident.id}, generated ${page.href}, and published status event.`);
      } else if (hookResult.skipped) {
        setStatusLine(`Created ${incident.id} and generated ${page.href} (status hook skipped: ${hookResult.reason || 'not configured'}).`);
      } else {
        setStatusLine(`Created ${incident.id} and generated ${page.href} (status hook failed).`);
      }
    } catch (error) {
      setStatusLine(`Incident create failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [bundle, busy, closeEditor, editor, statusEventsEnv]);

  const resolveSelectedIncident = useCallback(async () => {
    if (!bundle || !selectedIncident || busy) return;
    setBusy(true);
    try {
      const nextLiveResult = resolveIncident(bundle.live, selectedIncident.id);
      const nextFallbackResult = resolveIncident(bundle.fallback, selectedIncident.id);
      if (!nextLiveResult.changed && !nextFallbackResult.changed) {
        setStatusLine(`Incident already resolved: ${selectedIncident.id}`);
        return;
      }

      const updatedBundle = await writeStatusBundle({
        live: nextLiveResult.status,
        fallback: nextFallbackResult.status,
      });
      setBundle(updatedBundle);
      const updatedIncident = updatedBundle.live.incidents.find((incident) => incident.id === selectedIncident.id);
      if (updatedIncident) {
        await writeIncidentPage(updatedIncident);
        const hookResult = await emitStatusIncidentHook({
          env: statusEventsEnv,
          incident: updatedIncident,
          state: 'resolved',
        });
        if (hookResult.ok) {
          setStatusLine(`Resolved incident ${selectedIncident.id} and published status event.`);
          return;
        }
        if (hookResult.skipped) {
          setStatusLine(`Resolved incident ${selectedIncident.id} (status hook skipped: ${hookResult.reason || 'not configured'}).`);
          return;
        }
        setStatusLine(`Resolved incident ${selectedIncident.id} (status hook failed).`);
        return;
      }
      setStatusLine(`Resolved incident ${selectedIncident.id}.`);
    } catch (error) {
      setStatusLine(`Resolve failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [bundle, busy, selectedIncident, statusEventsEnv]);

  const regenerateSelectedIncidentPage = useCallback(async () => {
    if (!selectedIncident || busy) return;
    setBusy(true);
    try {
      const page = await writeIncidentPage(selectedIncident);
      setStatusLine(`Generated incident page: ${page.href}`);
    } catch (error) {
      setStatusLine(`Page generation failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, selectedIncident]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setSelectedIncidentIndex((previous) => clamp(previous, 0, Math.max(0, incidents.length - 1)));
  }, [incidents.length]);

  const editorFields = useMemo(() => [
    { key: 'id', label: 'ID', type: 'text', hint: 'optional. auto-generated if empty.' },
    { key: 'title', label: 'TITLE', type: 'text', hint: 'required incident headline.' },
    { key: 'impact', label: 'IMPACT', type: 'enum', values: incidentImpactValues },
    { key: 'state', label: 'STATE', type: 'enum', values: incidentStateValues },
    { key: 'components', label: 'COMPONENTS', type: 'text', hint: 'comma separated component ids.' },
    { key: 'summary', label: 'SUMMARY', type: 'text', hint: 'short public summary.' },
  ], []);

  useInput((input, key) => {
    if (editor) {
      const field = editorFields[editorFieldIndex];
      if (!field) return;

      if (editorTyping) {
        if (key.return) {
          setEditor((previous) => ({
            ...previous,
            fields: { ...previous.fields, [field.key]: editorBuffer },
          }));
          setEditorTyping(false);
          setEditorBuffer('');
          return;
        }
        if (key.escape) {
          setEditorTyping(false);
          setEditorBuffer('');
          return;
        }
        if (isBackspaceKey(input, key) || key.delete) {
          setEditorBuffer((previous) => previous.slice(0, -1));
          return;
        }
        if (shouldAppendWizardChar(input, key)) {
          setEditorBuffer((previous) => previous + input);
        }
        return;
      }

      if (key.escape) {
        closeEditor();
        return;
      }
      if (key.upArrow) {
        setEditorFieldIndex((previous) => clamp(previous - 1, 0, editorFields.length - 1));
        return;
      }
      if (key.downArrow) {
        setEditorFieldIndex((previous) => clamp(previous + 1, 0, editorFields.length - 1));
        return;
      }
      if ((input === 's' || input === 'S') || (key.ctrl && (input === 's' || input === 'S'))) {
        void saveEditor();
        return;
      }

      if (field.type === 'enum') {
        if (key.leftArrow) {
          setEditor((previous) => ({
            ...previous,
            fields: { ...previous.fields, [field.key]: cycleIn(field.values, previous.fields[field.key], -1) },
          }));
          return;
        }
        if (key.rightArrow || key.return || input === ' ') {
          setEditor((previous) => ({
            ...previous,
            fields: { ...previous.fields, [field.key]: cycleIn(field.values, previous.fields[field.key], 1) },
          }));
          return;
        }
      } else if (field.type === 'text' && key.return) {
        setEditorTyping(true);
        setEditorBuffer(String(editor.fields[field.key] || ''));
      }
      return;
    }

    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }

    if (key.upArrow) {
      setSelectedIncidentIndex((previous) => clamp(previous - 1, 0, Math.max(0, incidents.length - 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedIncidentIndex((previous) => clamp(previous + 1, 0, Math.max(0, incidents.length - 1)));
      return;
    }
    if (busy) return;

    const lower = String(input || '').toLowerCase();
    if (lower === 'n') {
      openEditor();
      return;
    }
    if (lower === 'r') {
      void resolveSelectedIncident();
      return;
    }
    if (lower === 'g') {
      void regenerateSelectedIncidentPage();
      return;
    }
    if (lower === 'u') {
      void reload();
    }
  });

  if (editor) {
    const activeField = editorFields[editorFieldIndex];
    return React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { color: '#8f98a8' }, 'Status incident editor (Esc close, Enter edit, S save)'),
      ...editorFields.map((field, index) => {
        const value = String(editor.fields[field.key] || '');
        const line = `${field.label.padEnd(12)} ${value}`;
        if (index === editorFieldIndex) {
          const typingLine = editorTyping && activeField?.key === field.key ? ` > ${editorBuffer}` : line;
          return React.createElement(Text, { key: field.key, inverse: true }, typingLine);
        }
        return React.createElement(Text, { key: field.key, color: '#d0d5df' }, line);
      }),
      activeField?.hint
        ? React.createElement(Text, { color: '#8f98a8' }, `Hint: ${activeField.hint}`)
        : null,
      editorTyping
        ? React.createElement(Text, { color: '#8f98a8' }, 'Typing mode: Enter commit, Esc cancel.')
        : React.createElement(Text, { color: '#8f98a8' }, 'Field mode: ↑/↓ move, Enter edit text, ←/→ cycle enums, S save.'),
      React.createElement(Text, busy ? { color: '#ffcc66' } : { color: '#a6e3a1' }, statusLine),
    );
  }

  if (!bundle) {
    return React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { color: '#8f98a8' }, 'Loading status runtime…'),
      React.createElement(Text, { color: '#8f98a8' }, statusLine),
    );
  }

  const listWidth = width >= 126 ? Math.max(54, Math.floor(width * 0.52)) : width;
  const detailWidth = Math.max(34, width - listWidth - (width >= 126 ? 2 : 0));
  const listRows = Math.max(6, height - 12);
  const windowedIncidents = computeWindow({
    total: incidents.length,
    cursor: clamp(selectedIncidentIndex, 0, Math.max(0, incidents.length - 1)),
    height: listRows,
  });

  const listPanel = React.createElement(Box, { flexDirection: 'column', width: listWidth },
    React.createElement(Text, { color: '#8f98a8' }, `Status files: ${bundle.livePath}`),
    React.createElement(Text, { color: '#8f98a8' }, `Fallback: ${bundle.fallbackPath}`),
    React.createElement(Text, { color: '#d0d5df' }, `Overall: ${formatState(bundle.live.overall.state)} · ${bundle.live.overall.message}`),
    React.createElement(Text, { color: '#8f98a8' }, `Incidents (${incidents.length})`),
    incidents.length === 0
      ? React.createElement(Text, { color: '#d0d5df' }, 'No incidents yet. Press N to create the first incident.')
      : null,
    windowedIncidents.start > 0 ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
    ...incidents.slice(windowedIncidents.start, windowedIncidents.end).map((incident, localIndex) => {
      const absoluteIndex = windowedIncidents.start + localIndex;
      const row = `${formatState(incident.state).padEnd(13)} ${String(incident.impact || '').padEnd(8)} ${String(incident.id).padEnd(28)} ${incident.title}`;
      return React.createElement(Text, absoluteIndex === selectedIncidentIndex
        ? { key: incident.id, inverse: true }
        : { key: incident.id, color: '#d0d5df' }, row);
    }),
    windowedIncidents.end < incidents.length ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
    React.createElement(Text, { color: '#8f98a8' }, 'Keys: N new incident  R resolve selected  G regenerate page  U reload  Esc back'),
    React.createElement(Text, busy ? { color: '#ffcc66' } : { color: '#a6e3a1' }, statusLine),
  );

  const detailPanel = React.createElement(Box, { flexDirection: 'column', width: detailWidth },
    React.createElement(Text, { color: '#8f98a8' }, `Components (${components.length})`),
    ...(components.length
      ? components.map((component) => React.createElement(
        Text,
        { key: component.id, color: '#d0d5df' },
        `${String(component.state).padEnd(12)} ${String(component.id).padEnd(12)} 24h:${component.uptime?.h24 ?? '--'} latency:${component.latencyMs ?? '--'}ms`,
      ))
      : [React.createElement(Text, { key: 'components-empty', color: '#8f98a8' }, 'No components found.')]),
    React.createElement(Text, { color: '#8f98a8' }, ''),
    selectedIncident
      ? React.createElement(React.Fragment, null,
        React.createElement(Text, { color: '#8f98a8' }, `Selected incident: ${selectedIncident.id}`),
        React.createElement(Text, { color: '#d0d5df' }, `State: ${formatState(selectedIncident.state)} · Impact: ${selectedIncident.impact}`),
        React.createElement(Text, { color: '#d0d5df' }, `Started: ${formatDate(selectedIncident.startedAt)} · Updated: ${formatDate(selectedIncident.updatedAt)}`),
        React.createElement(Text, { color: '#d0d5df' }, `Resolved: ${selectedIncident.resolvedAt ? formatDate(selectedIncident.resolvedAt) : 'not resolved'}`),
        React.createElement(Text, { color: '#d0d5df' }, `Components: ${(selectedIncident.components || []).join(', ') || 'unspecified'}`),
        React.createElement(Text, { color: '#d0d5df' }, `Link: ${selectedIncident.link || '/support/'}`),
        React.createElement(Text, { color: '#d0d5df' }, `Summary: ${selectedIncident.summary}`),
      )
      : React.createElement(Text, { color: '#8f98a8' }, 'No incident selected.'),
  );

  if (width >= 126) {
    return React.createElement(Box, { flexDirection: 'row' },
      listPanel,
      React.createElement(Box, { width: 2 }),
      detailPanel,
    );
  }

  return React.createElement(Box, { flexDirection: 'column' },
    listPanel,
    React.createElement(Box, { marginTop: 1 }, detailPanel),
  );
}
