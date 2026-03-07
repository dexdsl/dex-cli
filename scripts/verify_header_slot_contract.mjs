#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');
const BASE_CSS_PATH = path.join(ROOT, 'public', 'css', 'base.css');
const SLOT_RUNTIME_PATH = path.join(ROOT, 'public', 'assets', 'js', 'header-slot.js');
const AUTH_RUNTIME_PATH = path.join(ROOT, 'public', 'assets', 'dex-auth.js');
const REQUIRED_SCRIPT_TAG_NEEDLE = '/assets/js/header-slot.js';

const REQUIRED_MARKERS = [
  '--dx-slot-top',
  '--dx-slot-content-offset',
  '--dx-layer-gooey',
  '--dx-layer-foreground',
  '--dx-layer-header',
  'body.dx-slot-enabled',
  '#dx-slot-scroll-root',
  '#dx-slot-foreground-root',
];

const REQUIRED_DOC_PATHS = [
  'docs/404.html',
  'docs/catalog/lookup/index.html',
  'docs/dexfest/2024/day1/index.html',
  'docs/entry/submit/index.html',
  'docs/entry/test-entry/index.html',
  'docs/messages.html',
  'docs/test-title/description.html',
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function listHtmlFiles(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listHtmlFiles(absolutePath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(absolutePath);
    }
  }
  return out;
}

function needsHeaderSlotRuntime(html) {
  return html.includes('<main id="page"') || html.includes('id="siteWrapper"') || html.includes('data-page-sections=') || html.includes('data-footer-sections');
}

function verifyCssContract(failures) {
  const css = readText(BASE_CSS_PATH);
  for (const marker of REQUIRED_MARKERS) {
    if (!css.includes(marker)) {
      failures.push(`base.css missing marker: ${marker}`);
    }
  }
}

function verifyGlassParityContract(failures) {
  const baseCss = readText(BASE_CSS_PATH);
  const slotRuntime = readText(SLOT_RUNTIME_PATH);
  const authRuntime = readText(AUTH_RUNTIME_PATH);

  const requiredSlotMarkers = [
    'bootstrapPersistentChromeIfMissing',
    'getHeaderElement(document) || await bootstrapPersistentChromeIfMissing()',
  ];
  for (const marker of requiredSlotMarkers) {
    if (!slotRuntime.includes(marker)) {
      failures.push(`header-slot runtime missing required protected-route bootstrap marker: ${marker}`);
    }
  }

  const requiredBaseCssMarkers = [
    '--dx-glass-shell-bg: var(--dx-header-glass-bg);',
    '--dx-glass-shell-rim: var(--dx-header-glass-rim);',
    '--dx-glass-shell-shadow: var(--dx-header-glass-shadow);',
    '--dx-glass-shell-backdrop: var(--dx-header-glass-backdrop);',
    '.dx-glass-shell--header-match',
    'background: var(--dx-glass-shell-bg);',
    'border: 1px solid var(--dx-glass-shell-rim);',
    'box-shadow: var(--dx-glass-shell-shadow);',
    '-webkit-backdrop-filter: var(--dx-glass-shell-backdrop);',
    'backdrop-filter: var(--dx-glass-shell-backdrop);',
  ];
  for (const marker of requiredBaseCssMarkers) {
    if (!baseCss.includes(marker)) {
      failures.push(`header-glass parity marker missing in base.css: ${marker}`);
    }
  }

  if (!slotRuntime.includes('class="dx-mobile-menu-sheet dx-glass-shell--header-match"')) {
    failures.push('mobile menu sheet is missing dx-glass-shell--header-match class in header-slot runtime');
  }

  const mobileBackdropRule = baseCss.match(/\.dx-mobile-menu-backdrop\s*\{([\s\S]*?)\n\s*\}/);
  if (!mobileBackdropRule) {
    failures.push('could not locate .dx-mobile-menu-backdrop rule in base.css');
  } else {
    const ruleText = mobileBackdropRule[1];
    if (/backdrop-filter\s*:/.test(ruleText) || /-webkit-backdrop-filter\s*:/.test(ruleText)) {
      failures.push('.dx-mobile-menu-backdrop should not apply its own backdrop-filter');
    }
  }

  const mobileSheetRule = baseCss.match(/\.dx-mobile-menu-sheet\s*\{([\s\S]*?)\n\s*\}/);
  if (!mobileSheetRule) {
    failures.push('could not locate .dx-mobile-menu-sheet rule in base.css');
  } else {
    const ruleText = mobileSheetRule[1];
    const blockedDeclarations = ['background:', 'border:', 'box-shadow:', 'backdrop-filter:', '-webkit-backdrop-filter:'];
    for (const declaration of blockedDeclarations) {
      if (ruleText.includes(declaration)) {
        failures.push(`.dx-mobile-menu-sheet should rely on shared utility, found ${declaration}`);
      }
    }
  }

  const forbiddenAuthMarkers = [
    'buildThickerGlassFilter',
    'extractFilterValue',
    'toFixedCssNumber',
    '--dex-neutral-overlay',
    '--dex-menu-overlay',
    '--dex-grain-opacity',
    '#auth-ui-dropdown::after',
  ];
  for (const marker of forbiddenAuthMarkers) {
    if (authRuntime.includes(marker)) {
      failures.push(`auth runtime still contains deprecated tinted/boosted glass marker: ${marker}`);
    }
  }

  const requiredAuthMarkers = [
    '--dex-glass-filter:var(--dex-header-glass-filter',
    '--dex-glass-webkit-filter:var(--dex-header-glass-webkit-filter',
    '#auth-ui-profile-toggle{position:relative;gap:0;border:1px solid var(--dex-glass-border);background:var(--dex-glass-bg);',
    '#auth-ui-dropdown{position:absolute;right:0;top:calc(100% + 10px);',
    'background:var(--dex-glass-bg);box-shadow:var(--dex-glass-shadow);',
    '#auth-ui .dex-menu-item{position:relative;display:grid;',
    'background:var(--dex-glass-bg);box-shadow:var(--dex-glass-shadow);',
    'var headerFilter = filter || webkitFilter || cssHeaderFilter || "saturate(180%) blur(18px)";',
    'ui.style.setProperty("--dex-header-glass-filter", headerFilter);',
    'ui.style.setProperty("--dex-header-glass-webkit-filter", headerFilter);',
  ];
  for (const marker of requiredAuthMarkers) {
    if (!authRuntime.includes(marker)) {
      failures.push(`auth runtime missing required header-glass parity marker: ${marker}`);
    }
  }
}

function verifyHtmlCoverage(failures) {
  if (!fs.existsSync(DOCS_DIR)) {
    failures.push('docs directory is missing');
    return;
  }

  const htmlFiles = listHtmlFiles(DOCS_DIR);
  let requiredCount = 0;

  for (const absolutePath of htmlFiles) {
    const rel = path.relative(ROOT, absolutePath);
    const html = readText(absolutePath);
    const required = needsHeaderSlotRuntime(html);

    if (required) {
      requiredCount += 1;
      if (!html.includes(REQUIRED_SCRIPT_TAG_NEEDLE)) {
        failures.push(`missing header-slot runtime include in ${rel}`);
      }
    }

    const slotOverrideRegex = /#dx-slot-(?:scroll-root|foreground-root)[\s\S]{0,280}?z-index\s*:\s*([0-9]+)/gi;
    let match;
    while ((match = slotOverrideRegex.exec(html)) !== null) {
      const z = Number(match[1]);
      if (Number.isFinite(z) && z >= 1300) {
        failures.push(`slot z-index override too high in ${rel} (z-index: ${z})`);
      }
    }
  }

  for (const relPath of REQUIRED_DOC_PATHS) {
    const absolutePath = path.join(ROOT, relPath);
    const html = readText(absolutePath);
    if (!html.includes(REQUIRED_SCRIPT_TAG_NEEDLE)) {
      failures.push(`required legacy route missing header-slot include: ${relPath}`);
    }
  }

  if (requiredCount === 0) {
    failures.push('no html routes were classified as requiring header-slot runtime');
  }
}

function main() {
  const failures = [];

  readText(SLOT_RUNTIME_PATH);
  readText(AUTH_RUNTIME_PATH);
  verifyCssContract(failures);
  verifyGlassParityContract(failures);
  verifyHtmlCoverage(failures);

  if (failures.length > 0) {
    console.error(`verify:header-slot failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:header-slot passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:header-slot error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
