#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const FILES = {
  html: path.join(ROOT, 'docs', 'entry', 'achievements', 'index.html'),
  runtimeSource: path.join(ROOT, 'scripts', 'src', 'achievements.entry.mjs'),
  runtimeBuilt: path.join(ROOT, 'public', 'assets', 'js', 'achievements.js'),
  css: path.join(ROOT, 'public', 'css', 'components', 'dx-achievements.css'),
  dataRegistry: path.join(ROOT, 'data', 'achievements.registry.json'),
  dataBuilt: path.join(ROOT, 'public', 'data', 'achievements.data.json'),
};

const failures = [];

function readText(filePath, label) {
  if (!fs.existsSync(filePath)) {
    failures.push(`Missing required file: ${label}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function verifyHtmlContract() {
  const html = readText(FILES.html, 'docs/entry/achievements/index.html');
  if (!html) return;

  assert(/id=["']dex-achv["']/.test(html), 'achievements route missing #dex-achv root');
  assert(/data-dx-fetch-state=["']loading["']/.test(html), 'achievements root missing loading fetch-state marker');
  assert(/aria-busy=["']true["']/.test(html), 'achievements root missing aria-busy="true" marker');

  assert(count(html, /href=["']\/css\/components\/dx-achievements\.css["']/g) === 1, 'achievements CSS include must exist exactly once');
  assert(count(html, /src=["']\/assets\/js\/achievements\.js["']/g) === 1, 'achievements runtime include must exist exactly once');

  const bannedMarkers = [
    'data-definition-name="website.components.code"',
    'data-sqsp-block',
    'website.components.code',
    'const SHEET_API',
    'const POLLS_API',
    'jsonpWithTimeout(',
    'AKfycbyh5TPML3_y5-j1QoOKfju_MayO1_0JErwvVkH3Eba195q_EmWGCEu3CdFFeohWes3Qzw/exec',
  ];
  for (const marker of bannedMarkers) {
    assert(!html.includes(marker), `achievements route still contains legacy marker: ${marker}`);
  }

  assert(!/<style[\s>]/i.test(html), 'achievements route should not include inline <style> blocks');
  assert(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'achievements route should not include inline runtime <script> blocks');
}

function verifyRuntimeContract() {
  const source = readText(FILES.runtimeSource, 'scripts/src/achievements.entry.mjs');
  const built = readText(FILES.runtimeBuilt, 'public/assets/js/achievements.js');
  const css = readText(FILES.css, 'public/css/components/dx-achievements.css');

  if (source) {
    const required = [
      'data-dx-achievements-app="v2"',
      'data-dx-achievements-state',
      'data-dx-achievements-page',
      'data-dx-achievement-id',
      'data-dx-achievement-state',
      'data-dx-achievement-secret',
      'dx:achievements:updated',
      'dx:achievements:unlocked',
      '/me/achievements/summary',
      '/me/achievements/history',
      '/me/achievements/seen',
      '/me/achievements/secret-claim',
      'AUTH_READY_TIMEOUT_MS',
      'API_TIMEOUT_MS',
      'DX_MIN_SHEEN_MS = 120',
    ];
    for (const marker of required) {
      assert(source.includes(marker), `achievements runtime source missing marker: ${marker}`);
    }
  }

  if (built) {
    const builtMarkers = ['dx:achievements:updated', '/me/achievements/summary', 'data-dx-achievement-id'];
    for (const marker of builtMarkers) {
      assert(built.includes(marker), `achievements built runtime missing marker: ${marker}`);
    }
  }

  if (css) {
    const cssMarkers = ['.dx-achievement-card', '.dx-achievements-grid', '@media (prefers-reduced-motion: reduce)'];
    for (const marker of cssMarkers) {
      assert(css.includes(marker), `achievements CSS missing marker: ${marker}`);
    }
  }
}

function verifyDataContract() {
  const registry = readText(FILES.dataRegistry, 'data/achievements.registry.json');
  const built = readText(FILES.dataBuilt, 'public/data/achievements.data.json');
  if (registry) {
    assert(registry.includes('catalogVersion'), 'achievements registry missing catalogVersion');
    assert(registry.includes('clueGrowlix'), 'achievements registry missing clueGrowlix fields');
  }
  if (built) {
    assert(built.includes('catalogVersion'), 'achievements data missing catalogVersion');
    assert(built.includes('achievements'), 'achievements data missing achievements array');
  }
}

function main() {
  verifyHtmlContract();
  verifyRuntimeContract();
  verifyDataContract();

  if (failures.length > 0) {
    console.error(`verify:achievements failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:achievements passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:achievements error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
