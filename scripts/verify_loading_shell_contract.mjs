#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const FILES = {
  baseCss: path.join(ROOT, 'public', 'css', 'base.css'),
  dexCss: path.join(ROOT, 'public', 'assets', 'css', 'dex.css'),
  achievementsRuntime: path.join(ROOT, 'scripts', 'src', 'achievements.entry.mjs'),
  achievementsRuntimeBuilt: path.join(ROOT, 'public', 'assets', 'js', 'achievements.js'),
  pollsRuntime: path.join(ROOT, 'public', 'assets', 'js', 'polls.app.js'),
  pollsRuntimeSource: path.join(ROOT, 'scripts', 'src', 'polls.app.entry.mjs'),
  submitRuntime: path.join(ROOT, 'public', 'assets', 'js', 'submit.samples.js'),
  submitRuntimeSource: path.join(ROOT, 'scripts', 'src', 'submit.samples.entry.mjs'),
  messagesRuntime: path.join(ROOT, 'public', 'assets', 'js', 'messages.inbox.js'),
  messagesRuntimeSource: path.join(ROOT, 'scripts', 'src', 'messages.inbox.entry.mjs'),
  pressroomRuntime: path.join(ROOT, 'public', 'assets', 'js', 'pressroom.js'),
  pressroomRuntimeSource: path.join(ROOT, 'scripts', 'src', 'pressroom.entry.mjs'),
  sidebarRuntime: path.join(ROOT, 'public', 'assets', 'dex-sidebar.js'),
};

const COVERED_ROUTES = [
  { file: 'docs/polls/index.html', rootId: 'dex-console' },
  { file: 'docs/entry/favorites/index.html', rootId: 'dex-favorites' },
  { file: 'docs/entry/submit/index.html', rootId: 'dex-submit' },
  { file: 'docs/entry/messages/index.html', rootId: 'dex-msg' },
  { file: 'docs/entry/pressroom/index.html', rootId: 'dex-press' },
  { file: 'docs/entry/settings/index.html', rootId: 'dex-settings' },
  { file: 'docs/entry/achievements/index.html', rootId: 'dex-achv' },
  { file: 'docs/messages.html', rootId: 'dex-msg' },
];

const BANNED_SPINNER_MARKERS = [
  'spinner-overlay',
  'class="spinner"',
  "class='spinner'",
  '.spinner {',
  '.spinner{',
  '@keyframes spin',
];

const REQUIRED_FETCH_TOKENS = [
  '--dx-fetch-min-shell-h',
  '--dx-fetch-shell-radius',
  '--dx-fetch-shell-rim',
  '--dx-fetch-shell-bg',
  '--dx-fetch-shell-shadow',
  '--dx-fetch-sheen-duration',
  '--dx-fetch-sheen-ease',
  '--dx-fetch-sheen-gradient',
];

const REQUIRED_FETCH_CLASS_MARKERS = [
  '.dx-fetch-shell',
  '.dx-fetch-shell--card',
  '.dx-fetch-shell--rows',
  '.dx-fetch-shell-line',
  '.dx-fetch-shell-pill',
  '.dx-fetch-shell-overlay',
  "[data-dx-fetch-state='loading']",
  "[data-dx-fetch-state='ready']",
  "[data-dx-fetch-state='error']",
  '@keyframes dx-fetch-sheen',
];

const ACHIEVEMENTS_RUNTIME_TIMEOUT_MARKERS = [
  'AUTH_READY_TIMEOUT_MS',
  'API_TIMEOUT_MS',
  'DX_MIN_SHEEN_MS = 120',
  '/me/achievements/summary',
  'setFetchState(root, FETCH_STATE_READY)',
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function extractRootTag(htmlText, rootId) {
  const pattern = new RegExp(`<[^>]*\\bid=["']${rootId}["'][^>]*>`, 'i');
  return htmlText.match(pattern)?.[0] || '';
}

function verifyRouteContracts(failures) {
  for (const contract of COVERED_ROUTES) {
    const relPath = contract.file;
    const absolutePath = path.join(ROOT, relPath);
    const html = readText(absolutePath);

    const rootTag = extractRootTag(html, contract.rootId);
    if (!rootTag) {
      failures.push(`${relPath} missing route root id="${contract.rootId}"`);
    } else {
      if (!/data-dx-fetch-state=["']loading["']/.test(rootTag)) {
        failures.push(`${relPath} root is missing data-dx-fetch-state="loading"`);
      }
      if (!/aria-busy=["']true["']/.test(rootTag)) {
        failures.push(`${relPath} root is missing aria-busy="true"`);
      }
    }

    const minSheenInHtml = /DX_MIN_SHEEN_MS\s*=\s*120\b/.test(html);
    const minSheenInPollsRuntime = contract.file === 'docs/polls/index.html'
      && (
        (fs.existsSync(FILES.pollsRuntime)
          && /DX_MIN_SHEEN_MS(?:\s*=\s*120\b|=120\b)/.test(readText(FILES.pollsRuntime)))
        || (fs.existsSync(FILES.pollsRuntimeSource)
          && /DX_MIN_SHEEN_MS\s*=\s*120\b/.test(readText(FILES.pollsRuntimeSource)))
      );
    const minSheenInSubmitRuntime = contract.file === 'docs/entry/submit/index.html'
      && (
        (fs.existsSync(FILES.submitRuntime)
          && /DX_MIN_SHEEN_MS(?:\s*=\s*120\b|=120\b)/.test(readText(FILES.submitRuntime)))
        || (fs.existsSync(FILES.submitRuntimeSource)
          && /DX_MIN_SHEEN_MS\s*=\s*120\b/.test(readText(FILES.submitRuntimeSource)))
      );
    const minSheenInMessagesRuntime = (contract.file === 'docs/entry/messages/index.html' || contract.file === 'docs/messages.html')
      && (
        (fs.existsSync(FILES.messagesRuntime)
          && /DX_MIN_SHEEN_MS(?:\s*=\s*120\b|=120\b)/.test(readText(FILES.messagesRuntime)))
        || (fs.existsSync(FILES.messagesRuntimeSource)
          && /DX_MIN_SHEEN_MS\s*=\s*120\b/.test(readText(FILES.messagesRuntimeSource)))
      );
    const minSheenInPressroomRuntime = contract.file === 'docs/entry/pressroom/index.html'
      && (
        (fs.existsSync(FILES.pressroomRuntime)
          && /DX_MIN_SHEEN_MS(?:\s*=\s*120\b|=120\b)/.test(readText(FILES.pressroomRuntime)))
        || (fs.existsSync(FILES.pressroomRuntimeSource)
          && /DX_MIN_SHEEN_MS\s*=\s*120\b/.test(readText(FILES.pressroomRuntimeSource)))
      );
    const minSheenInAchievementsRuntime = contract.file === 'docs/entry/achievements/index.html'
      && (
        (fs.existsSync(FILES.achievementsRuntimeBuilt)
          && /DX_MIN_SHEEN_MS(?:\s*=\s*120\b|=120\b)/.test(readText(FILES.achievementsRuntimeBuilt)))
        || (fs.existsSync(FILES.achievementsRuntime)
          && /DX_MIN_SHEEN_MS\s*=\s*120\b/.test(readText(FILES.achievementsRuntime)))
      );

    if (
      !minSheenInHtml
      && !minSheenInPollsRuntime
      && !minSheenInSubmitRuntime
      && !minSheenInMessagesRuntime
      && !minSheenInPressroomRuntime
      && !minSheenInAchievementsRuntime
    ) {
      failures.push(`${relPath} missing DX_MIN_SHEEN_MS = 120 contract`);
    }

    for (const banned of BANNED_SPINNER_MARKERS) {
      if (html.includes(banned)) {
        failures.push(`${relPath} still contains spinner marker: ${banned}`);
      }
    }
  }
}

function verifyCssContract(cssPath, cssLabel, failures) {
  const css = readText(cssPath);

  for (const token of REQUIRED_FETCH_TOKENS) {
    if (!css.includes(token)) {
      failures.push(`${cssLabel} missing token ${token}`);
    }
  }

  for (const marker of REQUIRED_FETCH_CLASS_MARKERS) {
    if (!css.includes(marker)) {
      failures.push(`${cssLabel} missing marker ${marker}`);
    }
  }

  if (!css.includes('@media (prefers-reduced-motion: reduce)')) {
    failures.push(`${cssLabel} missing reduced-motion guard`);
  }
}

function verifyAchievementsRuntimeTimeoutContract(failures) {
  const source = fs.existsSync(FILES.achievementsRuntime) ? readText(FILES.achievementsRuntime) : "";
  const built = fs.existsSync(FILES.achievementsRuntimeBuilt) ? readText(FILES.achievementsRuntimeBuilt) : "";
  if (!source && !built) {
    failures.push("achievements runtime missing in scripts/src and public/assets/js");
    return;
  }
  for (const marker of ACHIEVEMENTS_RUNTIME_TIMEOUT_MARKERS) {
    if (!source.includes(marker) && !built.includes(marker)) {
      failures.push(`achievements runtime missing timeout marker: ${marker}`);
    }
  }
}

function verifyEntrySidebarFetchContract(failures) {
  if (!fs.existsSync(FILES.sidebarRuntime)) {
    failures.push('public/assets/dex-sidebar.js missing for entry sidebar fetch contract');
    return;
  }
  const runtime = readText(FILES.sidebarRuntime);
  const requiredMarkers = [
    'ENTRY_FETCH_TARGET_SPECS',
    'data-dx-entry-fetch-target',
    'DX_ENTRY_TARGET_TIMEOUT_MS = 15000',
    'markAllEntryFetchTargets',
    'setTooltipFetchState(layer, FETCH_STATE_LOADING)',
  ];
  for (const marker of requiredMarkers) {
    if (!runtime.includes(marker)) {
      failures.push(`public/assets/dex-sidebar.js missing entry fetch marker ${marker}`);
    }
  }
}

function main() {
  const failures = [];

  verifyRouteContracts(failures);
  verifyAchievementsRuntimeTimeoutContract(failures);
  verifyEntrySidebarFetchContract(failures);
  verifyCssContract(FILES.baseCss, 'public/css/base.css', failures);
  verifyCssContract(FILES.dexCss, 'public/assets/css/dex.css', failures);

  if (failures.length > 0) {
    console.error(`verify:loading-shell failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:loading-shell passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:loading-shell error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
