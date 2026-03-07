#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const ABOUT_HTML_PATH = path.join(ROOT, 'docs', 'about', 'index.html');
const ABOUT_DATA_PATH = path.join(ROOT, 'public', 'data', 'about.data.json');
const ABOUT_CSS_PATH = path.join(ROOT, 'public', 'css', 'components', 'dx-about.css');
const ABOUT_RUNTIME_SOURCE_PATH = path.join(ROOT, 'scripts', 'src', 'about.editorial.entry.mjs');
const ABOUT_RUNTIME_BUNDLE_PATH = path.join(ROOT, 'public', 'assets', 'js', 'dx-about.js');

const REQUIRED_STEP_IDS = [
  'about-hero',
  'about-model',
  'about-impact',
  'about-team',
  'about-partners',
  'about-press',
  'about-contact',
];

const REQUIRED_ALIASES = {
  mission: 'about-hero',
  work: 'about-model',
  impact: 'about-impact',
  team: 'about-team',
  partners: 'about-partners',
  press: 'about-press',
  contact: 'about-contact',
  license: 'about-contact',
};

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function extractAboutShell(html) {
  const marker = '<section class="dx-about-page-shell"';
  const start = html.indexOf(marker);
  if (start < 0) return '';

  const token = /<section\b[^>]*>|<\/section>/gi;
  token.lastIndex = start;
  const first = token.exec(html);
  if (!first || first.index !== start) return '';

  let depth = 1;
  let match;
  while ((match = token.exec(html))) {
    if (/^<\/section/i.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return html.slice(start, token.lastIndex);
    }
  }

  return '';
}

function pushIf(failures, condition, message) {
  if (!condition) failures.push(message);
}

function verifyPageContract(html, failures) {
  pushIf(failures, countMatches(html, /data-dx-about-app/g) === 1, 'about page must include exactly one data-dx-about-app mount');
  pushIf(failures, countMatches(html, /href="\/css\/components\/dx-about\.css"/g) === 1, 'about page must include /css/components/dx-about.css exactly once');
  pushIf(failures, countMatches(html, /src="\/assets\/js\/dx-about\.js"/g) === 1, 'about page must include /assets/js/dx-about.js exactly once');
  pushIf(failures, html.includes('/assets/js/dx-marketing-newsletter.js'), 'about page must include /assets/js/dx-marketing-newsletter.js');
  pushIf(failures, html.includes('window.DEX_ABOUT_CONFIG'), 'about page must include window.DEX_ABOUT_CONFIG');
  pushIf(failures, html.includes('hashAliases'), 'about page DEX_ABOUT_CONFIG must include hashAliases');

  const forbiddenMarkers = [
    'id="dex-about"',
    'id="aboutPrev"',
    'id="aboutNext"',
    'class="pill"',
    'data-goto=',
    'id="teamModal"',
    'id="teamModalTitle"',
    'id="teamModalBody"',
    'id="teamModalClose"',
  ];
  for (const marker of forbiddenMarkers) {
    pushIf(failures, !html.includes(marker), `about page contains forbidden legacy marker: ${marker}`);
  }
  pushIf(failures, !/id="pane-[^"]+"/i.test(html), 'about page must not include legacy pane ids');

  const shell = extractAboutShell(html);
  pushIf(failures, Boolean(shell), 'about page missing .dx-about-page-shell section');
  if (shell) {
    pushIf(failures, !/<style\b/i.test(shell), 'about module container must not include inline <style>');
    pushIf(failures, !/<script\b/i.test(shell), 'about module container must not include inline <script>');
    pushIf(failures, shell.includes('data-dx-about-app'), 'about module shell must include data-dx-about-app mount');
  }
}

function verifyRuntimeContract(source, bundle, failures) {
  const requiredSourceMarkers = [
    'mountMarketingNewsletter',
    'data-dx-marketing-newsletter-mount',
    'wireHashCompatibility',
    'IntersectionObserver',
    'about-contact',
  ];
  for (const marker of requiredSourceMarkers) {
    pushIf(failures, source.includes(marker), `about runtime source missing marker: ${marker}`);
  }

  for (const [legacyHash, canonicalHash] of Object.entries(REQUIRED_ALIASES)) {
    pushIf(
      failures,
      source.includes(legacyHash) && source.includes(canonicalHash),
      `about runtime source missing hash alias mapping for ${legacyHash} -> ${canonicalHash}`,
    );
  }

  const requiredBundleMarkers = [
    'data-dx-marketing-newsletter-mount',
    'about-contact',
    'dx-about-progress-link',
  ];
  for (const marker of requiredBundleMarkers) {
    pushIf(failures, bundle.includes(marker), `about runtime bundle missing marker: ${marker}`);
  }
}

function verifyDataContract(data, failures) {
  const requiredKeys = ['hero', 'model', 'impact', 'team', 'partners', 'press', 'contact'];
  for (const key of requiredKeys) {
    pushIf(failures, Boolean(data?.[key]), `about data missing section: ${key}`);
  }

  const stepIds = Array.isArray(data?.steps) ? data.steps.map((step) => String(step?.id || '')) : [];
  pushIf(
    failures,
    JSON.stringify(stepIds) === JSON.stringify(REQUIRED_STEP_IDS),
    `about data steps mismatch. expected=${JSON.stringify(REQUIRED_STEP_IDS)} actual=${JSON.stringify(stepIds)}`,
  );

  const aliases = data?.hashAliases && typeof data.hashAliases === 'object' ? data.hashAliases : {};
  for (const [legacyHash, canonicalHash] of Object.entries(REQUIRED_ALIASES)) {
    pushIf(
      failures,
      String(aliases[legacyHash] || '') === canonicalHash,
      `about data hashAliases missing mapping ${legacyHash} -> ${canonicalHash}`,
    );
  }

  pushIf(
    failures,
    String(data?.contact?.newsletter?.source || '') === 'about-support-page',
    'about contact newsletter source must be "about-support-page"',
  );
}

function main() {
  const failures = [];

  pushIf(failures, fs.existsSync(ABOUT_CSS_PATH), `missing stylesheet ${path.relative(ROOT, ABOUT_CSS_PATH)}`);
  pushIf(failures, fs.existsSync(ABOUT_RUNTIME_BUNDLE_PATH), `missing runtime bundle ${path.relative(ROOT, ABOUT_RUNTIME_BUNDLE_PATH)}`);

  const pageHtml = readText(ABOUT_HTML_PATH);
  const runtimeSource = readText(ABOUT_RUNTIME_SOURCE_PATH);
  const runtimeBundle = readText(ABOUT_RUNTIME_BUNDLE_PATH);
  const data = readJson(ABOUT_DATA_PATH);

  verifyPageContract(pageHtml, failures);
  verifyRuntimeContract(runtimeSource, runtimeBundle, failures);
  verifyDataContract(data, failures);

  if (failures.length > 0) {
    console.error(`verify:about failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:about passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:about failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
