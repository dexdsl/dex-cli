#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SETTINGS_HTML = path.join(ROOT, 'docs', 'entry', 'settings', 'index.html');
const RUNTIME_SRC = path.join(ROOT, 'scripts', 'src', 'settings.profile.entry.mjs');
const RUNTIME_BUNDLE = path.join(ROOT, 'public', 'assets', 'js', 'settings.profile.js');
const TAXONOMY_PATH = path.join(ROOT, 'public', 'data', 'profile-taxonomy.json');
const CSS_PATHS = [
  path.join(ROOT, 'public', 'css', 'components', 'dx-settings-profile.css'),
  path.join(ROOT, 'css', 'components', 'dx-settings-profile.css'),
  path.join(ROOT, 'docs', 'css', 'components', 'dx-settings-profile.css'),
];

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function requireMarkers(content, markers, context, failures) {
  markers.forEach((marker) => {
    if (!content.includes(marker)) failures.push(`${context} missing marker: ${marker}`);
  });
}

function verifySettingsHtml(failures) {
  const html = readFile(SETTINGS_HTML);

  requireMarkers(
    html,
    [
      '/css/components/dx-settings-profile.css',
      '/assets/js/settings.profile.js',
      'data-dx-settings-profile="v1"',
      'data-dx-profile-identity-card="true"',
      'data-dx-contrib-profile-card="true"',
      'id="creditNameInput"',
      'id="creditAliasInput"',
      'id="submitDefaultCategory"',
      'id="profileInsightsSummary"',
    ],
    'settings html',
    failures,
  );

  if (html.includes('id="creditNameRO"')) {
    failures.push('settings html still contains legacy readonly credit marker (#creditNameRO)');
  }

  if (html.includes('const roleOptions = [') || html.includes('const instrumentSuggest = [')) {
    failures.push('settings html still contains legacy inline profile runtime markers');
  }
}

function verifyRuntime(failures) {
  const src = readFile(RUNTIME_SRC);
  requireMarkers(
    src,
    [
      'window.__DX_SETTINGS_PROFILE_V1_ENABLED',
      'window.__dxSettingsProfileRuntimeV1',
      'dx:profile:updated',
      '/me/profile',
      '/me/submissions?limit=',
      'credit_aliases',
      'role_primary',
      'instrument_primary',
      'submit_defaults',
    ],
    'settings profile runtime source',
    failures,
  );

  if (!fs.existsSync(RUNTIME_BUNDLE)) {
    failures.push('public settings profile runtime bundle is missing (run settings:profile:build)');
  }
}

function verifyTaxonomy(failures) {
  const taxonomyRaw = readFile(TAXONOMY_PATH);
  let taxonomy = null;
  try {
    taxonomy = JSON.parse(taxonomyRaw);
  } catch {
    failures.push('public/data/profile-taxonomy.json is not valid JSON');
    return;
  }
  if (!taxonomy || typeof taxonomy !== 'object') {
    failures.push('public/data/profile-taxonomy.json must contain an object');
    return;
  }
  if (!Array.isArray(taxonomy.roles) || taxonomy.roles.length < 5) {
    failures.push('public/data/profile-taxonomy.json must include roles[] with at least 5 entries');
  }
  if (!Array.isArray(taxonomy.instruments) || taxonomy.instruments.length < 8) {
    failures.push('public/data/profile-taxonomy.json must include instruments[] with at least 8 entries');
  }
}

function verifyCss(failures) {
  const requiredMarkers = [
    '[data-dx-settings-profile="v1"] .dx-profile-stack',
    '[data-dx-settings-profile="v1"] .dx-profile-subcard',
    '[data-dx-settings-profile="v1"] .dx-profile-input',
    '[data-dx-settings-profile="v1"] .dx-profile-default-grid',
    '@media (prefers-reduced-motion: reduce)',
  ];

  CSS_PATHS.forEach((cssPath) => {
    const css = readFile(cssPath);
    requireMarkers(css, requiredMarkers, path.relative(ROOT, cssPath), failures);
  });
}

function main() {
  const failures = [];
  verifySettingsHtml(failures);
  verifyRuntime(failures);
  verifyTaxonomy(failures);
  verifyCss(failures);

  if (failures.length) {
    console.error(`verify:settings-profile failed with ${failures.length} issue(s):`);
    failures.forEach((item) => console.error(`- ${item}`));
    process.exit(1);
  }

  console.log('verify:settings-profile passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:settings-profile error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
