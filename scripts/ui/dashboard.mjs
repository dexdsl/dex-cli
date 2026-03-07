import process from 'node:process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import cliCursor from 'cli-cursor';
import { InitWizard } from './init-wizard.mjs';
import { UpdateWizard } from './update-wizard.mjs';
import { DoctorScreen } from './doctor-screen.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import { computeWindow } from './rolodex.mjs';
import { startViewer } from '../lib/viewer-server.mjs';
import { PollsManager } from './polls-manager.mjs';
import { CallsManager } from './calls-manager.mjs';
import { StatusManager } from './status-manager.mjs';
import { NewsletterManager } from './newsletter-manager.mjs';
import { CatalogManager } from './catalog-manager.mjs';
import { HomeFeaturedManager } from './home-featured-manager.mjs';
import { DexNotesManager } from './dex-notes-manager.mjs';
import { ProtectedAssetsManager } from './protected-assets-manager.mjs';
import { EntryAuditManager } from './entry-audit-manager.mjs';
import { LinksManager } from './links-manager.mjs';

const MENU_SECTIONS = [
  {
    id: 'entry',
    label: 'Entry Commands',
    items: [
      { id: 'init', label: 'Init', description: 'Create a new entry via wizard' },
      { id: 'update', label: 'Update', description: 'Rehydrate and edit an existing entry' },
      { id: 'doctor', label: 'Doctor', description: 'Health and drift checks with safe repair' },
      { id: 'entry-audit', label: 'Entry Audit', description: 'Run entry runtime production-readiness checks' },
    ],
  },
  {
    id: 'content',
    label: 'Content Commands',
    items: [
      { id: 'catalog', label: 'Catalog', description: 'Manage catalog manifest, spotlight, and live publish controls' },
      { id: 'home', label: 'Home', description: 'Manage featured home entries and live publish controls' },
      { id: 'notes', label: 'Notes', description: 'Manage Dex Notes markdown pages and editorial build flow' },
      { id: 'polls', label: 'Polls', description: 'Inspect in-repo polls catalog (Esc to return)' },
      { id: 'calls', label: 'Calls', description: 'Manage canonical IN DEX calls registry and active state' },
      { id: 'newsletter', label: 'Newsletter', description: 'Manage newsletter drafts, segments, sends, and stats' },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure Commands',
    items: [
      { id: 'links', label: 'Links', description: 'Open staff operational links in your default browser' },
      { id: 'assets', label: 'Assets', description: 'Validate/publish protected asset lookups (Esc to return)' },
      { id: 'status', label: 'Status', description: 'Manage status incidents and generate incident pages' },
      { id: 'deploy', label: 'Deploy', description: 'Push current branch to origin (staff shortcut)' },
      { id: 'view', label: 'View', description: 'Launch localhost viewer for generated entries' },
    ],
  },
];
const MENU_ITEMS = MENU_SECTIONS.flatMap((section) => section.items);
const MODE_ITEMS = new Set(['init', 'update', 'doctor', 'entry-audit', 'polls', 'calls', 'catalog', 'home', 'notes', 'links', 'assets', 'status', 'newsletter']);
const PALETTE_ITEMS = MENU_ITEMS.map((item) => item.id);
const LOGO = [
  '██████╗ ███████╗██╗  ██╗',
  '██╔══██╗██╔════╝╚██╗██╔╝',
  '██║  ██║█████╗   ╚███╔╝ ',
  '██║  ██║██╔══╝   ██╔██╗ ',
  '██████╔╝███████╗██╔╝ ██╗',
  '╚═════╝ ╚══════╝╚═╝  ╚═╝',
];

function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0; let g = 0; let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function renderLogoLine(line, y, tick) {
  let out = '';
  for (let x = 0; x < line.length; x += 1) {
    const ch = line[x];
    if (ch === ' ') { out += ' '; continue; }
    const intensity = 0.55 + 0.45 * Math.sin(tick * 0.18 + x * 0.27 + y * 0.51);
    const hue = (210 + x * 5 + tick * 2.4 + y * 8) % 360;
    const { r, g, b } = hsvToRgb(hue, 0.7, Math.min(1, Math.max(0, 0.3 + intensity * 0.7)));
    out += chalk.rgb(r, g, b)(ch);
  }
  return out;
}

function badge(text, fg = '#d0d5df', bg = '#313745') {
  return chalk.hex(bg).bold(` ${chalk.hex(fg)(text)} `);
}

function DashboardApp({ initialPaletteOpen, initialMode = 'menu', version, noAnim, workspace }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({ cols: stdout?.columns || 80, rows: stdout?.rows || 24 });
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(initialPaletteOpen);
  const [query, setQuery] = useState('');
  const [paletteSelected, setPaletteSelected] = useState(0);
  const [mode, setMode] = useState(initialPaletteOpen ? 'palette' : initialMode);
  const [lastResult, setLastResult] = useState('');
  const [viewerLaunchBusy, setViewerLaunchBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [viewerUrl, setViewerUrl] = useState('');
  const [viewerServer, setViewerServer] = useState(null);

  const cols = dimensions.cols;
  const rows = dimensions.rows;

  useEffect(() => {
    const onResize = () => setDimensions({ cols: stdout?.columns || 80, rows: stdout?.rows || 24 });
    stdout?.on('resize', onResize);
    return () => stdout?.off('resize', onResize);
  }, [stdout]);

  useEffect(() => {
    if (noAnim) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, [noAnim]);

  const logoLines = useMemo(() => LOGO.map((line, y) => renderLogoLine(line, y, noAnim ? 0 : tick)), [noAnim, tick]);
  const filteredPalette = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? PALETTE_ITEMS.filter((item) => item.includes(q)) : PALETTE_ITEMS;
  }, [query]);

  useEffect(() => {
    if (paletteSelected >= filteredPalette.length) setPaletteSelected(Math.max(0, filteredPalette.length - 1));
  }, [filteredPalette, paletteSelected]);

  useEffect(() => () => {
    if (viewerServer && typeof viewerServer.close === 'function') {
      viewerServer.close();
    }
  }, [viewerServer]);

  const launchViewer = async () => {
    if (viewerLaunchBusy) return;
    setViewerLaunchBusy(true);
    try {
      if (viewerServer && viewerUrl) {
        setLastResult(`Viewer already running: ${viewerUrl}`);
      } else {
        const started = await startViewer({
          cwd: process.cwd(),
          open: true,
          port: 4173,
        });
        setViewerServer(started.server);
        setViewerUrl(started.url);
        setLastResult(`Viewer running: ${started.url}`);
      }
    } catch (error) {
      setLastResult(`Viewer failed: ${error?.message || String(error)}`);
    } finally {
      setViewerLaunchBusy(false);
      setMode('menu');
    }
  };

  const runDeploy = async () => {
    if (deployBusy) return;
    setDeployBusy(true);
    try {
      const preflight = spawnSync(
        process.execPath,
        [path.resolve(process.cwd(), 'scripts/dex.mjs'), 'release', 'preflight', '--env', 'test'],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
      if (preflight.status !== 0) {
        const detail = [preflight.stdout, preflight.stderr].filter(Boolean).join(' ').trim();
        setLastResult(`Deploy blocked: preflight failed. ${detail}`);
        return;
      }
      const { runDeployShortcut } = await import('../lib/deploy.mjs');
      const result = runDeployShortcut({ cwd: process.cwd() });
      if (!result.ok) {
        const detail = [result.error, result.stderr, result.output].filter(Boolean).join(' ');
        setLastResult(`Deploy failed: ${detail}`);
      } else {
        const suffix = result.usedSetUpstream ? ' (set upstream)' : '';
        setLastResult(`Deploy ok: pushed ${result.branch} -> ${result.remote}${suffix}`);
      }
    } catch (error) {
      setLastResult(`Deploy failed: ${error?.message || String(error)}`);
    } finally {
      setDeployBusy(false);
      setMode('menu');
    }
  };

  const activateItem = (itemId) => {
    if (itemId === 'view') {
      setPaletteOpen(false);
      void launchViewer();
      return;
    }
    if (itemId === 'deploy') {
      setPaletteOpen(false);
      void runDeploy();
      return;
    }
    if (MODE_ITEMS.has(itemId)) {
      setPaletteOpen(false);
      setMode(itemId);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && (input === 'q' || input === 'Q')) { exit(); return; }
    if (MODE_ITEMS.has(mode)) return;

    if (input === '?') {
      setPaletteOpen((open) => !open);
      setMode((m) => (m === 'palette' ? 'menu' : 'palette'));
      return;
    }

    if (paletteOpen) {
      if (key.escape) { setPaletteOpen(false); setMode('menu'); return; }
      if (key.return) {
        const item = filteredPalette[paletteSelected];
        if (item) activateItem(item);
        return;
      }
      if (key.upArrow) { setPaletteSelected((idx) => (filteredPalette.length ? (idx - 1 + filteredPalette.length) % filteredPalette.length : 0)); return; }
      if (key.downArrow) { setPaletteSelected((idx) => (filteredPalette.length ? (idx + 1) % filteredPalette.length : 0)); return; }
      if (isBackspaceKey(input, key) || key.delete) { setQuery((q) => q.slice(0, -1)); return; }
      if (shouldAppendWizardChar(input, key)) setQuery((q) => q + input);
      return;
    }

    if (key.upArrow) { setSelected((idx) => (idx - 1 + MENU_ITEMS.length) % MENU_ITEMS.length); return; }
    if (key.downArrow) { setSelected((idx) => (idx + 1) % MENU_ITEMS.length); return; }
    if (key.return && MENU_ITEMS[selected]) {
      activateItem(MENU_ITEMS[selected].id);
    }
  });

  const paletteWidth = Math.min(72, Math.max(24, cols - 4));
  const paletteHeight = Math.min(14, Math.max(8, rows - 4));
  const paletteLeft = Math.max(0, Math.floor((cols - paletteWidth) / 2));
  const paletteTop = Math.max(0, Math.floor((rows - paletteHeight) / 2));

  const headerHeight = 13;
  const footerHeight = 3;
  const workspaceHeight = Math.max(6, rows - headerHeight - footerHeight);
  const paletteListHeight = Math.max(3, paletteHeight - 4);
  const paletteWindow = computeWindow({ total: filteredPalette.length, cursor: paletteSelected, height: paletteListHeight });

  const headerTop = `entry creation tool   ${badge(version || 'dev')}`;
  const activeRepo = String(workspace?.activeRepo || 'site');
  const activeRoot = String(workspace?.activeRoot || process.cwd());
  const workspaceLine = `Workspace (${activeRepo}): ${activeRoot}`;

  return React.createElement(Box, { flexDirection: 'column', width: cols, height: rows },
    React.createElement(Box, { height: headerHeight, flexDirection: 'column', justifyContent: 'center', borderStyle: 'single', borderColor: '#343b4a', paddingX: 2 },
      React.createElement(Box, { width: '100%', justifyContent: 'center' },
        React.createElement(Box, { flexDirection: 'column', alignItems: 'center' },
          ...logoLines.map((line, i) => React.createElement(Text, { key: `logo-${i}` }, line)),
          React.createElement(Text, {}, chalk.hex('#8f98a8')(headerTop)),
          React.createElement(Text, {}, chalk.hex('#ffcc66')('DEX CO-OP CORP, FOR INTERNAL USE ONLY')),
          React.createElement(Text, {}, chalk.hex('#8f98a8')('Last updated: 2026-02-20')),
          React.createElement(Text, {}, chalk.hex('#8f98a8')(workspaceLine)),
          React.createElement(Text, {}, chalk.hex('#6e7688')('Tip: dex setup --reset to reconfigure workspace roots')),
        )),
    ),
    React.createElement(Box, { height: workspaceHeight, flexDirection: 'column', borderStyle: 'single', borderColor: '#343b4a', paddingX: 2 },
      mode === 'init'
        ? React.createElement(InitWizard, {
          outDirDefault: './entries',
          onCancel: () => setMode('menu'),
          onDone: (report) => {
            setLastResult(`Last: ✓ Wrote entries/${report.slug}/index.html`);
            setMode('menu');
          },
        })
        : mode === 'update'
          ? React.createElement(UpdateWizard, {
            onCancel: () => setMode('menu'),
            onDone: (report) => {
              setLastResult(`Last: ✓ Updated entries/${report.slug}/index.html`);
              setMode('menu');
            },
          })
          : mode === 'doctor'
            ? React.createElement(DoctorScreen, {
              onExit: () => setMode('menu'),
            })
            : mode === 'entry-audit'
              ? React.createElement(EntryAuditManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
            : mode === 'polls'
              ? React.createElement(PollsManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'calls'
              ? React.createElement(CallsManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'catalog'
              ? React.createElement(CatalogManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'home'
              ? React.createElement(HomeFeaturedManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'notes'
              ? React.createElement(DexNotesManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'links'
              ? React.createElement(LinksManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'assets'
              ? React.createElement(ProtectedAssetsManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'status'
              ? React.createElement(StatusManager, {
                onExit: () => setMode('menu'),
                width: Math.max(60, cols - 8),
                height: Math.max(12, workspaceHeight - 2),
              })
              : mode === 'newsletter'
                ? React.createElement(NewsletterManager, {
                  onExit: () => setMode('menu'),
                  width: Math.max(60, cols - 8),
                  height: Math.max(12, workspaceHeight - 2),
                })
        : React.createElement(Box, { flexDirection: 'column' },
          React.createElement(Text, { color: '#8f98a8', dimColor: true }, 'Commands'),
          ...MENU_SECTIONS.flatMap((section, sectionIndex) => {
            const rowsOut = [];
            rowsOut.push(
              React.createElement(Text, { key: `section-${section.id}`, color: '#8f98a8' }, `[${section.label}]`),
            );
            rowsOut.push(
              ...section.items.map((item) => {
                const itemIndex = MENU_ITEMS.findIndex((menuItem) => menuItem.id === item.id);
                return React.createElement(
                  Box,
                  { key: item.id, height: 1 },
                  React.createElement(
                    Text,
                    itemIndex === selected ? { inverse: true } : { color: '#d0d5df' },
                    `${item.label} — ${item.description}`,
                  ),
                );
              }),
            );
            if (sectionIndex < MENU_SECTIONS.length - 1) {
              rowsOut.push(React.createElement(Text, { key: `section-gap-${section.id}` }, ''));
            }
            return rowsOut;
          }),
          lastResult ? React.createElement(Text, { color: '#a6e3a1' }, lastResult) : null,
        ),
    ),
    React.createElement(Box, { height: footerHeight, borderStyle: 'single', borderColor: '#343b4a', paddingX: 2, justifyContent: 'center' },
      React.createElement(Text, { color: '#6e7688' }, 'Enter run   ↑/↓ move   ? palette   Ctrl+Q quit'),
    ),
    paletteOpen && React.createElement(Box, {
      position: 'absolute', left: paletteLeft, top: paletteTop, width: paletteWidth, height: paletteHeight,
      borderStyle: 'round', borderColor: '#4a5367', flexDirection: 'column', paddingX: 1,
    },
    React.createElement(Text, { bold: true }, 'Command palette'),
    React.createElement(Text, { color: '#8f98a8' }, `> ${query}`),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      paletteWindow.start > 0 ? React.createElement(Text, { key: 'palette-up', color: '#8f98a8' }, '…') : null,
      ...(filteredPalette.length
        ? filteredPalette.slice(paletteWindow.start, paletteWindow.end).map((item, localIdx) => {
          const idx = paletteWindow.start + localIdx;
          return React.createElement(Text, idx === paletteSelected ? { key: item, inverse: true } : { key: item, color: '#d0d5df' }, item);
        })
        : [React.createElement(Text, { key: 'none', color: '#8f98a8' }, 'No commands')]),
      paletteWindow.end < filteredPalette.length ? React.createElement(Text, { key: 'palette-down', color: '#8f98a8' }, '…') : null,
    )),
  );
}

export async function runDashboard({
  paletteOpen = false,
  initialMode = 'menu',
  version = 'dev',
  workspace = {},
} = {}) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) return { action: null };

  cliCursor.hide();
  try {
    const instance = render(React.createElement(DashboardApp, {
      initialPaletteOpen: paletteOpen,
      initialMode,
      version,
      workspace,
      noAnim: process.env.DEX_NO_ANIM === '1',
    }), { exitOnCtrlC: true });
    await instance.waitUntilExit();
    return { action: null };
  } finally {
    cliCursor.show();
  }
}
