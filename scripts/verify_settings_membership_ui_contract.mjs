#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SETTINGS_HTML = path.join(ROOT, 'docs', 'entry', 'settings', 'index.html');
const RUNTIME_SRC = path.join(ROOT, 'scripts', 'src', 'settings.membership.entry.mjs');
const RUNTIME_PUBLIC = path.join(ROOT, 'public', 'assets', 'js', 'settings.membership.js');

const CSS_PATHS = [
  path.join(ROOT, 'public', 'css', 'components', 'dx-settings-membership.css'),
  path.join(ROOT, 'css', 'components', 'dx-settings-membership.css'),
  path.join(ROOT, 'docs', 'css', 'components', 'dx-settings-membership.css'),
];

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function requireMarkers(content, markers, context, failures) {
  for (const marker of markers) {
    if (!content.includes(marker)) {
      failures.push(`${context} missing marker: ${marker}`);
    }
  }
}

function verifySettingsHtml(failures) {
  const html = readFile(SETTINGS_HTML);

  requireMarkers(
    html,
    [
      '/css/components/dx-settings-membership.css',
      '/assets/js/settings.membership.js',
      'id="dxMembershipV3Root"',
      'data-dx-membership-root',
      'id="pane-membership"',
    ],
    'settings html',
    failures,
  );

  if (html.includes('Billing history (preview)')) {
    failures.push('settings html still contains preview billing history heading');
  }
}

function verifyRuntime(failures) {
  const src = readFile(RUNTIME_SRC);

  requireMarkers(
    src,
    [
      'window.__DX_SETTINGS_MEMBERSHIP_V3_ENABLED = true',
      'window.__dxSettingsMembershipMount = mountMembershipV3',
      'data-dx-membership-state',
      'data-dx-membership-cta-mode',
      'data-dx-membership-view',
      'cancel-composer',
      'data-dx-membership-rail',
      'data-dx-membership-rail-scrollable',
      'data-dx-tier',
      'data-dx-interval',
      'data-dx-tier-panel',
      'dxMemV3SupportHeading',
      'data-dx-billing-ledger',
      'data-dx-billing-row-status',
      'data-dx-billing-cta-primary',
      'dxMemV3Back',
      'dx-memv3-card--view-swapping',
      'Billing history',
      'dxMemV3RefreshInvoices',
      '/me/invoices?limit=12',
      'syncRailViewportFit',
    ],
    'settings membership runtime source',
    failures,
  );

  if (src.includes('dx-memv3-impact')) {
    failures.push('settings membership runtime still contains internal impact markup');
  }

  if (!fs.existsSync(RUNTIME_PUBLIC)) {
    failures.push('public membership runtime bundle is missing (run settings:membership:build)');
  }
}

function verifyCss(failures) {
  const requiredSelectors = [
    '#dxMembershipV3Root',
    '#dxMembershipV3Root[data-dx-membership-rail-scrollable="true"]',
    '.dx-memv3-tier-grid',
    '.dx-memv3-support-heading',
    '.dx-memv3-tier-kicker',
    '.dx-memv3-tier-price-wrap',
    '.dx-memv3-interval-thumb',
    '.dx-memv3-view-surface',
    '.dx-memv3-back',
    '.dx-memv3-ledger',
    '[data-dx-billing-row-status="paid"]',
    '@media (prefers-reduced-motion: reduce)',
  ];

  for (const cssPath of CSS_PATHS) {
    const css = readFile(cssPath);
    for (const selector of requiredSelectors) {
      if (!css.includes(selector)) {
        failures.push(`${path.relative(ROOT, cssPath)} missing selector marker: ${selector}`);
      }
    }
  }
}

function main() {
  const failures = [];

  verifySettingsHtml(failures);
  verifyRuntime(failures);
  verifyCss(failures);

  if (failures.length) {
    console.error(`verify:settings-membership-ui failed with ${failures.length} issue(s):`);
    failures.forEach((item) => console.error(`- ${item}`));
    process.exit(1);
  }

  console.log('verify:settings-membership-ui passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:settings-membership-ui error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
