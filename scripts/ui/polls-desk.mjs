import React from 'react';
import { Text } from 'ink';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truncate(value, max) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatStageLabel(stage) {
  const value = String(stage || '').toLowerCase();
  switch (value) {
    case 'awaiting_snapshot':
      return 'await-snapshot';
    case 'draft_ready':
      return 'draft-ready';
    case 'intake_open':
      return 'intake-open';
    case 'draft_poll':
      return 'draft-poll';
    case 'published':
      return 'published';
    default:
      return value || 'unknown';
  }
}

function safeDate(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function hoursSince(value, nowMs) {
  const date = safeDate(value);
  if (!date) return 0;
  const diffMs = Math.max(0, Number(nowMs || Date.now()) - date.getTime());
  return Math.round(diffMs / 36e5);
}

function pickLatestSnapshot(snapshots = []) {
  if (!Array.isArray(snapshots) || !snapshots.length) return null;
  const sorted = [...snapshots].sort((a, b) => Number(b?.version || 0) - Number(a?.version || 0));
  return sorted[0] || null;
}

function resolveQueueStage({ status, snapshotCount, hasPublished, hasDraft }) {
  if (status === 'open') return 'intake_open';
  if (status === 'draft') return 'draft_poll';
  if (status === 'closed' && !snapshotCount) return 'awaiting_snapshot';
  if (status === 'closed' && !hasPublished && hasDraft) return 'draft_ready';
  if (hasPublished) return 'published';
  return 'awaiting_snapshot';
}

function resolveQueueRisk({ stage, ageHours, votes }) {
  if (stage === 'awaiting_snapshot' && ageHours > 24) return 'stale';
  if (stage === 'intake_open' && ageHours > 72 && votes === 0) return 'low-turnout';
  return '';
}

export function buildPollsDeskQueueRows({
  polls = [],
  adminLiveById = {},
  adminSnapshotsById = {},
  metricsById = {},
  nowMs = Date.now(),
} = {}) {
  const rows = [];
  for (const poll of Array.isArray(polls) ? polls : []) {
    const pollId = String(poll?.id || '').trim();
    if (!pollId) continue;
    const live = adminLiveById?.[pollId]?.payload || {};
    const snapshots = Array.isArray(adminSnapshotsById?.[pollId]?.snapshots)
      ? adminSnapshotsById[pollId].snapshots
      : [];
    const latestSnapshot = pickLatestSnapshot(snapshots);
    const snapshotState = String(latestSnapshot?.state || '').toLowerCase();
    const hasPublished = snapshots.some((item) => String(item?.state || '').toLowerCase() === 'published');
    const hasDraft = snapshots.some((item) => String(item?.state || '').toLowerCase() === 'draft');
    const stage = resolveQueueStage({
      status: String(poll?.status || '').toLowerCase(),
      snapshotCount: snapshots.length,
      hasPublished,
      hasDraft,
    });
    const ageBase = poll?.closeAt || poll?.updatedAt || poll?.createdAt;
    const ageHours = hoursSince(ageBase, nowMs);
    const metrics = metricsById?.[pollId] || {};
    const votes = toNumber(
      live?.total
      ?? live?.totalVotes
      ?? metrics?.total,
      0,
    );
    const riskFlag = resolveQueueRisk({ stage, ageHours, votes });
    rows.push({
      pollId,
      status: String(poll?.status || ''),
      visibility: String(poll?.visibility || ''),
      stage,
      stageLabel: formatStageLabel(stage),
      ageHours,
      votes,
      snapshotCount: snapshots.length,
      snapshotState: snapshotState || '-',
      snapshotVersion: Number(latestSnapshot?.version || 0) || 0,
      riskFlag,
      question: String(poll?.question || ''),
      closeAt: String(poll?.closeAt || ''),
    });
  }
  return rows;
}

function sectionLabel(index, focusedPanelIndex, title) {
  return `${focusedPanelIndex === index ? '▸' : ' '}[${index + 1}] ${title}`;
}

function renderQueueRows({
  rows = [],
  queueDrilldownOpen = false,
  queueCursor = 0,
  detailWidth = 48,
}) {
  if (!rows.length) {
    return [React.createElement(Text, { key: 'queue-empty', color: '#8f98a8' }, 'No queue rows for this filter.')];
  }
  const visibleRows = queueDrilldownOpen ? rows.slice(0, 12) : rows.slice(0, 4);
  return visibleRows.map((row, index) => {
    const risk = row.riskFlag ? ` risk:${row.riskFlag}` : '';
    const line = `${row.stageLabel.padEnd(14)} age:${String(row.ageHours).padStart(4)}h votes:${String(row.votes).padStart(4)} snap:${row.snapshotState.padEnd(9)} v${String(row.snapshotVersion || 0).padStart(2)} ${truncate(row.pollId, Math.max(8, detailWidth - 68))}${risk}`;
    const key = `queue-${row.pollId}-${index}`;
    if (queueDrilldownOpen && index === queueCursor) {
      return React.createElement(Text, { key, inverse: true }, line);
    }
    return React.createElement(Text, { key, color: '#d0d5df' }, line);
  });
}

function resolveLeadingOption(options = [], counts = {}, total = 0) {
  if (!Array.isArray(options) || !options.length) return null;
  const rows = options.map((label, index) => ({
    label: String(label || `Option ${index + 1}`),
    count: toNumber(counts?.[String(index)] ?? counts?.[index], 0),
  }));
  rows.sort((a, b) => b.count - a.count);
  const lead = rows[0] || null;
  const runner = rows[1] || null;
  if (!lead) return null;
  const pct = total > 0 ? Math.round((lead.count / total) * 100) : 0;
  const margin = runner ? lead.count - runner.count : lead.count;
  return { lead, runner, pct, margin };
}

function resolveMomentum(trendSeries = []) {
  const series = Array.isArray(trendSeries) ? trendSeries : [];
  if (series.length < 2) return null;
  const last = toNumber(series[series.length - 1]?.value, 0);
  const prev = toNumber(series[series.length - 2]?.value, 0);
  return last - prev;
}

function resolveTimeToClose(closeAt) {
  const date = safeDate(closeAt);
  if (!date) return 'n/a';
  const deltaMs = date.getTime() - Date.now();
  if (deltaMs <= 0) return 'closed';
  const hours = Math.floor(deltaMs / 36e5);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${String(remHours).padStart(2, '0')}h`;
}

function buildScopeMetricRows({
  selectedPoll,
  snapshots = [],
  liveOptions = [],
  liveCounts = {},
  liveTotal = 0,
  trendSeries = [],
}) {
  const leader = resolveLeadingOption(liveOptions, liveCounts, liveTotal);
  const momentum = resolveMomentum(trendSeries);
  const latestSnapshot = pickLatestSnapshot(snapshots);
  const liveRows = liveOptions
    .map((_, index) => toNumber(liveCounts[String(index)] ?? liveCounts[index], 0))
    .filter((value) => value > 0);
  const activeOptions = liveRows.length;
  const concentration = liveTotal > 0 && leader ? `${leader.pct}%` : 'n/a';
  const rows = [
    `Turnout: ${liveTotal} votes · Active options: ${activeOptions}/${liveOptions.length || 0}`,
    leader
      ? `Leader: ${truncate(leader.lead.label, 24)} · ${leader.lead.count} votes (${leader.pct}%) · margin +${leader.margin}`
      : 'Leader: n/a',
    `Momentum (last bucket): ${momentum == null ? 'n/a' : `${momentum >= 0 ? '+' : ''}${momentum}`}`,
    `Concentration: ${concentration} · Close in: ${resolveTimeToClose(selectedPoll?.closeAt)}`,
    `Snapshot head: ${latestSnapshot ? `v${latestSnapshot.version} ${latestSnapshot.state || 'draft'}` : 'none'}`,
  ];
  return rows;
}

export function PollsDeskDetail({
  selectedPoll,
  selectedLive,
  selectedTrend,
  selectedSnapshots,
  selectedAlerts = [],
  trendChart = 'line',
  trendWindow = '30d',
  focusedPanelIndex = 0,
  eventTape = [],
  detailWidth = 48,
  height = 24,
  queueRows = [],
  queueDrilldownOpen = false,
  queueFilterStage = 'all',
  queueSort = 'age',
  queueCursor = 0,
}) {
  if (!selectedPoll) {
    return React.createElement(Text, { color: '#8f98a8' }, 'Select a poll to view desk telemetry.');
  }
  const livePayload = selectedLive?.payload || {};
  const livePoll = livePayload.poll || selectedPoll || {};
  const liveCounts = livePayload.counts && typeof livePayload.counts === 'object' ? livePayload.counts : {};
  const countsTotal = Object.values(liveCounts).reduce((sum, value) => sum + toNumber(value, 0), 0);
  const liveTotal = toNumber(livePayload.total || livePayload.totalVotes, countsTotal);
  const liveOptions = Array.isArray(livePoll.options) ? livePoll.options : [];
  const pieChartText = String(selectedLive?.pieChartText || '').trim();
  const barChartText = String(selectedLive?.barChartText || '').trim();
  const chartRowsMax = Math.max(4, Math.min(9, Math.floor((height - 20) / 3)));
  const pieRows = pieChartText
    ? pieChartText.split('\n').slice(0, chartRowsMax)
    : ['Pie scope unavailable.'];
  const barRows = barChartText
    ? barChartText.split('\n').slice(0, chartRowsMax)
    : ['Bar scope unavailable.'];
  const trendText = String(selectedTrend?.chartText || '').trim();
  const trendRows = trendText
    ? trendText.split('\n').slice(0, Math.max(5, chartRowsMax))
    : ['No trend data available yet.'];
  const tapeRows = Array.isArray(eventTape) && eventTape.length
    ? eventTape.slice(0, Math.max(5, height - 34))
    : ['No desk events yet.'];
  const snapshots = Array.isArray(selectedSnapshots?.snapshots) ? selectedSnapshots.snapshots : [];
  const publishedCount = snapshots.filter((item) => String(item?.state || '').toLowerCase() === 'published').length;
  const scopeRows = buildScopeMetricRows({
    selectedPoll,
    snapshots,
    liveOptions,
    liveCounts,
    liveTotal,
    trendSeries: Array.isArray(selectedTrend?.series) ? selectedTrend.series : [],
  });

  return React.createElement(React.Fragment, null,
    React.createElement(Text, { color: '#8f98a8' }, `Selected ${selectedPoll.id}  status:${selectedPoll.status} visibility:${selectedPoll.visibility}`),
    React.createElement(Text, { color: '#8f98a8' }, sectionLabel(1, focusedPanelIndex, 'LIVE BOARD')),
    React.createElement(Text, { color: '#d0d5df' }, `Question: ${truncate(livePoll.question || selectedPoll.question, Math.max(18, detailWidth - 20))}`),
    React.createElement(Text, { color: '#d0d5df' }, `Votes: ${liveTotal}  snapshots:${snapshots.length} (published:${publishedCount})`),
    ...(liveOptions.length
      ? liveOptions.slice(0, 4).map((option, index) => {
        const count = toNumber(liveCounts[String(index)] ?? liveCounts[index], 0);
        const pct = liveTotal > 0 ? Math.round((count / liveTotal) * 100) : 0;
        return React.createElement(
          Text,
          { key: `desk-live-${index}`, color: '#d0d5df' },
          `${String(index + 1).padStart(2)}. ${truncate(option, Math.max(10, detailWidth - 36)).padEnd(Math.max(10, detailWidth - 36))} ${String(count).padStart(4)} (${String(pct).padStart(3)}%)`,
        );
      })
      : [React.createElement(Text, { key: 'desk-live-empty', color: '#8f98a8' }, 'No options in live payload.')]),
    React.createElement(Text, { color: '#8f98a8' }, '  Scope A: Pie share'),
    ...pieRows.map((line, index) => React.createElement(Text, { key: `desk-pie-${index}` }, line)),
    React.createElement(Text, { color: '#8f98a8' }, '  Scope B: Bar board'),
    ...barRows.map((line, index) => React.createElement(Text, { key: `desk-bar-${index}` }, line)),
    React.createElement(Text, { color: '#8f98a8' }, sectionLabel(2, focusedPanelIndex, `TRENDS (${trendChart}/${trendWindow})`)),
    ...trendRows.map((line, index) => React.createElement(Text, { key: `desk-trend-${index}` }, line)),
    React.createElement(Text, { color: '#8f98a8' }, '  Scope C: Derived metrics'),
    ...scopeRows.map((line, index) => React.createElement(Text, { key: `desk-scope-${index}`, color: '#d0d5df' }, line)),
    React.createElement(Text, { color: '#8f98a8' }, sectionLabel(3, focusedPanelIndex, `QUEUE DRILLDOWN (${queueFilterStage}/${queueSort})`)),
    React.createElement(Text, { color: '#8f98a8' }, queueDrilldownOpen
      ? 'Queue drilldown active: ↑/↓ move · Enter jump to poll · F filter · Z sort · Esc close'
      : 'Press Q to open queue drilldown (filter/sort + jump).'),
    ...renderQueueRows({ rows: queueRows, queueDrilldownOpen, queueCursor, detailWidth }),
    React.createElement(Text, { color: '#8f98a8' }, sectionLabel(4, focusedPanelIndex, 'ALERT LADDER')),
    ...selectedAlerts.map((alert, index) => React.createElement(
      Text,
      { key: `desk-alert-${index}`, color: alert.level === 'crit' ? '#ff7b72' : alert.level === 'warn' ? '#ffcc66' : '#a6e3a1' },
      `${String(alert.level || '').toUpperCase().padEnd(5)} ${String(alert.text || '')}`,
    )),
    React.createElement(Text, { color: '#8f98a8' }, sectionLabel(5, focusedPanelIndex, 'EVENT TAPE')),
    ...tapeRows.map((line, index) => React.createElement(Text, { key: `desk-tape-${index}`, color: '#8f98a8' }, line)),
    React.createElement(Text, { color: '#8f98a8' }, sectionLabel(6, focusedPanelIndex, 'ACTION RAIL')),
    React.createElement(Text, { color: '#d0d5df' }, 'B compose publish note · P publish snapshot · D draft snapshot · O promote latest'),
    React.createElement(Text, { color: '#d0d5df' }, 'T publish defs (test) · p publish defs (prod) · Space pause refresh'),
  );
}

export function PollsDeskPublishNoteComposer({
  selectedPoll,
  draft,
  fieldIndex = 0,
  typing = false,
  buffer = '',
}) {
  const fields = [
    { key: 'headline', label: 'HEADLINE', type: 'text', hint: 'Short release headline' },
    { key: 'body', label: 'SUMMARY NOTE', type: 'text', hint: 'Markdown summary for official snapshot publication' },
    { key: 'publish', label: 'PUBLISH NOW', type: 'bool', hint: 'false keeps it as draft snapshot' },
  ];
  const activeField = fields[fieldIndex] || fields[0];
  return React.createElement(React.Fragment, null,
    React.createElement(Text, { color: '#8f98a8' }, `Publish note composer for ${selectedPoll?.id || 'poll'}  (Esc close, Enter edit, S submit)`),
    ...fields.map((field, index) => {
      const value = field.type === 'bool'
        ? (draft?.[field.key] ? 'true' : 'false')
        : String(draft?.[field.key] || '');
      const line = `${field.label.padEnd(14)} ${value}`;
      if (index === fieldIndex) {
        const active = typing && activeField.key === field.key ? ` > ${buffer}` : line;
        return React.createElement(Text, { key: field.key, inverse: true }, active);
      }
      return React.createElement(Text, { key: field.key, color: '#d0d5df' }, line);
    }),
    React.createElement(Text, { color: '#8f98a8' }, activeField.hint),
    typing
      ? React.createElement(Text, { color: '#8f98a8' }, 'Typing mode: Enter commit, Esc cancel.')
      : React.createElement(Text, { color: '#8f98a8' }, 'Field mode: ↑/↓ move, Enter edit text, Space toggle bool, S submit.'),
  );
}
