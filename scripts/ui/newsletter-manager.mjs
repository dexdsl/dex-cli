import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import {
  createNewsletterCampaign,
  getNewsletterCampaignStats,
  listNewsletterCampaigns,
  patchNewsletterCampaign,
  scheduleNewsletterCampaign,
  sendNowNewsletterCampaign,
  testSendNewsletterCampaign,
} from '../lib/newsletter-api.mjs';
import { listNewsletterTemplates } from '../lib/newsletter-templates.mjs';
import { renderNewsletterTemplate } from '../lib/newsletter-render.mjs';

const SEGMENT_OPTIONS = ['all_subscribers', 'members', 'contributors', 'status_watchers'];

function safeMessage(error) {
  if (!error) return 'Unknown error';
  return error?.message || String(error);
}

function nowIso() {
  return new Date().toISOString();
}

function openInBrowser(targetPath) {
  try {
    const command = process.platform === 'darwin'
      ? { cmd: 'open', args: [targetPath] }
      : process.platform === 'win32'
        ? { cmd: 'cmd', args: ['/c', 'start', '', targetPath] }
        : { cmd: 'xdg-open', args: [targetPath] };
    spawn(command.cmd, command.args, { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

function truncate(value, max = 84) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return 'draft';
  return value;
}

function formatTime(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 'n/a';
  return new Date(parsed).toISOString().replace('T', ' ').slice(0, 16);
}

function nextInList(list, current, step) {
  const values = Array.isArray(list) ? list : [];
  if (!values.length) return current;
  const index = values.indexOf(current);
  const start = index >= 0 ? index : 0;
  const next = (start + step + values.length) % values.length;
  return values[next];
}

export function NewsletterManager({ onExit, width = 100, height = 24 }) {
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading newsletter campaigns…');
  const [campaigns, setCampaigns] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [stats, setStats] = useState(null);

  const templates = useMemo(() => listNewsletterTemplates(), []);
  const activeTemplate = templates[templateIndex] || templates[0] || null;
  const selectedCampaign = campaigns[selectedIndex] || null;

  const reloadCampaigns = useCallback(async () => {
    setBusy(true);
    try {
      const payload = await listNewsletterCampaigns({ limit: 120 });
      const next = Array.isArray(payload?.campaigns) ? payload.campaigns : [];
      setCampaigns(next);
      setSelectedIndex((previous) => Math.max(0, Math.min(previous, Math.max(0, next.length - 1))));
      setStatusLine(`Loaded ${next.length} campaigns.`);
    } catch (error) {
      setStatusLine(`Load failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const createDraft = useCallback(async () => {
    if (!activeTemplate || busy) return;
    setBusy(true);
    try {
      const rendered = renderNewsletterTemplate({
        templateKey: activeTemplate.key,
        variables: {
          ...activeTemplate.defaultVariables,
          releaseLabel: `Issue ${new Date().toISOString().slice(0, 10)}`,
        },
      });
      const payload = await createNewsletterCampaign({
        name: `Dex Newsletter ${new Date().toISOString().slice(0, 10)}`,
        templateKey: rendered.templateKey,
        subject: rendered.subject,
        preheader: rendered.preheader,
        audienceSegment: 'all_subscribers',
        variables: rendered.variables,
        html: rendered.html,
        text: rendered.text,
      });
      const created = payload?.campaign;
      await reloadCampaigns();
      if (created?.id) {
        setStatusLine(`Created draft ${created.id} (${activeTemplate.key}).`);
      }
    } catch (error) {
      setStatusLine(`Create draft failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeTemplate, busy, reloadCampaigns]);

  const cycleAudience = useCallback(async () => {
    if (!selectedCampaign || busy) return;
    setBusy(true);
    try {
      const nextSegment = nextInList(
        SEGMENT_OPTIONS,
        selectedCampaign.audienceSegment || 'all_subscribers',
        1,
      );
      const payload = await patchNewsletterCampaign(selectedCampaign.id, {
        audienceSegment: nextSegment,
      });
      const updated = payload?.campaign;
      setCampaigns((previous) => previous.map((item) => (item.id === selectedCampaign.id ? (updated || item) : item)));
      setStatusLine(`Updated audience for ${selectedCampaign.id} -> ${nextSegment}.`);
    } catch (error) {
      setStatusLine(`Audience update failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedCampaign, busy]);

  const scheduleSelected = useCallback(async () => {
    if (!selectedCampaign || busy) return;
    setBusy(true);
    try {
      const at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const payload = await scheduleNewsletterCampaign(selectedCampaign.id, at);
      const updated = payload?.campaign;
      setCampaigns((previous) => previous.map((item) => (item.id === selectedCampaign.id ? (updated || item) : item)));
      setStatusLine(`Scheduled ${selectedCampaign.id} for ${at}.`);
    } catch (error) {
      setStatusLine(`Schedule failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedCampaign, busy]);

  const sendNowSelected = useCallback(async () => {
    if (!selectedCampaign || busy) return;
    setBusy(true);
    try {
      const payload = await sendNowNewsletterCampaign(selectedCampaign.id);
      const updated = payload?.campaign;
      setCampaigns((previous) => previous.map((item) => (item.id === selectedCampaign.id ? (updated || item) : item)));
      setStatusLine(`Queued send-now for ${selectedCampaign.id}.`);
    } catch (error) {
      setStatusLine(`Send-now failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedCampaign, busy]);

  const testSendSelected = useCallback(async () => {
    if (!selectedCampaign || busy) return;
    const to = String(process.env.DEX_NEWSLETTER_TEST_EMAIL || '').trim();
    if (!to) {
      setStatusLine('Set DEX_NEWSLETTER_TEST_EMAIL to run test-send from TUI.');
      return;
    }

    setBusy(true);
    try {
      const payload = await testSendNewsletterCampaign(selectedCampaign.id, to);
      setStatusLine(`Test sent ${selectedCampaign.id} -> ${to} (${payload?.id || 'queued'}).`);
    } catch (error) {
      setStatusLine(`Test-send failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedCampaign, busy]);

  const fetchStats = useCallback(async () => {
    if (!selectedCampaign || busy) return;
    setBusy(true);
    try {
      const payload = await getNewsletterCampaignStats(selectedCampaign.id);
      setStats(payload?.stats || null);
      setStatusLine(`Fetched delivery stats for ${selectedCampaign.id}.`);
    } catch (error) {
      setStatusLine(`Stats failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedCampaign, busy]);

  const previewSelected = useCallback(async () => {
    if (!selectedCampaign || busy) return;
    setBusy(true);
    try {
      const tmpDir = path.join(os.tmpdir(), 'dex-newsletter-preview');
      await fs.mkdir(tmpDir, { recursive: true });
      const filePath = path.join(tmpDir, `campaign-${selectedCampaign.id}-${Date.now()}.html`);
      await fs.writeFile(filePath, String(selectedCampaign.html || ''), 'utf8');
      openInBrowser(filePath);
      setStatusLine(`Preview opened: ${filePath}`);
    } catch (error) {
      setStatusLine(`Preview failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedCampaign, busy]);

  useEffect(() => {
    void reloadCampaigns();
  }, [reloadCampaigns]);

  useInput((input, key) => {
    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }
    if (busy) return;

    if (key.upArrow) {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((previous) => Math.min(Math.max(0, campaigns.length - 1), previous + 1));
      return;
    }

    const lower = String(input || '').toLowerCase();
    if (lower === 'r') { void reloadCampaigns(); return; }
    if (lower === 'k') {
      setTemplateIndex((previous) => (templates.length ? (previous + 1) % templates.length : 0));
      return;
    }
    if (lower === 'n') { void createDraft(); return; }
    if (lower === 'a') { void cycleAudience(); return; }
    if (lower === 's') { void scheduleSelected(); return; }
    if (lower === 'x') { void sendNowSelected(); return; }
    if (lower === 't') { void testSendSelected(); return; }
    if (lower === 'g') { void fetchStats(); return; }
    if (lower === 'p') { void previewSelected(); return; }
  });

  const listHeight = Math.max(4, height - 13);
  const windowed = computeWindow({
    total: campaigns.length,
    cursor: selectedIndex,
    height: listHeight,
  });

  return React.createElement(Box, { flexDirection: 'column', width },
    React.createElement(Text, { color: '#8f98a8' }, 'Newsletter manager (Esc return) · n draft · a audience · s schedule +5m · x send-now · t test-send · g stats · p preview · k template · r refresh'),
    React.createElement(Text, { color: '#d0d5df' }, `Template seed: ${activeTemplate ? activeTemplate.key : 'none'} · now ${nowIso().slice(0, 19)}Z`),
    React.createElement(Text, { color: '#6e7688' }, `Campaigns: ${campaigns.length}`),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      windowed.start > 0 ? React.createElement(Text, { key: 'up-ellipsis', color: '#8f98a8' }, '…') : null,
      ...campaigns.slice(windowed.start, windowed.end).map((campaign, localIndex) => {
        const idx = windowed.start + localIndex;
        const line = `${campaign.id}  [${formatStatus(campaign.status)}]  ${campaign.audienceSegment}  ${truncate(campaign.subject, 62)}`;
        return React.createElement(Text, idx === selectedIndex
          ? { key: campaign.id, inverse: true }
          : { key: campaign.id, color: '#d0d5df' }, line);
      }),
      windowed.end < campaigns.length ? React.createElement(Text, { key: 'down-ellipsis', color: '#8f98a8' }, '…') : null,
      !campaigns.length ? React.createElement(Text, { key: 'empty', color: '#8f98a8' }, 'No campaigns yet. Press n to create a draft.') : null,
    ),
    selectedCampaign
      ? React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
          React.createElement(Text, { color: '#8f98a8' }, `Selected: ${selectedCampaign.id}`),
          React.createElement(Text, { color: '#8f98a8' }, `Scheduled: ${formatTime(selectedCampaign.scheduledAt)}`),
          React.createElement(Text, { color: '#8f98a8' }, `Updated:   ${formatTime(selectedCampaign.updatedAt)}`),
        )
      : null,
    stats
      ? React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
          React.createElement(Text, { color: '#8f98a8' }, `Stats → queued:${stats.queued} sent:${stats.sent} failed:${stats.failed} delivered:${stats.delivered} bounced:${stats.bounced} complaints:${stats.complaints} opens:${stats.opens} clicks:${stats.clicks}`),
        )
      : null,
    React.createElement(Text, { color: busy ? '#ffcc66' : '#a6e3a1' }, statusLine),
  );
}
