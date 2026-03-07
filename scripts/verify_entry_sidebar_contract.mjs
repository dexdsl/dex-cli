#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function fail(message) {
  throw new Error(message);
}

async function read(relativePath) {
  const absolute = path.resolve(relativePath);
  return fs.readFile(absolute, 'utf8');
}

async function ensureFileExists(relativePath) {
  const absolute = path.resolve(relativePath);
  try {
    await fs.access(absolute);
  } catch {
    fail(`missing required series asset: ${relativePath}`);
  }
}

function ensureOrderedSections(html) {
  const overviewIdx = html.indexOf('<section class="dex-overview"></section>');
  const collectionsIdx = html.indexOf('<section class="dex-collections"></section>');
  const licenseIdx = html.indexOf('<section class="dex-license"></section>');
  if (overviewIdx < 0) fail('entry-template missing .dex-overview section');
  if (collectionsIdx < 0) fail('entry-template missing .dex-collections section');
  if (licenseIdx < 0) fail('entry-template missing .dex-license section');
  if (!(overviewIdx < collectionsIdx && collectionsIdx < licenseIdx)) {
    fail('entry-template sidebar sections must be ordered overview -> collections -> license');
  }
}

function ensureRecordingIndexSecondary(templateCss) {
  const primaryBlockRx = /\.dex-sidebar\s+\.dex-license-controls\s+\.copy-btn,[\s\S]*?\.dex-sidebar\s+#downloads\s+\.btn-video\s*\{[\s\S]*?\}/i;
  const match = templateCss.match(primaryBlockRx);
  if (!match) fail('template CSS missing primary CTA block for license/download buttons');
  if (/btn-recording-index/i.test(match[0])) {
    fail('template primary CTA selector must not include .btn-recording-index');
  }
  if (!/\.dex-sidebar\s+#downloads\s+\.btn-recording-index\s*\{/i.test(templateCss)) {
    fail('template CSS missing explicit secondary style block for .btn-recording-index');
  }
}

function ensureRuntimeMarkers(runtimeJs) {
  const required = [
    'buildDownloadRows',
    'getDownloadModalConfig',
    'Download selected',
    'data-person-linkable="true"',
    'bindEntryTooltips',
    'COLLECTION',
    'COLLECTION_HEADING_CANONICAL',
    'randomizeTitle(COLLECTION_HEADING_CANONICAL',
    '.dex-collections',
    'data-dx-tooltip-status=',
    'data-dx-tooltip-file-types=',
    'data-dx-tooltip-video-quality=',
    'data-dx-tooltip-audio-mp3=',
    'data-dx-tooltip-audio-wav=',
    'data-dx-tooltip-video-1080p=',
    'data-dx-tooltip-video-4k=',
    'data-dx-tooltip-video-1080p-available=',
    'data-dx-tooltip-video-4k-available=',
    'data-dx-tooltip-total-files=',
    'buildEntryTooltipMarkup',
    'dx-submit-tooltip-status',
    'class="btn-download dx-button-element--primary"',
    'attachUnifiedDownload(cfg, \'#downloads .btn-download\'',
    'data-dx-download-kind="recording-index-pdf"',
    'data-dx-entry-rail-mode',
    'DX_ENTRY_TARGET_TIMEOUT_MS = 15000',
    'ENTRY_FETCH_TARGET_SPECS',
    'markAllEntryFetchTargets',
    'bindHeaderFetchLifecycle',
    'bindDescriptionFetchLifecycle',
    'bindMediaFetchLifecycle',
    'data-dx-entry-fetch-target',
    'TOOLTIP_FETCH_SHELL_MARKER',
    'setTooltipFetchState(layer, FETCH_STATE_LOADING)',
  ];
  for (const marker of required) {
    if (!runtimeJs.includes(marker)) {
      fail(`runtime missing marker: ${marker}`);
    }
  }
}

function ensureCollectionHeadingLigatureContract(dexCss) {
  const headingRule = /body\.dx-entry-page\s+\.dex-collections\s*>\s*h3\[data-dx-entry-heading(?:="1")?\][\s\S]*?\{([\s\S]*?)\}/i.exec(dexCss);
  if (!headingRule) {
    fail('dex.css missing body.dx-entry-page .dex-collections > h3[data-dx-entry-heading] rule');
  }
  const ruleBody = headingRule[1];
  if (/font-variant-ligatures\s*:\s*none/i.test(ruleBody)) {
    fail('collection heading rule must not disable ligatures');
  }
  if (/font-feature-settings\s*:\s*"liga"\s*0/i.test(ruleBody)) {
    fail('collection heading rule must not disable liga/calt');
  }
  if (!/font-variant-ligatures\s*:\s*common-ligatures/i.test(ruleBody)) {
    fail('collection heading rule missing ligature-enabled declaration');
  }
}

function ensureTooltipCssContract(dexCss) {
  const legacyPseudoTooltipRx = /dx-bucket-tile\[data-dx-tooltip\]:(?:hover|focus-visible)::after/i;
  if (legacyPseudoTooltipRx.test(dexCss)) {
    fail('dex.css still contains legacy pseudo-element tooltip renderer for bucket tiles');
  }
  const requiredMarkers = [
    '#dx-submit-tooltip-layer .dx-submit-tooltip-head',
    '#dx-submit-tooltip-layer[data-dx-fetch-state="loading"]',
    '#dx-submit-tooltip-layer .dx-fetch-shell-overlay[data-dx-tooltip-fetch-shell="1"]',
    '.dx-submit-tooltip-status.is-available',
    '.dx-submit-tooltip-metric dt',
    '.overview-item--buckets',
  ];
  for (const marker of requiredMarkers) {
    if (!dexCss.includes(marker)) {
      fail(`dex.css missing tooltip polish marker: ${marker}`);
    }
  }
}

function ensureCompilerMarkers(entryHtmlSource) {
  const required = [
    'linksByPerson',
    'instrumentLinksEnabled',
    'normalizeLinksByPerson',
  ];
  for (const marker of required) {
    if (!entryHtmlSource.includes(marker)) {
      fail(`entry HTML compiler missing marker: ${marker}`);
    }
  }
}

async function main() {
  const [templateHtml, runtimeJs, entryHtmlSource, dexCss] = await Promise.all([
    read('entry-template/index.html'),
    read('assets/dex-sidebar.js'),
    read('scripts/lib/entry-html.mjs'),
    read('assets/css/dex.css'),
  ]);

  await Promise.all([
    ensureFileExists('public/assets/series/dex.png'),
    ensureFileExists('public/assets/series/index.png'),
    ensureFileExists('public/assets/series/dexfest.png'),
  ]);

  ensureOrderedSections(templateHtml);
  ensureRecordingIndexSecondary(templateHtml);
  ensureRuntimeMarkers(runtimeJs);
  ensureCollectionHeadingLigatureContract(dexCss);
  ensureTooltipCssContract(dexCss);
  ensureCompilerMarkers(entryHtmlSource);
  console.log('verify:entry-sidebar-contract passed');
}

main().catch((error) => {
  console.error(`verify:entry-sidebar-contract failed: ${error.message || String(error)}`);
  process.exit(1);
});
