import process from 'node:process';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import {
  createPollDraft,
  readPollsFile,
  setPollStatus,
  upsertPoll,
  writePollsFile,
} from '../lib/polls-store.mjs';
import { pollsStatusValues, pollsVisibilityValues } from '../lib/polls-schema.mjs';
import { publishPolls } from '../lib/polls-publish.mjs';
import {
  getAdminPollLive,
  getAdminPollOverview,
  getAdminPollSnapshots,
  getAdminPollTrend,
  getPublicPollResults,
  getPublicPollTrend,
  promoteAdminPollSnapshot,
  publishAdminPollSnapshot,
} from '../lib/polls-admin-api.mjs';
import {
  renderBarBreakdown,
  renderLineTrend,
  renderPieBreakdown,
  renderStackedOptionTrend,
  renderVelocityTrend,
} from '../lib/polls-kuva.mjs';
import {
  buildPollsDeskQueueRows,
  PollsDeskDetail,
  PollsDeskPublishNoteComposer,
} from './polls-desk.mjs';

const STATUS_VALUES = Array.isArray(pollsStatusValues) ? pollsStatusValues : ['open', 'closed', 'draft'];
const VISIBILITY_VALUES = Array.isArray(pollsVisibilityValues) ? pollsVisibilityValues : ['public', 'members'];
const OPS_MODES = ['desk', 'catalog', 'live', 'trends', 'publish', 'history'];
const TREND_CHARTS = ['line', 'stack', 'velocity'];
const TREND_WINDOWS = ['24h', '7d', '30d', '90d'];
const AUTO_REFRESH_MS = 5000;
const METRICS_SWEEP_BATCH = 8;
const METRICS_SWEEP_MAX = 48;
const LIVE_SCOPE_CHART_WIDTH = 54;
const LIVE_SCOPE_CHART_HEIGHT = 10;
const PANEL_NAMES = ['book', 'live', 'trends', 'queue', 'alerts', 'tape', 'actions'];
const QUEUE_STAGE_FILTERS = ['all', 'awaiting_snapshot', 'draft_ready', 'intake_open', 'draft_poll', 'published'];

function nowIso() {
  return new Date().toISOString();
}

function safeMessage(error) {
  if (!error) return 'Unknown error';
  return error?.message || String(error);
}

function formatShortDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'n/a';
  return date.toISOString().slice(0, 10);
}

function formatClock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '--:--:--';
  return date.toISOString().slice(11, 19);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truncate(value, max) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function parseOptionsInput(value) {
  return String(value || '')
    .split(/\n|\|/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseCloseAtToIso(value, fallbackIso) {
  const raw = String(value || '').trim();
  if (!raw) return fallbackIso || nowIso();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T23:59:59.000Z`);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid close date');
    return date.toISOString();
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid close date');
  return date.toISOString();
}

function cycleIn(values, current, step) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return current;
  const index = list.indexOf(current);
  const start = index >= 0 ? index : 0;
  const nextIndex = (start + step + list.length) % list.length;
  return list[nextIndex];
}

function makeBar(count, total, width = 18) {
  const safeTotal = Number(total) > 0 ? Number(total) : 0;
  const safeCount = Number(count) > 0 ? Number(count) : 0;
  const ratio = safeTotal > 0 ? Math.min(1, safeCount / safeTotal) : 0;
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function parseResponseText(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function isAdminAuthMissingError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('missing polls admin token')
    || message.includes('poll admin token is not configured')
    || message.includes('polls_admin_unauthorized')
    || message.includes('unauthorized')
    || message.includes('failed (404)');
}

function normalizeCountsObject(rawCounts) {
  if (Array.isArray(rawCounts)) {
    const out = {};
    rawCounts.forEach((value, index) => {
      out[String(index)] = Number(value) || 0;
    });
    return out;
  }
  if (rawCounts && typeof rawCounts === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(rawCounts)) {
      out[String(key)] = Number(value) || 0;
    }
    return out;
  }
  return {};
}

function normalizeApiBase(value) {
  const parsed = new URL(String(value || '').trim());
  return parsed.toString().replace(/\/$/, '');
}

function resolveMetricsApiBase() {
  const fallback = 'https://dex-api.spring-fog-8edd.workers.dev';
  const explicit = process.env.DEX_POLLS_METRICS_API_BASE
    || process.env.DEX_POLLS_API_BASE
    || process.env.DEX_POLLS_API_BASE_PROD
    || process.env.DEX_API_BASE_URL
    || fallback;
  try {
    return normalizeApiBase(explicit);
  } catch {
    return fallback;
  }
}

function deriveStats(polls = [], metricsById = {}) {
  let open = 0;
  let closed = 0;
  let draft = 0;
  let members = 0;
  let publicCount = 0;
  let votesKnown = 0;
  let votesTotal = 0;

  for (const poll of polls) {
    if (poll.status === 'open') open += 1;
    if (poll.status === 'closed') closed += 1;
    if (poll.status === 'draft') draft += 1;
    if (poll.visibility === 'members') members += 1;
    if (poll.visibility === 'public') publicCount += 1;
    const metric = metricsById[poll.id];
    if (metric && !metric.loading && !metric.error && Number.isFinite(Number(metric.total))) {
      votesKnown += 1;
      votesTotal += Number(metric.total);
    }
  }

  return {
    total: polls.length,
    open,
    closed,
    draft,
    members,
    public: publicCount,
    votesKnown,
    votesTotal,
  };
}

function trendBucketForWindow(windowValue) {
  return windowValue === '24h' ? 'hour' : 'day';
}

function selectMetricsSweepIds({
  polls = [],
  selectedPollId = '',
  reason = 'auto',
  sweepCursorRef,
}) {
  const ids = Array.isArray(polls)
    ? polls.map((poll) => String(poll?.id || '').trim()).filter(Boolean)
    : [];
  if (!ids.length) return [];

  if (reason === 'manual' || reason === 'boot' || reason === 'mode') {
    return ids.slice(0, METRICS_SWEEP_MAX);
  }

  if (ids.length <= METRICS_SWEEP_BATCH) {
    return ids;
  }

  const cursor = Number(sweepCursorRef?.current || 0) % ids.length;
  const picked = [];
  for (let offset = 0; offset < METRICS_SWEEP_BATCH; offset += 1) {
    picked.push(ids[(cursor + offset) % ids.length]);
  }
  if (sweepCursorRef) {
    sweepCursorRef.current = (cursor + METRICS_SWEEP_BATCH) % ids.length;
  }
  if (selectedPollId && !picked.includes(selectedPollId)) {
    picked.unshift(selectedPollId);
  }
  return picked;
}

function summarizeAlertRows({
  selectedPoll,
  selectedLive,
  selectedSnapshots,
  selectedTrend,
}) {
  const isMissingToken = (value) => String(value || '').toLowerCase().includes('missing polls admin token');
  const alerts = [];
  if (!selectedPoll) return alerts;
  const liveTotal = Number(selectedLive?.payload?.total || 0) || 0;
  const snapshots = Array.isArray(selectedSnapshots?.snapshots) ? selectedSnapshots.snapshots : [];
  const latestSnapshot = snapshots.length
    ? [...snapshots].sort((a, b) => Number(b?.version || 0) - Number(a?.version || 0))[0]
    : null;
  const latestSnapshotState = String(latestSnapshot?.state || '').toLowerCase();

  if (selectedPoll.status === 'open' && liveTotal === 0) {
    alerts.push({ level: 'warn', text: 'Open poll has zero turnout in current window.' });
  }
  if (selectedPoll.status === 'closed' && latestSnapshotState !== 'published') {
    alerts.push({ level: 'warn', text: 'Closed poll has no published official snapshot.' });
  }
  const liveError = String(selectedLive?.error || '').trim();
  const trendError = String(selectedTrend?.error || '').trim();
  const missingToken = isMissingToken(liveError) || isMissingToken(trendError);
  if (missingToken) {
    alerts.push({ level: 'warn', text: 'Admin analytics auth missing. Set a polls admin token to enable live/trend telemetry.' });
  } else if (selectedLive?.error) {
    alerts.push({ level: 'crit', text: `Live feed unavailable: ${selectedLive.error}` });
  }
  if (!missingToken && selectedTrend?.error) {
    alerts.push({ level: 'crit', text: `Trend feed unavailable: ${selectedTrend.error}` });
  }
  if (!alerts.length) {
    alerts.push({ level: 'ok', text: 'No active poll ops alerts.' });
  }
  return alerts;
}

function makeEditorFromPoll(mode, poll, fallbackData) {
  const source = poll || createPollDraft(fallbackData || {
    version: 1,
    updatedAt: nowIso(),
    polls: [],
  });
  return {
    mode,
    sourceId: source.id,
    fields: {
      id: String(source.id || ''),
      slug: String(source.slug || ''),
      question: String(source.question || ''),
      options: Array.isArray(source.options) ? source.options.join(' | ') : 'Option 1 | Option 2',
      visibility: source.visibility || 'public',
      status: source.status || 'draft',
      closeAt: formatShortDate(source.closeAt || nowIso()),
      manualClose: Boolean(source.manualClose),
    },
  };
}

export function PollsManager({ onExit, width = 100, height = 24 }) {
  const [pollsData, setPollsData] = useState(null);
  const [pollsFilePath, setPollsFilePath] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading polls file…');
  const [metricsById, setMetricsById] = useState({});
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [editorFieldIndex, setEditorFieldIndex] = useState(0);
  const [editorTyping, setEditorTyping] = useState(false);
  const [editorBuffer, setEditorBuffer] = useState('');
  const [opsModeIndex, setOpsModeIndex] = useState(0);
  const [trendChartIndex, setTrendChartIndex] = useState(0);
  const [trendWindowIndex, setTrendWindowIndex] = useState(2);
  const [focusedPanelIndex, setFocusedPanelIndex] = useState(0);
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminLiveById, setAdminLiveById] = useState({});
  const [adminTrendById, setAdminTrendById] = useState({});
  const [adminSnapshotsById, setAdminSnapshotsById] = useState({});
  const [adminBusy, setAdminBusy] = useState(false);
  const [refreshPaused, setRefreshPaused] = useState(Boolean(process.env.DEX_POLLS_DESK_PAUSED === '1'));
  const [lastRefreshAt, setLastRefreshAt] = useState(0);
  const [eventTape, setEventTape] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [queueDrilldownOpen, setQueueDrilldownOpen] = useState(false);
  const [queueCursor, setQueueCursor] = useState(0);
  const [queueFilterIndex, setQueueFilterIndex] = useState(0);
  const [queueSort, setQueueSort] = useState('age');
  const [publishNoteOpen, setPublishNoteOpen] = useState(false);
  const [publishNoteFieldIndex, setPublishNoteFieldIndex] = useState(0);
  const [publishNoteTyping, setPublishNoteTyping] = useState(false);
  const [publishNoteBuffer, setPublishNoteBuffer] = useState('');
  const [publishNoteDraft, setPublishNoteDraft] = useState({
    headline: '',
    body: '',
    publish: true,
  });
  const adminEnv = useMemo(() => (process.env.DEX_POLLS_OPS_ENV || 'test'), []);
  const deskLayout = useMemo(() => {
    const raw = String(process.env.DEX_POLLS_DESK_LAYOUT || 'dense').toLowerCase();
    return raw === 'wide' ? 'wide' : 'dense';
  }, []);
  const apiBase = useMemo(() => resolveMetricsApiBase(), []);
  const metricsToken = useMemo(
    () => process.env.DEX_POLLS_METRICS_BEARER || process.env.AUTH0_ACCESS_TOKEN || '',
    [],
  );
  const refreshInFlightRef = useRef(false);
  const metricsSweepCursorRef = useRef(0);

  const polls = useMemo(() => (Array.isArray(pollsData?.polls) ? pollsData.polls : []), [pollsData]);
  const selectedPoll = polls[selectedIndex] || null;
  const stats = useMemo(() => deriveStats(polls, metricsById), [polls, metricsById]);
  const opsMode = OPS_MODES[opsModeIndex] || OPS_MODES[0];
  const trendChart = TREND_CHARTS[trendChartIndex] || TREND_CHARTS[0];
  const trendWindow = TREND_WINDOWS[trendWindowIndex] || TREND_WINDOWS[0];
  const queueFilterStage = QUEUE_STAGE_FILTERS[queueFilterIndex] || QUEUE_STAGE_FILTERS[0];
  const deskQueueAllRows = useMemo(() => buildPollsDeskQueueRows({
    polls,
    adminLiveById,
    adminSnapshotsById,
    metricsById,
    nowMs: lastRefreshAt || Date.now(),
  }), [adminLiveById, adminSnapshotsById, lastRefreshAt, metricsById, polls]);
  const deskQueueRows = useMemo(() => {
    const filtered = queueFilterStage === 'all'
      ? deskQueueAllRows
      : deskQueueAllRows.filter((row) => row.stage === queueFilterStage);
    const sorted = [...filtered].sort((a, b) => {
      if (queueSort === 'newest') {
        return String(b.closeAt || '').localeCompare(String(a.closeAt || ''));
      }
      return Number(b.ageHours || 0) - Number(a.ageHours || 0);
    });
    return sorted;
  }, [deskQueueAllRows, queueFilterStage, queueSort]);

  const reloadPolls = useCallback(async ({ keepId } = {}) => {
    setBusy(true);
    try {
      const previousId = keepId || null;
      const { data, filePath } = await readPollsFile();
      setPollsData(data);
      setPollsFilePath(filePath);
      if (Array.isArray(data.polls) && data.polls.length > 0) {
        const nextIndex = previousId
          ? data.polls.findIndex((poll) => poll.id === previousId)
          : -1;
        setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
      } else {
        setSelectedIndex(0);
      }
      setStatusLine(`Loaded ${Array.isArray(data.polls) ? data.polls.length : 0} polls.`);
    } catch (error) {
      setStatusLine(`Load failed: ${safeMessage(error)}`);
      setPollsData({ version: 1, updatedAt: nowIso(), polls: [] });
    } finally {
      setBusy(false);
    }
  }, []);

  const appendTape = useCallback((entry) => {
    const next = String(entry || '').trim();
    if (!next) return;
    const line = `${formatClock(Date.now())}  ${next}`;
    setEventTape((previous) => {
      const existing = Array.isArray(previous) ? previous : [];
      const merged = [line, ...existing.filter((item) => item !== line)];
      return merged.slice(0, 12);
    });
  }, []);

  const fetchMetricsForPoll = useCallback(async (pollId, { silent = false } = {}) => {
    if (!pollId) return null;
    const targetId = String(pollId);
    setMetricsById((previous) => ({
      ...previous,
      [targetId]: {
        ...(previous[targetId] || {}),
        loading: true,
        error: '',
      },
    }));
    try {
      const headers = { accept: 'application/json' };
      if (metricsToken) headers.authorization = `Bearer ${metricsToken}`;
      const response = await fetch(`${apiBase}/polls/${encodeURIComponent(targetId)}/results`, { headers });
      const text = await response.text();
      const payload = parseResponseText(text);
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      const results = payload?.results && typeof payload.results === 'object' ? payload.results : payload;
      const total = Number(results?.total || 0);
      const counts = normalizeCountsObject(results?.counts);
      setMetricsById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: '',
          total,
          counts,
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Metrics refreshed for ${targetId}.`);
      return { total, counts };
    } catch (error) {
      setMetricsById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: safeMessage(error),
          total: 0,
          counts: {},
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Metrics failed for ${targetId}: ${safeMessage(error)}`);
      return null;
    }
  }, [apiBase, metricsToken]);

  const fetchAdminOverview = useCallback(async ({ silent = false, window = trendWindow } = {}) => {
    try {
      const result = await getAdminPollOverview({ env: adminEnv, window });
      const overview = result?.payload?.overview && typeof result.payload.overview === 'object'
        ? result.payload.overview
        : result?.payload;
      setAdminOverview(overview || null);
      if (!silent) setStatusLine(`Overview refreshed (${adminEnv}).`);
      if (!silent) appendTape(`overview refreshed (${adminEnv}/${window})`);
      return overview;
    } catch (error) {
      if (!silent) setStatusLine(`Overview failed: ${safeMessage(error)}`);
      if (!silent) appendTape(`overview failed (${adminEnv}): ${safeMessage(error)}`);
      return null;
    }
  }, [adminEnv, appendTape, trendWindow]);

  const buildLiveScopeCharts = useCallback(async (pollId, poll, counts) => {
    const options = Array.isArray(poll?.options) ? poll.options : [];
    const safeCounts = normalizeCountsObject(counts);
    const [pieChartText, barChartText] = await Promise.all([
      renderPieBreakdown(options, safeCounts, {
        title: `Share ${pollId}`,
        termWidth: LIVE_SCOPE_CHART_WIDTH,
        termHeight: LIVE_SCOPE_CHART_HEIGHT,
      }),
      renderBarBreakdown(options, safeCounts, {
        title: `Bars ${pollId}`,
        termWidth: LIVE_SCOPE_CHART_WIDTH,
        termHeight: LIVE_SCOPE_CHART_HEIGHT,
      }),
    ]);
    return { pieChartText, barChartText };
  }, []);

  const fetchAdminLiveForPoll = useCallback(async (pollId, { silent = false } = {}) => {
    if (!pollId) return null;
    const targetId = String(pollId);
    setAdminLiveById((previous) => ({
      ...previous,
      [targetId]: {
        ...(previous[targetId] || {}),
        loading: true,
        error: '',
      },
    }));
    try {
      const result = await getAdminPollLive({ pollId: targetId, env: adminEnv });
      const livePayload = result?.payload?.live && typeof result.payload.live === 'object'
        ? result.payload.live
        : result?.payload;
      const livePoll = livePayload?.poll && typeof livePayload.poll === 'object'
        ? livePayload.poll
        : (polls.find((item) => item.id === targetId) || { id: targetId, question: targetId, options: [] });
      const liveCounts = normalizeCountsObject(livePayload?.counts);
      const { pieChartText, barChartText } = await buildLiveScopeCharts(targetId, livePoll, liveCounts);
      setAdminLiveById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: '',
          payload: {
            ...(livePayload || {}),
            poll: livePoll,
            counts: liveCounts,
          },
          pieChartText,
          barChartText,
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Live analytics refreshed for ${targetId}.`);
      if (!silent) appendTape(`live refreshed ${targetId}`);
      return livePayload;
    } catch (error) {
      if (isAdminAuthMissingError(error)) {
        try {
          const fallback = await fetchMetricsForPoll(targetId, { silent: true });
          const poll = polls.find((item) => item.id === targetId) || null;
          const fallbackPayload = {
            poll: poll
              ? { id: poll.id, question: poll.question, options: poll.options || [], status: poll.status, visibility: poll.visibility }
              : { id: targetId, question: targetId, options: [] },
            total: Number(fallback?.total || 0),
            counts: normalizeCountsObject(fallback?.counts),
            source: 'public-results-fallback',
          };
          const { pieChartText, barChartText } = await buildLiveScopeCharts(
            targetId,
            fallbackPayload.poll,
            fallbackPayload.counts,
          );
          setAdminLiveById((previous) => ({
            ...previous,
            [targetId]: {
              loading: false,
              error: '',
              payload: fallbackPayload,
              pieChartText,
              barChartText,
              updatedAt: Date.now(),
            },
          }));
          if (!silent) {
            setStatusLine(`Live fallback active for ${targetId} (public results).`);
            appendTape(`live fallback ${targetId} (public results)`);
          }
          return fallbackPayload;
        } catch (fallbackError) {
          if (!silent) appendTape(`live fallback failed ${targetId}: ${safeMessage(fallbackError)}`);
        }
      }
      setAdminLiveById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: safeMessage(error),
          payload: {},
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Live analytics failed: ${safeMessage(error)}`);
      if (!silent) appendTape(`live failed ${targetId}: ${safeMessage(error)}`);
      return null;
    }
  }, [adminEnv, appendTape, buildLiveScopeCharts, fetchMetricsForPoll, polls]);

  const fetchAdminSnapshotsForPoll = useCallback(async (pollId, { silent = false } = {}) => {
    if (!pollId) return [];
    const targetId = String(pollId);
    setAdminSnapshotsById((previous) => ({
      ...previous,
      [targetId]: {
        ...(previous[targetId] || {}),
        loading: true,
        error: '',
      },
    }));
    try {
      const result = await getAdminPollSnapshots({ pollId: targetId, env: adminEnv });
      const snapshots = Array.isArray(result?.payload?.snapshots)
        ? result.payload.snapshots
        : (Array.isArray(result?.payload?.items) ? result.payload.items : []);
      setAdminSnapshotsById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: '',
          snapshots,
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Snapshots refreshed for ${targetId}.`);
      if (!silent) appendTape(`snapshots refreshed ${targetId}`);
      return snapshots;
    } catch (error) {
      setAdminSnapshotsById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: safeMessage(error),
          snapshots: [],
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Snapshots failed: ${safeMessage(error)}`);
      if (!silent) appendTape(`snapshots failed ${targetId}: ${safeMessage(error)}`);
      return [];
    }
  }, [adminEnv, appendTape]);

  const fetchAdminTrendForPoll = useCallback(async (pollId, chartKind, {
    silent = false,
    window = trendWindow,
    bucket = trendBucketForWindow(window),
  } = {}) => {
    if (!pollId) return null;
    const targetId = String(pollId);
    const chart = String(chartKind || 'line').toLowerCase();
    setAdminTrendById((previous) => ({
      ...previous,
      [targetId]: {
        ...(previous[targetId] || {}),
        loading: true,
        error: '',
      },
    }));
    try {
      const result = await getAdminPollTrend({
        pollId: targetId,
        env: adminEnv,
        bucket,
        window,
      });
      const trend = result?.payload?.trend && typeof result.payload.trend === 'object'
        ? result.payload.trend
        : result?.payload;
      const series = Array.isArray(trend?.series)
        ? trend.series.map((row) => ({
          t: String(row?.t || row?.bucket || row?.timestamp || row?.date || row?.label || '').trim(),
          value: Number(row?.value ?? row?.count ?? row?.total ?? 0) || 0,
        })).filter((row) => row.t)
        : [];
      const seriesByOption = {};
      if (trend?.seriesByOption && typeof trend.seriesByOption === 'object') {
        for (const [key, value] of Object.entries(trend.seriesByOption)) {
          if (!Array.isArray(value)) continue;
          seriesByOption[key] = value.map((row) => ({
            t: String(row?.t || row?.bucket || row?.timestamp || row?.date || row?.label || '').trim(),
            value: Number(row?.value ?? row?.count ?? row?.total ?? 0) || 0,
          })).filter((row) => row.t);
        }
      }

      let chartText = '';
      if (chart === 'stack') {
        chartText = await renderStackedOptionTrend(seriesByOption, {
          title: `Trend ${targetId}`,
          termWidth: 58,
          termHeight: 14,
        });
      } else if (chart === 'velocity') {
        chartText = await renderVelocityTrend(series, {
          title: `Velocity ${targetId}`,
          termWidth: 58,
          termHeight: 14,
        });
      } else {
        chartText = await renderLineTrend(series, {
          title: `Trend ${targetId}`,
          termWidth: 58,
          termHeight: 14,
        });
      }

      setAdminTrendById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: '',
          trend,
          series,
          seriesByOption,
          chart,
          window,
          bucket,
          chartText,
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Trend refreshed for ${targetId}.`);
      if (!silent) appendTape(`trend refreshed ${targetId} (${window}/${bucket})`);
      return trend;
    } catch (error) {
      if (isAdminAuthMissingError(error)) {
        try {
          const fallbackResponse = await getPublicPollTrend({
            pollId: targetId,
            env: adminEnv,
            window,
            bucket: bucket === 'hour' ? 'day' : bucket,
          });
          const fallbackPayload = fallbackResponse?.payload || {};
          const points = Array.isArray(fallbackPayload?.trend) ? fallbackPayload.trend : [];
          const fallbackSeries = points.map((row) => ({
            t: String(row?.t || row?.bucket || row?.timestamp || row?.date || row?.label || '').trim(),
            value: Number(row?.value ?? row?.count ?? row?.total ?? 0) || 0,
          })).filter((row) => row.t);
          const fallbackChart = chart === 'velocity' ? 'velocity' : 'line';
          const chartText = fallbackChart === 'velocity'
            ? await renderVelocityTrend(fallbackSeries, {
              title: `Trend ${targetId} (public)`,
              termWidth: 58,
              termHeight: 14,
            })
            : await renderLineTrend(fallbackSeries, {
              title: `Trend ${targetId} (public)`,
              termWidth: 58,
              termHeight: 14,
            });

          setAdminTrendById((previous) => ({
            ...previous,
            [targetId]: {
              loading: false,
              error: '',
              trend: fallbackPayload,
              series: fallbackSeries,
              seriesByOption: {},
              chart,
              window,
              bucket,
              chartText,
              updatedAt: Date.now(),
              source: 'public-trend-fallback',
            },
          }));
          if (!silent) {
            setStatusLine(`Trend fallback active for ${targetId} (public trend).`);
            appendTape(`trend fallback ${targetId} (public trend)`);
          }
          return fallbackPayload;
        } catch (fallbackError) {
          if (!silent) appendTape(`trend fallback failed ${targetId}: ${safeMessage(fallbackError)}`);
        }
      }
      setAdminTrendById((previous) => ({
        ...previous,
        [targetId]: {
          loading: false,
          error: safeMessage(error),
          trend: null,
          series: [],
          seriesByOption: {},
          chart,
          window,
          bucket,
          chartText: '',
          updatedAt: Date.now(),
        },
      }));
      if (!silent) setStatusLine(`Trend failed: ${safeMessage(error)}`);
      if (!silent) appendTape(`trend failed ${targetId}: ${safeMessage(error)}`);
      return null;
    }
  }, [adminEnv, appendTape, trendWindow]);

  const refreshDeskData = useCallback(async ({ silent = false, reason = 'manual' } = {}) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const metricPollIds = selectMetricsSweepIds({
        polls,
        selectedPollId: selectedPoll?.id || '',
        reason,
        sweepCursorRef: metricsSweepCursorRef,
      });
      if (metricPollIds.length) {
        await Promise.all(metricPollIds.map((id) => fetchMetricsForPoll(id, { silent: true })));
      }
      await fetchAdminOverview({ silent: true, window: trendWindow });
      if (selectedPoll?.id) {
        await Promise.all([
          fetchAdminLiveForPoll(selectedPoll.id, { silent: true }),
          fetchAdminTrendForPoll(selectedPoll.id, trendChart, {
            silent: true,
            window: trendWindow,
            bucket: trendBucketForWindow(trendWindow),
          }),
          fetchAdminSnapshotsForPoll(selectedPoll.id, { silent: true }),
        ]);
      }
      setLastRefreshAt(Date.now());
      if (!silent) {
        setStatusLine(`Desk refreshed (${reason}) metrics:${metricPollIds.length}`);
        appendTape(`desk refresh (${reason})`);
      }
    } catch (error) {
      if (!silent) {
        setStatusLine(`Desk refresh failed: ${safeMessage(error)}`);
        appendTape(`desk refresh failed: ${safeMessage(error)}`);
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [
    appendTape,
    fetchAdminLiveForPoll,
    fetchAdminOverview,
    fetchAdminSnapshotsForPoll,
    fetchAdminTrendForPoll,
    fetchMetricsForPoll,
    polls,
    selectedPoll,
    trendChart,
    trendWindow,
  ]);

  const publishSnapshotForSelected = useCallback(async ({ draft = false } = {}) => {
    if (!selectedPoll?.id || busy || adminBusy) return;
    const pollId = selectedPoll.id;
    setAdminBusy(true);
    setStatusLine(`${draft ? 'Drafting' : 'Publishing'} snapshot for ${pollId}...`);
    try {
      const livePayload = await fetchAdminLiveForPoll(pollId, { silent: true });
      const poll = livePayload?.poll || selectedPoll;
      const counts = livePayload?.counts && typeof livePayload.counts === 'object' ? livePayload.counts : {};
      const total = Number(livePayload?.total || 0) || 0;
      const options = Array.isArray(poll?.options) ? poll.options : [];
      const lines = options.map((label, index) => {
        const count = Number(counts[String(index)] ?? counts[index] ?? 0) || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `- ${label}: ${count} (${pct}%)`;
      });
      const summaryMarkdown = [
        `Official ${draft ? 'draft' : 'published'} snapshot for **${poll.question || pollId}**.`,
        '',
        `Total votes: **${total}**`,
        '',
        ...lines,
      ].join('\n');
      const result = await publishAdminPollSnapshot({
        pollId,
        env: adminEnv,
        summaryMarkdown,
        headline: `Poll snapshot: ${pollId}`,
        publish: !draft,
        trendWindow: '90d',
      });
      const version = result?.payload?.version ?? '?';
      setStatusLine(`Snapshot ${draft ? 'drafted' : 'published'} for ${pollId} (v${version}).`);
      appendTape(`snapshot ${draft ? 'drafted' : 'published'} ${pollId} v${version}`);
      await fetchAdminSnapshotsForPoll(pollId, { silent: true });
    } catch (error) {
      setStatusLine(`Snapshot publish failed: ${safeMessage(error)}`);
      appendTape(`snapshot publish failed ${pollId}: ${safeMessage(error)}`);
    } finally {
      setAdminBusy(false);
    }
  }, [adminBusy, adminEnv, appendTape, busy, fetchAdminLiveForPoll, fetchAdminSnapshotsForPoll, selectedPoll]);

  const promoteLatestSnapshotForSelected = useCallback(async () => {
    if (!selectedPoll?.id || busy || adminBusy) return;
    const pollId = selectedPoll.id;
    const snapshotsState = adminSnapshotsById[pollId];
    const snapshots = Array.isArray(snapshotsState?.snapshots) ? snapshotsState.snapshots : [];
    if (!snapshots.length) {
      setStatusLine(`No snapshots available to promote for ${pollId}.`);
      return;
    }
    const latest = [...snapshots].sort((a, b) => Number(b?.version || 0) - Number(a?.version || 0))[0];
    const version = Number(latest?.version || 0);
    if (!version) {
      setStatusLine(`Snapshot version unavailable for ${pollId}.`);
      return;
    }
    setAdminBusy(true);
    setStatusLine(`Promoting snapshot v${version} for ${pollId}...`);
    try {
      await promoteAdminPollSnapshot({ pollId, version, env: adminEnv });
      setStatusLine(`Promoted snapshot v${version} for ${pollId}.`);
      appendTape(`snapshot promoted ${pollId} v${version}`);
      await fetchAdminSnapshotsForPoll(pollId, { silent: true });
    } catch (error) {
      setStatusLine(`Promote failed: ${safeMessage(error)}`);
      appendTape(`snapshot promote failed ${pollId}: ${safeMessage(error)}`);
    } finally {
      setAdminBusy(false);
    }
  }, [adminBusy, adminEnv, adminSnapshotsById, appendTape, busy, fetchAdminSnapshotsForPoll, selectedPoll]);

  const submitPublishNoteForSelected = useCallback(async () => {
    if (!selectedPoll?.id || busy || adminBusy) return;
    const pollId = selectedPoll.id;
    const summaryMarkdown = String(publishNoteDraft.body || '').trim();
    const headline = String(publishNoteDraft.headline || '').trim();
    const shouldPublish = publishNoteDraft.publish !== false;
    if (!summaryMarkdown) {
      setStatusLine('Publish note requires SUMMARY NOTE text.');
      return;
    }
    setAdminBusy(true);
    setStatusLine(`${shouldPublish ? 'Publishing' : 'Drafting'} note snapshot for ${pollId}...`);
    try {
      const result = await publishAdminPollSnapshot({
        pollId,
        env: adminEnv,
        summaryMarkdown,
        headline,
        publish: shouldPublish,
        trendWindow,
      });
      const version = result?.payload?.version ?? '?';
      setStatusLine(`Publish note ${shouldPublish ? 'published' : 'drafted'} for ${pollId} (v${version}).`);
      appendTape(`publish note ${shouldPublish ? 'published' : 'drafted'} ${pollId} v${version}`);
      setPublishNoteOpen(false);
      setPublishNoteTyping(false);
      setPublishNoteBuffer('');
      await fetchAdminSnapshotsForPoll(pollId, { silent: true });
    } catch (error) {
      setStatusLine(`Publish note failed: ${safeMessage(error)}`);
      appendTape(`publish note failed ${pollId}: ${safeMessage(error)}`);
    } finally {
      setAdminBusy(false);
    }
  }, [
    adminBusy,
    adminEnv,
    appendTape,
    busy,
    fetchAdminSnapshotsForPoll,
    publishNoteDraft.body,
    publishNoteDraft.headline,
    publishNoteDraft.publish,
    selectedPoll,
    trendWindow,
  ]);

  const refreshAllMetrics = useCallback(async () => {
    if (!polls.length || metricsBusy) return;
    setMetricsBusy(true);
    setStatusLine(`Refreshing results for ${polls.length} polls…`);
    try {
      for (const poll of polls) {
        // Sequential fetch avoids terminal API spam and preserves clear status.
        // eslint-disable-next-line no-await-in-loop
        await fetchMetricsForPoll(poll.id, { silent: true });
      }
      setStatusLine(`Metrics refreshed (${polls.length} polls).`);
      setLastRefreshAt(Date.now());
      appendTape(`metrics sweep (${polls.length} polls)`);
    } finally {
      setMetricsBusy(false);
    }
  }, [appendTape, fetchMetricsForPoll, metricsBusy, polls]);

  const persistPolls = useCallback(async (nextData, message, { selectId } = {}) => {
    setBusy(true);
    try {
      const written = await writePollsFile(nextData);
      setPollsData(written.data);
      setPollsFilePath(written.filePath);
      if (selectId) {
        const nextIndex = written.data.polls.findIndex((poll) => poll.id === selectId);
        setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
      }
      setStatusLine(message);
      return written.data;
    } catch (error) {
      setStatusLine(`${message} failed: ${safeMessage(error)}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const runPublish = useCallback(async (env) => {
    if (busy) return;
    setBusy(true);
    setStatusLine(`Publishing polls to ${env}…`);
    try {
      const result = await publishPolls({ env });
      const synced = Number(result?.payload?.synced || result?.payload?.count || result?.count || 0);
      const events = result?.events || null;
      const eventSuffix = events
        ? ` Events sent:${events.sent || 0} failed:${events.failed || 0} skipped:${events.skipped || 0}.`
        : '';
      setStatusLine(`Published ${synced || result.count} polls to ${result.env} (${result.apiBase}).${eventSuffix}`);
      appendTape(`definitions published ${result.env} (synced:${synced || result.count})`);
    } catch (error) {
      setStatusLine(`Publish ${env} failed: ${safeMessage(error)}`);
      appendTape(`definitions publish failed ${env}: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [appendTape, busy]);

  const openEditor = useCallback((mode) => {
    const target = mode === 'edit' ? selectedPoll : null;
    if (mode === 'edit' && !target) return;
    const nextEditor = makeEditorFromPoll(mode, target, pollsData);
    setEditor(nextEditor);
    setEditorFieldIndex(0);
    setEditorTyping(false);
    setEditorBuffer('');
    setStatusLine(mode === 'edit' ? `Editing ${target.id}` : 'Creating a new poll draft');
  }, [pollsData, selectedPoll]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setEditorFieldIndex(0);
    setEditorTyping(false);
    setEditorBuffer('');
  }, []);

  const applyStatus = useCallback(async (status) => {
    if (busy || !selectedPoll || !pollsData) return;
    try {
      const next = setPollStatus(pollsData, selectedPoll.id, status);
      const updated = await persistPolls(next, `${selectedPoll.id} → ${status}`, { selectId: selectedPoll.id });
      if (updated) {
        void fetchMetricsForPoll(selectedPoll.id, { silent: true });
      }
    } catch (error) {
      setStatusLine(`Status update failed: ${safeMessage(error)}`);
    }
  }, [busy, fetchMetricsForPoll, persistPolls, pollsData, selectedPoll]);

  const saveEditor = useCallback(async () => {
    if (!editor || !pollsData || busy) return;
    setBusy(true);
    try {
      const fields = editor.fields;
      const normalizedQuestion = String(fields.question || '').trim();
      const options = parseOptionsInput(fields.options);
      if (normalizedQuestion.length < 6) {
        throw new Error('Question must be at least 6 characters.');
      }
      if (options.length < 2) {
        throw new Error('At least two options are required.');
      }
      const closeAtIso = parseCloseAtToIso(fields.closeAt, nowIso());

      let nextPoll = null;
      if (editor.mode === 'create') {
        const requestedId = String(fields.id || '').trim();
        if (requestedId && polls.some((poll) => poll.id.toLowerCase() === requestedId.toLowerCase())) {
          throw new Error(`Poll id already exists: ${requestedId}`);
        }
        const draft = createPollDraft(pollsData, {
          id: requestedId || undefined,
          slug: String(fields.slug || '').trim() || undefined,
          question: normalizedQuestion,
          status: fields.status,
          visibility: fields.visibility,
          manualClose: Boolean(fields.manualClose),
        });
        nextPoll = {
          ...draft,
          question: normalizedQuestion,
          options,
          visibility: fields.visibility,
          status: fields.status,
          closeAt: closeAtIso,
          manualClose: Boolean(fields.manualClose),
        };
        if (String(fields.slug || '').trim()) {
          nextPoll.slug = String(fields.slug || '').trim();
        }
      } else {
        const current = polls.find((poll) => poll.id === editor.sourceId);
        if (!current) throw new Error(`Poll not found: ${editor.sourceId}`);
        nextPoll = {
          ...current,
          slug: String(fields.slug || '').trim() || undefined,
          question: normalizedQuestion,
          options,
          visibility: fields.visibility,
          status: fields.status,
          closeAt: closeAtIso,
          manualClose: Boolean(fields.manualClose),
        };
      }

      const nextData = upsertPoll(pollsData, nextPoll);
      const written = await writePollsFile(nextData);
      setPollsData(written.data);
      setPollsFilePath(written.filePath);
      const nextIndex = written.data.polls.findIndex((poll) => poll.id === nextPoll.id);
      setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
      setStatusLine(`${editor.mode === 'create' ? 'Created' : 'Updated'} ${nextPoll.id}`);
      closeEditor();
      void fetchMetricsForPoll(nextPoll.id, { silent: true });
    } catch (error) {
      setStatusLine(`Save failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, closeEditor, editor, fetchMetricsForPoll, polls, pollsData]);

  useEffect(() => {
    void reloadPolls();
  }, [reloadPolls]);

  useEffect(() => {
    void refreshDeskData({ silent: true, reason: 'boot' });
  }, [refreshDeskData]);

  useEffect(() => {
    if (!polls.length) return;
    setSelectedIndex((previous) => clamp(previous, 0, polls.length - 1));
  }, [polls.length]);

  useEffect(() => {
    if (!selectedPoll?.id) return;
    if (metricsById[selectedPoll.id]?.loading) return;
    if (metricsById[selectedPoll.id]?.updatedAt) return;
    void fetchMetricsForPoll(selectedPoll.id, { silent: true });
  }, [fetchMetricsForPoll, metricsById, selectedPoll]);

  useEffect(() => {
    if (!selectedPoll?.id) return;
    if (opsMode === 'desk' || opsMode === 'live' || opsMode === 'trends' || opsMode === 'history' || opsMode === 'publish') {
      void refreshDeskData({ silent: true, reason: 'mode' });
    }
  }, [
    opsMode,
    refreshDeskData,
    selectedPoll?.id,
  ]);

  useEffect(() => {
    setFocusedPanelIndex(0);
    setQueueDrilldownOpen(false);
    setPublishNoteOpen(false);
    setPublishNoteTyping(false);
    setPublishNoteBuffer('');
  }, [opsMode]);

  useEffect(() => {
    setQueueCursor((previous) => clamp(previous, 0, Math.max(0, deskQueueRows.length - 1)));
  }, [deskQueueRows.length]);

  useEffect(() => {
    if (editor) return undefined;
    if (refreshPaused) return undefined;
    const timer = setInterval(() => {
      void refreshDeskData({ silent: true, reason: 'auto' });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [editor, refreshDeskData, refreshPaused]);

  useEffect(() => {
    if (!selectedPoll?.id) return;
    if (opsMode !== 'trends' && opsMode !== 'desk') return;
    const trendState = adminTrendById[selectedPoll.id];
    if (trendState?.chart === trendChart && trendState?.window === trendWindow) return;
    void fetchAdminTrendForPoll(selectedPoll.id, trendChart, {
      silent: true,
      window: trendWindow,
      bucket: trendBucketForWindow(trendWindow),
    });
  }, [
    adminTrendById,
    fetchAdminTrendForPoll,
    opsMode,
    selectedPoll?.id,
    trendChart,
    trendWindow,
  ]);

  const editorFields = useMemo(() => (editor?.mode === 'create'
    ? [
      { key: 'id', label: 'ID', type: 'text', hint: 'unique immutable key' },
      { key: 'slug', label: 'SLUG', type: 'text', hint: 'optional URL slug' },
      { key: 'question', label: 'QUESTION', type: 'text', hint: 'prompt shown to voters' },
      { key: 'options', label: 'OPTIONS', type: 'text', hint: 'pipe separated: A | B | C' },
      { key: 'visibility', label: 'VISIBILITY', type: 'enum', values: VISIBILITY_VALUES },
      { key: 'status', label: 'STATUS', type: 'enum', values: STATUS_VALUES },
      { key: 'closeAt', label: 'CLOSE DATE', type: 'text', hint: 'YYYY-MM-DD or ISO date-time' },
      { key: 'manualClose', label: 'MANUAL CLOSE', type: 'bool' },
    ]
    : [
      { key: 'slug', label: 'SLUG', type: 'text', hint: 'optional URL slug' },
      { key: 'question', label: 'QUESTION', type: 'text', hint: 'prompt shown to voters' },
      { key: 'options', label: 'OPTIONS', type: 'text', hint: 'pipe separated: A | B | C' },
      { key: 'visibility', label: 'VISIBILITY', type: 'enum', values: VISIBILITY_VALUES },
      { key: 'status', label: 'STATUS', type: 'enum', values: STATUS_VALUES },
      { key: 'closeAt', label: 'CLOSE DATE', type: 'text', hint: 'YYYY-MM-DD or ISO date-time' },
      { key: 'manualClose', label: 'MANUAL CLOSE', type: 'bool' },
    ]), [editor?.mode]);
  const publishNoteFields = useMemo(() => ([
    { key: 'headline', label: 'HEADLINE', type: 'text' },
    { key: 'body', label: 'SUMMARY NOTE', type: 'text' },
    { key: 'publish', label: 'PUBLISH NOW', type: 'bool' },
  ]), []);

  useInput((input, key) => {
    if (key.ctrl && (input === 'q' || input === 'Q')) return;

    if (pendingAction) {
      const lower = String(input || '').toLowerCase();
      if (key.escape || lower === 'n') {
        setPendingAction(null);
        setStatusLine('Action cancelled.');
        return;
      }
      if (lower === 'y' || key.return) {
        const action = pendingAction;
        setPendingAction(null);
        if (action.type === 'publish') {
          void publishSnapshotForSelected({ draft: Boolean(action.draft) });
          return;
        }
        if (action.type === 'promote') {
          void promoteLatestSnapshotForSelected();
          return;
        }
        if (action.type === 'publish-defs-test') {
          void runPublish('test');
          return;
        }
        if (action.type === 'publish-defs-prod') {
          void runPublish('prod');
          return;
        }
      }
      return;
    }

    if (publishNoteOpen) {
      const field = publishNoteFields[publishNoteFieldIndex];
      const lower = String(input || '').toLowerCase();
      if (!field) return;

      if (publishNoteTyping) {
        if (key.return) {
          setPublishNoteDraft((previous) => ({ ...previous, [field.key]: publishNoteBuffer }));
          setPublishNoteTyping(false);
          setPublishNoteBuffer('');
          return;
        }
        if (key.escape) {
          setPublishNoteTyping(false);
          setPublishNoteBuffer('');
          return;
        }
        if (isBackspaceKey(input, key) || key.delete) {
          setPublishNoteBuffer((previous) => previous.slice(0, -1));
          return;
        }
        if (shouldAppendWizardChar(input, key)) {
          setPublishNoteBuffer((previous) => previous + input);
        }
        return;
      }

      if (key.escape) {
        setPublishNoteOpen(false);
        setPublishNoteFieldIndex(0);
        setPublishNoteTyping(false);
        setPublishNoteBuffer('');
        setStatusLine('Publish note composer closed.');
        return;
      }
      if (key.upArrow) {
        setPublishNoteFieldIndex((previous) => clamp(previous - 1, 0, publishNoteFields.length - 1));
        return;
      }
      if (key.downArrow) {
        setPublishNoteFieldIndex((previous) => clamp(previous + 1, 0, publishNoteFields.length - 1));
        return;
      }
      if ((lower === 's') || (key.ctrl && lower === 's')) {
        void submitPublishNoteForSelected();
        return;
      }
      if (field.type === 'bool') {
        if (key.leftArrow || key.rightArrow || key.return || input === ' ') {
          setPublishNoteDraft((previous) => ({ ...previous, [field.key]: !previous[field.key] }));
          return;
        }
      } else if (field.type === 'text' && key.return) {
        setPublishNoteTyping(true);
        setPublishNoteBuffer(String(publishNoteDraft[field.key] || ''));
      }
      return;
    }

    if (editor) {
      const field = editorFields[editorFieldIndex];
      if (!field) return;

      if (editorTyping) {
        if (key.return) {
          const nextFields = { ...editor.fields, [field.key]: editorBuffer };
          setEditor((previous) => ({ ...previous, fields: nextFields }));
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
      } else if (field.type === 'bool') {
        if (key.leftArrow || key.rightArrow || key.return || input === ' ') {
          setEditor((previous) => ({
            ...previous,
            fields: { ...previous.fields, [field.key]: !previous.fields[field.key] },
          }));
          return;
        }
      } else if (field.type === 'text' && key.return) {
        setEditorTyping(true);
        setEditorBuffer(String(editor.fields[field.key] || ''));
      }
      return;
    }

    if (queueDrilldownOpen) {
      const lower = String(input || '').toLowerCase();
      if (key.escape || lower === 'q') {
        setQueueDrilldownOpen(false);
        setStatusLine('Queue drilldown closed.');
        return;
      }
      if (key.upArrow) {
        setQueueCursor((previous) => clamp(previous - 1, 0, Math.max(0, deskQueueRows.length - 1)));
        return;
      }
      if (key.downArrow) {
        setQueueCursor((previous) => clamp(previous + 1, 0, Math.max(0, deskQueueRows.length - 1)));
        return;
      }
      if (lower === 'f') {
        setQueueFilterIndex((previous) => (previous + 1) % QUEUE_STAGE_FILTERS.length);
        setQueueCursor(0);
        return;
      }
      if (lower === 'z') {
        setQueueSort((previous) => (previous === 'age' ? 'newest' : 'age'));
        setQueueCursor(0);
        return;
      }
      if (key.return) {
        const target = deskQueueRows[queueCursor];
        if (!target?.pollId) return;
        const targetIndex = polls.findIndex((poll) => poll.id === target.pollId);
        if (targetIndex >= 0) {
          setSelectedIndex(targetIndex);
          setQueueDrilldownOpen(false);
          setStatusLine(`Queue drilldown selected ${target.pollId}.`);
          appendTape(`queue jump ${target.pollId}`);
        }
        return;
      }
      if (lower === 'r') {
        void refreshDeskData({ reason: 'queue' });
      }
      return;
    }

    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((previous) => clamp(previous - 1, 0, Math.max(0, polls.length - 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((previous) => clamp(previous + 1, 0, Math.max(0, polls.length - 1)));
      return;
    }
    if (key.tab) {
      const direction = key.shift ? -1 : 1;
      if (opsMode === 'desk') {
        setFocusedPanelIndex((previous) => {
          const total = PANEL_NAMES.length;
          return (previous + direction + total) % total;
        });
      } else {
        setOpsModeIndex((previous) => {
          const total = OPS_MODES.length;
          return (previous + direction + total) % total;
        });
      }
      return;
    }
    if (input === '[' || input === ']') {
      const direction = input === '[' ? -1 : 1;
      setOpsModeIndex((previous) => {
        const total = OPS_MODES.length;
        return (previous + direction + total) % total;
      });
      return;
    }
    if (busy) return;

    if (opsMode === 'desk' && /^[1-6]$/.test(String(input || ''))) {
      setFocusedPanelIndex(Number(input));
      return;
    }

    if (input === ' ') {
      setRefreshPaused((previous) => {
        const next = !previous;
        setStatusLine(next ? 'Auto refresh paused.' : 'Auto refresh resumed.');
        appendTape(next ? 'auto refresh paused' : 'auto refresh resumed');
        return next;
      });
      return;
    }

    if (input === 'P' && (opsMode === 'publish' || opsMode === 'desk')) {
      setPendingAction({ type: 'publish', draft: false, label: 'Publish official snapshot' });
      return;
    }
    if (input === 'D' && (opsMode === 'publish' || opsMode === 'desk')) {
      setPendingAction({ type: 'publish', draft: true, label: 'Save snapshot draft' });
      return;
    }
    if (input === 'O' && (opsMode === 'history' || opsMode === 'publish' || opsMode === 'desk')) {
      setPendingAction({ type: 'promote', label: 'Promote latest snapshot to official' });
      return;
    }

    const lower = String(input || '').toLowerCase();
    if (lower === 'n') {
      openEditor('create');
      return;
    }
    if (lower === 'e') {
      openEditor('edit');
      return;
    }
    if (lower === 'b' && (opsMode === 'publish' || opsMode === 'desk')) {
      const defaultHeadline = selectedPoll?.id ? `Official snapshot: ${selectedPoll.id}` : '';
      setPublishNoteDraft((previous) => ({
        headline: previous.headline || defaultHeadline,
        body: previous.body || '',
        publish: previous.publish !== false,
      }));
      setPublishNoteOpen(true);
      setPublishNoteFieldIndex(0);
      setPublishNoteTyping(false);
      setPublishNoteBuffer('');
      setStatusLine(`Compose publish note for ${selectedPoll?.id || 'selected poll'}.`);
      return;
    }
    if (lower === 'q' && opsMode === 'desk') {
      setQueueDrilldownOpen(true);
      setFocusedPanelIndex(2);
      setQueueCursor(0);
      setStatusLine('Queue drilldown opened.');
      return;
    }
    if (lower === 'o') {
      void applyStatus('open');
      return;
    }
    if (lower === 'c') {
      void applyStatus('closed');
      return;
    }
    if (lower === 'r') {
      if (key.shift) {
        void reloadPolls({ keepId: selectedPoll?.id });
        return;
      }
      if (opsMode === 'desk' || opsMode === 'live' || opsMode === 'trends' || opsMode === 'history' || opsMode === 'publish') {
        void refreshDeskData({ reason: 'manual' });
        return;
      }
      if (selectedPoll?.id) {
        void fetchMetricsForPoll(selectedPoll.id);
      }
      return;
    }
    if (lower === 'm') {
      void refreshAllMetrics();
      return;
    }
    if (lower === 'g' && opsMode === 'trends') {
      setTrendChartIndex((previous) => (previous + 1) % TREND_CHARTS.length);
      return;
    }
    if (lower === 'g' && opsMode === 'desk') {
      setTrendChartIndex((previous) => (previous + 1) % TREND_CHARTS.length);
      return;
    }
    if (lower === 'w' && (opsMode === 'trends' || opsMode === 'desk')) {
      setTrendWindowIndex((previous) => (previous + 1) % TREND_WINDOWS.length);
      return;
    }
    if (lower === 'l' && selectedPoll?.id && (opsMode === 'live' || opsMode === 'desk')) {
      void fetchAdminLiveForPoll(selectedPoll.id);
      return;
    }
    if (lower === 'h' && selectedPoll?.id && (opsMode === 'history' || opsMode === 'publish' || opsMode === 'desk')) {
      void fetchAdminSnapshotsForPoll(selectedPoll.id);
      return;
    }
    if (lower === 'v') {
      void fetchAdminOverview();
      return;
    }
    if (lower === 't') {
      setPendingAction({ type: 'publish-defs-test', label: 'Publish polls definitions to test env' });
      return;
    }
    if (lower === 'p') {
      setPendingAction({ type: 'publish-defs-prod', label: 'Publish polls definitions to prod env' });
    }
  });

  if (publishNoteOpen) {
    return React.createElement(Box, { flexDirection: 'column' },
      React.createElement(PollsDeskPublishNoteComposer, {
        selectedPoll,
        draft: publishNoteDraft,
        fieldIndex: publishNoteFieldIndex,
        typing: publishNoteTyping,
        buffer: publishNoteBuffer,
      }),
      React.createElement(Text, { color: '#8f98a8' }, `Target env: ${adminEnv}  publish:${publishNoteDraft.publish ? 'true' : 'false'}`),
      React.createElement(Text, adminBusy ? { color: '#ffcc66' } : { color: '#a6e3a1' }, statusLine),
    );
  }

  if (editor) {
    const activeField = editorFields[editorFieldIndex];
    return React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { color: '#8f98a8' }, `${editor.mode === 'create' ? 'Create poll' : `Edit ${editor.sourceId}`}  (Esc close, Enter edit, S save)`),
      ...editorFields.map((field, index) => {
        const value = editor.fields[field.key];
        const displayValue = field.type === 'bool' ? (value ? 'true' : 'false') : String(value || '');
        const label = `${field.label.padEnd(13)} ${displayValue}`;
        if (index === editorFieldIndex) {
          const typingLine = editorTyping && activeField?.key === field.key
            ? ` > ${editorBuffer}`
            : label;
          return React.createElement(Text, { key: field.key, inverse: true }, typingLine);
        }
        return React.createElement(Text, { key: field.key, color: '#d0d5df' }, label);
      }),
      activeField?.hint
        ? React.createElement(Text, { color: '#8f98a8' }, `Hint: ${activeField.hint}`)
        : null,
      editorTyping
        ? React.createElement(Text, { color: '#8f98a8' }, 'Typing mode: Enter commit, Esc cancel.')
        : React.createElement(Text, { color: '#8f98a8' }, 'Field mode: ↑/↓ move, Enter edit text, ←/→ cycle enums, Space toggle bool, S save.'),
      React.createElement(Text, { color: '#8f98a8' }, `File: ${pollsFilePath || 'loading…'}`),
      React.createElement(Text, { color: '#a6e3a1' }, statusLine),
    );
  }

  if (!pollsData) {
    return React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { color: '#8f98a8' }, 'Loading polls…'),
      React.createElement(Text, { color: '#8f98a8' }, statusLine),
    );
  }

  const listShare = deskLayout === 'wide' ? 0.5 : 0.58;
  const listWidth = width >= 130 ? Math.max(56, Math.floor(width * listShare)) : width;
  const detailWidth = Math.max(32, width - listWidth - (width >= 130 ? 2 : 0));
  const listRows = Math.max(6, height - 11);
  const windowed = computeWindow({
    total: polls.length,
    cursor: clamp(selectedIndex, 0, Math.max(0, polls.length - 1)),
    height: listRows,
  });
  const selectedMetrics = selectedPoll ? metricsById[selectedPoll.id] : null;
  const selectedLive = selectedPoll ? adminLiveById[selectedPoll.id] : null;
  const selectedTrend = selectedPoll ? adminTrendById[selectedPoll.id] : null;
  const selectedSnapshots = selectedPoll ? adminSnapshotsById[selectedPoll.id] : null;
  const modeHint = {
    desk: `Desk (${trendChart}/${trendWindow})`,
    catalog: 'Catalog',
    live: 'Live',
    trends: `Trends (${trendChart}/${trendWindow})`,
    publish: 'Publish',
    history: 'History',
  }[opsMode] || 'Catalog';
  const overviewTotals = adminOverview?.totals && typeof adminOverview.totals === 'object'
    ? adminOverview.totals
    : null;
  const refreshStamp = lastRefreshAt ? formatClock(lastRefreshAt) : '--:--:--';
  const selectedAlerts = summarizeAlertRows({
    selectedPoll,
    selectedLive,
    selectedSnapshots,
    selectedTrend,
  });

  const listPanel = React.createElement(Box, { flexDirection: 'column', width: listWidth },
    React.createElement(Text, { color: '#8f98a8' }, `Desk: ${modeHint}  env:${adminEnv}  layout:${deskLayout}  refresh:${refreshPaused ? 'paused' : '5s'}  last:${refreshStamp}`),
    React.createElement(Text, { color: '#8f98a8' }, `Polls (${stats.total})  open:${stats.open} closed:${stats.closed} draft:${stats.draft}  public:${stats.public} members:${stats.members}`),
    React.createElement(Text, { color: '#8f98a8' }, `Votes loaded: ${stats.votesKnown}/${stats.total} polls  total votes: ${stats.votesTotal}`),
    overviewTotals
      ? React.createElement(Text, { color: '#8f98a8' }, `Overview(${trendWindow}): open:${overviewTotals.open ?? 0} closed:${overviewTotals.closed ?? 0} draft:${overviewTotals.draft ?? 0} votes:${overviewTotals.votes ?? 0}`)
      : null,
    polls.length === 0
      ? React.createElement(Text, { color: '#d0d5df' }, 'No polls found. Press N to create a poll.')
      : null,
    windowed.start > 0 ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
    ...polls.slice(windowed.start, windowed.end).map((poll, localIndex) => {
      const absoluteIndex = windowed.start + localIndex;
      const metric = metricsById[poll.id];
      const liveMetric = adminLiveById[poll.id];
      const votes = metric && !metric.loading && !metric.error
        ? String(metric.total || 0).padStart(4)
        : (liveMetric && !liveMetric.loading && !liveMetric.error
          ? String(Number(liveMetric.payload?.total || 0)).padStart(4)
          : '   ?');
      const row = `${String(poll.status || '').padEnd(6)} ${String(poll.visibility || '').padEnd(7)} ${formatShortDate(poll.closeAt).padEnd(10)} v:${votes} ${truncate(poll.id, 28).padEnd(28)} ${truncate(poll.question, Math.max(10, listWidth - 68))}`;
      return React.createElement(Text, absoluteIndex === selectedIndex
        ? { key: poll.id, inverse: true }
        : { key: poll.id, color: '#d0d5df' }, row);
    }),
    windowed.end < polls.length ? React.createElement(Text, { color: '#8f98a8' }, '…') : null,
    React.createElement(Text, { color: '#8f98a8' }, 'Keys: N create  E edit  O open  C close  R refresh desk+metrics  Shift+R reload file  M hard refresh all metrics'),
    React.createElement(Text, { color: '#8f98a8' }, '      Space pause/resume auto refresh  W trend window  G chart cycle  Tab panel focus  [ ] mode switch  1-6 panels'),
    React.createElement(Text, { color: '#8f98a8' }, '      V refresh overview  L live refresh  H snapshots  Q queue drilldown  B publish note  T/p publish defs'),
    React.createElement(Text, { color: '#8f98a8' }, '      P/D/O snapshot actions  Esc back'),
    React.createElement(Text, { color: '#8f98a8' }, `API: ${apiBase}`),
    React.createElement(Text, metricsBusy || busy || adminBusy ? { color: '#ffcc66' } : { color: '#a6e3a1' }, statusLine),
    pendingAction
      ? React.createElement(Text, { color: '#ffcc66' }, `Confirm: ${pendingAction.label} (Y to confirm, N/Esc to cancel)`)
      : null,
  );

  const renderCatalogDetail = () => React.createElement(React.Fragment, null,
    React.createElement(Text, { color: '#8f98a8' }, `Selected: ${selectedPoll.id}`),
    React.createElement(Text, { color: '#d0d5df' }, `Status: ${selectedPoll.status}  Visibility: ${selectedPoll.visibility}`),
    React.createElement(Text, { color: '#d0d5df' }, `Created: ${formatShortDate(selectedPoll.createdAt)}  Close: ${formatShortDate(selectedPoll.closeAt)}  Manual close: ${selectedPoll.manualClose ? 'yes' : 'no'}`),
    React.createElement(Text, { color: '#d0d5df' }, `Question: ${selectedPoll.question}`),
    React.createElement(Text, { color: '#8f98a8' }, 'Live results'),
    selectedMetrics?.loading
      ? React.createElement(Text, { color: '#8f98a8' }, 'Loading results…')
      : selectedMetrics?.error
        ? React.createElement(Text, { color: '#ff7b72' }, `Results unavailable: ${selectedMetrics.error}`)
        : React.createElement(React.Fragment, null,
          React.createElement(Text, { color: '#d0d5df' }, `Total votes: ${Number(selectedMetrics?.total || 0)}`),
          ...(Array.isArray(selectedPoll.options) ? selectedPoll.options.map((option, index) => {
            const total = Number(selectedMetrics?.total || 0);
            const rawCount = Number(selectedMetrics?.counts?.[String(index)] ?? selectedMetrics?.counts?.[index] ?? 0);
            const percentage = total > 0 ? Math.round((rawCount / total) * 100) : 0;
            const line = `${String(index + 1).padStart(2)}. ${truncate(option, Math.max(6, detailWidth - 40)).padEnd(Math.max(6, detailWidth - 40))} ${String(rawCount).padStart(4)} (${String(percentage).padStart(3)}%) ${makeBar(rawCount, total)}`;
            return React.createElement(Text, { key: `${selectedPoll.id}-opt-${index}`, color: '#d0d5df' }, line);
          }) : []),
        ),
  );

  const renderLiveDetail = () => {
    if (selectedLive?.loading) {
      return React.createElement(Text, { color: '#8f98a8' }, 'Loading admin live analytics…');
    }
    if (selectedLive?.error) {
      return React.createElement(Text, { color: '#ff7b72' }, `Admin live unavailable: ${selectedLive.error}`);
    }
    const payload = selectedLive?.payload || {};
    const poll = payload.poll || selectedPoll || {};
    const total = Number(payload.total || 0);
    const counts = payload.counts && typeof payload.counts === 'object' ? payload.counts : {};
    return React.createElement(React.Fragment, null,
      React.createElement(Text, { color: '#8f98a8' }, `Selected: ${selectedPoll.id}`),
      React.createElement(Text, { color: '#d0d5df' }, `Question: ${poll.question || selectedPoll.question}`),
      React.createElement(Text, { color: '#d0d5df' }, `Live total votes: ${total}`),
      ...(Array.isArray(poll.options) ? poll.options.map((option, index) => {
        const rawCount = Number(counts[String(index)] ?? counts[index] ?? 0);
        const percentage = total > 0 ? Math.round((rawCount / total) * 100) : 0;
        const line = `${String(index + 1).padStart(2)}. ${truncate(option, Math.max(6, detailWidth - 40)).padEnd(Math.max(6, detailWidth - 40))} ${String(rawCount).padStart(4)} (${String(percentage).padStart(3)}%) ${makeBar(rawCount, total)}`;
        return React.createElement(Text, { key: `${selectedPoll.id}-live-${index}`, color: '#d0d5df' }, line);
      }) : []),
    );
  };

  const renderTrendsDetail = () => {
    if (selectedTrend?.loading) {
      return React.createElement(Text, { color: '#8f98a8' }, 'Loading trend ledger…');
    }
    if (selectedTrend?.error) {
      return React.createElement(Text, { color: '#ff7b72' }, `Trend unavailable: ${selectedTrend.error}`);
    }
    const chartText = String(selectedTrend?.chartText || '').trim();
    return React.createElement(React.Fragment, null,
      React.createElement(Text, { color: '#8f98a8' }, `Trend chart: ${trendChart}`),
      ...(!chartText
        ? [React.createElement(Text, { key: 'trend-empty', color: '#8f98a8' }, 'No trend data available yet.')]
        : chartText.split('\n').map((line, index) => React.createElement(Text, { key: `trend-${index}` }, line))),
    );
  };

  const renderSnapshotsDetail = () => {
    if (selectedSnapshots?.loading) {
      return React.createElement(Text, { color: '#8f98a8' }, 'Loading snapshots…');
    }
    if (selectedSnapshots?.error) {
      return React.createElement(Text, { color: '#ff7b72' }, `Snapshots unavailable: ${selectedSnapshots.error}`);
    }
    const snapshots = Array.isArray(selectedSnapshots?.snapshots) ? selectedSnapshots.snapshots : [];
    if (!snapshots.length) {
      return React.createElement(Text, { color: '#8f98a8' }, 'No snapshots for this poll yet.');
    }
    const rows = [...snapshots].sort((a, b) => Number(b?.version || 0) - Number(a?.version || 0));
    return React.createElement(React.Fragment, null,
      ...rows.slice(0, Math.max(5, height - 12)).map((item) => {
        const version = Number(item?.version || 0);
        const stateValue = String(item?.state || 'draft');
        const publishedAt = formatShortDate(item?.publishedAt || item?.published_at || '');
        const createdAt = formatShortDate(item?.createdAt || item?.created_at || '');
        const headline = truncate(String(item?.headline || ''), Math.max(10, detailWidth - 36));
        const line = `v${String(version).padStart(2)} ${stateValue.padEnd(9)} created:${createdAt} published:${publishedAt} ${headline}`;
        return React.createElement(Text, { key: `snapshot-${version}`, color: '#d0d5df' }, line);
      }),
    );
  };

  const detailPanel = React.createElement(Box, { flexDirection: 'column', width: detailWidth },
    !selectedPoll
      ? React.createElement(Text, { color: '#8f98a8' }, 'Select a poll to inspect details and results.')
      : React.createElement(React.Fragment, null,
        React.createElement(Text, { color: '#8f98a8' }, `Selected: ${selectedPoll.id}  mode:${modeHint}`),
        opsMode === 'desk'
          ? React.createElement(PollsDeskDetail, {
            selectedPoll,
            selectedLive,
            selectedTrend,
            selectedSnapshots,
            selectedAlerts,
            trendChart,
            trendWindow,
            focusedPanelIndex,
            eventTape,
            detailWidth,
            height,
            queueRows: deskQueueRows,
            queueDrilldownOpen,
            queueFilterStage,
            queueSort,
            queueCursor,
          })
          : null,
        opsMode === 'catalog' ? renderCatalogDetail() : null,
        opsMode === 'live' ? renderLiveDetail() : null,
        opsMode === 'trends' ? renderTrendsDetail() : null,
        opsMode === 'history' ? renderSnapshotsDetail() : null,
        opsMode === 'publish'
          ? React.createElement(React.Fragment, null,
            React.createElement(Text, { color: '#d0d5df' }, 'Publish controls'),
            React.createElement(Text, { color: '#8f98a8' }, 'P publish snapshot, D draft snapshot, O promote latest snapshot'),
            renderSnapshotsDetail(),
          )
          : null,
      ),
  );

  if (width >= 130) {
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
