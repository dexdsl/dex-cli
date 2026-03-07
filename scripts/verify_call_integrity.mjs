#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const DATA_PATH = path.join(ROOT, 'public', 'data', 'call.data.json');
const REGISTRY_PATH = path.join(ROOT, 'data', 'calls.registry.json');
const JS_PATH = path.join(ROOT, 'public', 'assets', 'js', 'call.editorial.js');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'components', 'dx-call-editorial.css');
const NEWSLETTER_CSS_PATH = path.join(ROOT, 'public', 'css', 'components', 'dx-marketing-newsletter.css');
const RUNTIME_SOURCE_PATH = path.join(ROOT, 'scripts', 'src', 'call.editorial.entry.mjs');
const PAGE_PATH = path.join(ROOT, 'docs', 'call', 'index.html');

const REQUIRED_MAIN_IDS = [
  'call-hero',
  'call-status',
  'call-lanes',
  'call-active',
  'call-mini',
  'call-requireements',
  'call-past',
  'call-newsletter',
];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function getMainHtml(html) {
  const start = html.indexOf('<main id="page"');
  if (start < 0) return '';
  const end = html.indexOf('</main>', start);
  if (end < 0) return '';
  return html.slice(start, end + '</main>'.length);
}

function main() {
  const failures = [];

  if (!fs.existsSync(CSS_PATH)) failures.push(`missing stylesheet ${path.relative(ROOT, CSS_PATH)}`);
  if (!fs.existsSync(NEWSLETTER_CSS_PATH)) failures.push(`missing stylesheet ${path.relative(ROOT, NEWSLETTER_CSS_PATH)}`);
  if (!fs.existsSync(JS_PATH)) failures.push(`missing runtime bundle ${path.relative(ROOT, JS_PATH)}`);

  const registry = readJson(REGISTRY_PATH);
  const model = readJson(DATA_PATH);

  if (registry?.version !== 'calls-registry-v1') failures.push('calls registry version mismatch');
  if (registry?.sequenceGroup !== 'inDex') failures.push('calls registry sequenceGroup must be inDex');
  if (!Array.isArray(registry?.calls) || registry.calls.length < 2) failures.push('calls registry must include at least two calls');
  const activeCalls = Array.isArray(registry?.calls) ? registry.calls.filter((call) => String(call?.status || '').trim() === 'active') : [];
  if (activeCalls.length !== 1) failures.push(`calls registry must include exactly one active call; found ${activeCalls.length}`);
  if (!String(registry?.activeCallId || '').trim()) failures.push('calls registry missing activeCallId');
  if (String(registry?.activeCallId || '').trim() && !activeCalls.some((call) => call.id === registry.activeCallId)) {
    failures.push('calls registry activeCallId must match the active call id');
  }
  const seenSequences = new Set();
  for (const call of Array.isArray(registry?.calls) ? registry.calls : []) {
    const sequence = Number(call?.sequence || 0);
    if (!Number.isFinite(sequence) || sequence < 1) {
      failures.push(`calls registry call ${call?.id || '(unknown)'} has invalid sequence`);
      continue;
    }
    if (seenSequences.has(sequence)) failures.push(`calls registry has duplicate sequence ${sequence}`);
    seenSequences.add(sequence);
  }

  if (!model?.hero?.heading_raw) failures.push('call data missing hero.heading_raw');
  if (!Array.isArray(model?.lanes) || model.lanes.length < 4) failures.push('call data lanes must contain at least four items');
  if (!model?.active_call?.cycle_raw) failures.push('call data missing active_call.cycle_raw');
  if (!Array.isArray(model?.calls) || model.calls.length < 2) failures.push('call data missing canonical calls array');
  if (!model?.registry?.activeCallId) failures.push('call data missing registry.activeCallId');
  if (!Array.isArray(model?.requirements?.items_raw) || model.requirements.items_raw.length < 4) failures.push('call data missing requirements items');
  if (!Array.isArray(model?.past_calls?.entries) || model.past_calls.entries.length < 1) failures.push('call data missing past call entries');
  if (!model?.newsletter?.prompt_raw) failures.push('call data missing newsletter prompt');

  const pageHtml = readText(PAGE_PATH);
  const runtimeSource = readText(RUNTIME_SOURCE_PATH);
  if (!runtimeSource.includes('mountMarketingNewsletter')) {
    failures.push('call runtime must mount shared marketing newsletter component');
  }
  if (!runtimeSource.includes('data-dx-marketing-newsletter-mount')) {
    failures.push('call runtime missing canonical marketing newsletter mount marker');
  }

  const mainHtml = getMainHtml(pageHtml);
  if (!mainHtml) {
    failures.push('call page missing <main id="page">');
  } else {
    if (!mainHtml.includes('data-call-editorial-app')) failures.push('call page missing data-call-editorial-app root');
    for (const id of REQUIRED_MAIN_IDS) {
      if (!mainHtml.includes(`id="${id}"`)) failures.push(`call page main missing section id="${id}"`);
    }
    if (mainHtml.includes("Y.use('legacysite-form-submit'")) {
      failures.push('call page main still contains legacy newsletter submit runtime');
    }
    if (mainHtml.includes('section.page-section')) {
      failures.push('call page main still contains snapshot page-section blocks');
    }
    if (!mainHtml.includes('data-dx-marketing-newsletter-mount="call-page"')) {
      failures.push('call page main missing canonical marketing newsletter mount marker');
    }
  }

  if (!pageHtml.includes('/css/components/dx-call-editorial.css')) {
    failures.push('call page must include /css/components/dx-call-editorial.css');
  }
  if (!pageHtml.includes('/css/components/dx-marketing-newsletter.css')) {
    failures.push('call page must include /css/components/dx-marketing-newsletter.css');
  }
  if (!pageHtml.includes('/assets/dex-runtime-config.js')) {
    failures.push('call page must include /assets/dex-runtime-config.js');
  }
  if (!pageHtml.includes('/assets/js/call.editorial.js')) {
    failures.push('call page must include /assets/js/call.editorial.js');
  }
  if (!pageHtml.includes('challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')) {
    failures.push('call page must include turnstile runtime');
  }
  if (pageHtml.includes('chimpstatic.com')) {
    failures.push('call page must not include chimpstatic.com');
  }
  if (pageHtml.includes('id="mcjs"')) {
    failures.push('call page must not include id="mcjs"');
  }
  if (pageHtml.includes("Y.use('legacysite-form-submit'")) {
    failures.push('call page must not include legacy newsletter form runtime');
  }

  if (failures.length > 0) {
    console.error(`verify:call failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:call passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:call failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
