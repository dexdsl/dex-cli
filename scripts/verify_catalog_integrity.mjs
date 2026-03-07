#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const DATA_PATH = path.join(ROOT, 'public', 'data', 'catalog.data.json');
const ENTRIES_PATH = path.join(ROOT, 'public', 'data', 'catalog.entries.json');
const GUIDE_PATH = path.join(ROOT, 'public', 'data', 'catalog.guide.json');
const SYMBOLS_PATH = path.join(ROOT, 'public', 'data', 'catalog.symbols.json');
const SEARCH_PATH = path.join(ROOT, 'public', 'data', 'catalog.search.json');
const SEASONS_PATH = path.join(ROOT, 'public', 'data', 'catalog.seasons.json');
const EDITORIAL_PATH = path.join(ROOT, 'public', 'data', 'catalog.editorial.json');
const CURATION_SNAPSHOT_PATH = path.join(ROOT, 'public', 'data', 'catalog.curation.snapshot.json');
const HOME_SNAPSHOT_PATH = path.join(ROOT, 'public', 'data', 'home.featured.snapshot.json');

const INDEX_PAGE_PATH = path.join(ROOT, 'docs', 'catalog', 'index.html');
const HOME_PAGE_PATH = path.join(ROOT, 'docs', 'index.html');
const HOW_PAGE_PATH = path.join(ROOT, 'docs', 'catalog', 'how', 'index.html');
const SYMBOLS_PAGE_PATH = path.join(ROOT, 'docs', 'catalog', 'symbols', 'index.html');
const LOOKUP_REDIRECT_PATH = path.join(ROOT, 'docs', 'catalog', 'lookup', 'index.html');
const INDEX_RUNTIME_SOURCE_PATH = path.join(ROOT, 'scripts', 'src', 'catalog.index.entry.mjs');

const REQUIRED_MODEL_KEYS = ['entries', 'spotlight', 'guide', 'symbols', 'anchors', 'stats'];

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

function countProtectedChars(value) {
  if (typeof value === 'string') {
    const match = value.match(/[\u00A0\u200B\u200C\u200D]/g);
    return match ? match.length : 0;
  }
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countProtectedChars(item), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + countProtectedChars(item), 0);
  return 0;
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

  const model = readJson(DATA_PATH);
  const entriesModel = readJson(ENTRIES_PATH);
  const guideModel = readJson(GUIDE_PATH);
  const symbolsModel = readJson(SYMBOLS_PATH);
  const searchModel = readJson(SEARCH_PATH);
  const seasonsModel = readJson(SEASONS_PATH);
  const editorialModel = readJson(EDITORIAL_PATH);
  const curationSnapshot = readJson(CURATION_SNAPSHOT_PATH);
  const homeSnapshot = readJson(HOME_SNAPSHOT_PATH);

  for (const key of REQUIRED_MODEL_KEYS) {
    if (!(key in model)) failures.push(`catalog model missing key: ${key}`);
  }

  if (!Array.isArray(model.entries) || model.entries.length === 0) {
    failures.push('catalog model entries is empty');
  }

  if (!Array.isArray(entriesModel.entries) || entriesModel.entries.length === 0) {
    failures.push('catalog entries data is empty');
  }

  if (!Array.isArray(searchModel.entries) || searchModel.entries.length === 0) {
    failures.push('catalog search index is empty');
  }

  if (!Array.isArray(seasonsModel.seasons)) {
    failures.push('catalog seasons config is missing seasons array');
  }
  if (!Array.isArray(editorialModel.manifest)) {
    failures.push('catalog editorial config is missing manifest array');
  }
  if (!Array.isArray(curationSnapshot.manifest)) {
    failures.push('catalog curation snapshot is missing manifest array');
  }
  if (!Array.isArray(homeSnapshot.featured)) {
    failures.push('home featured snapshot is missing featured array');
  }

  const guideParts = Array.isArray(guideModel.parts) ? guideModel.parts : [];
  if (guideParts.length === 0) {
    failures.push('catalog guide data has no parts');
  }

  const symbolCount = ['instrument', 'collection', 'quality', 'qualifier']
    .map((key) => (Array.isArray(symbolsModel[key]) ? symbolsModel[key].length : 0))
    .reduce((sum, count) => sum + count, 0);
  if (symbolCount === 0) {
    failures.push('catalog symbols data has no rows');
  }

  if (Number(entriesModel?.stats?.entries_count || 0) !== model.entries.length) {
    failures.push('catalog.entries stats.entries_count does not match catalog.data entries length');
  }

  const modelEntryHrefs = new Set();
  for (const entry of model.entries || []) {
    const href = String(entry.entry_href || '');
    modelEntryHrefs.add(href);

    if (!href.startsWith('/entry/')) {
      failures.push(`entry href is not canonical local route: ${href}`);
      continue;
    }

    if (/^https?:\/\/(?:www\.)?dexdsl\.(?:org|com)/i.test(href)) {
      failures.push(`entry href is remote and should be local: ${href}`);
    }
  }

  for (const row of searchModel.entries || []) {
    if (!modelEntryHrefs.has(String(row.entry_href || ''))) {
      failures.push(`search row references missing entry href: ${row.entry_href}`);
    }
  }

  const requiredAnchorMap = {
    performer: '#dex-performer',
    instrument: '#dex-instrument',
    lookup: '#dex-lookup',
    how: '#dex-how',
    symbols: '#list-of-identifiers',
  };
  for (const [key, value] of Object.entries(requiredAnchorMap)) {
    if (model?.anchors?.[key] !== value) {
      failures.push(`catalog model anchors.${key} must be ${value}`);
    }
  }

  const modelProtectedCount = countProtectedChars(model);
  if (Number(model?.stats?.protected_char_count || 0) !== modelProtectedCount) {
    failures.push(`catalog.data protected char count drift: stats=${model?.stats?.protected_char_count || 0}, recomputed=${modelProtectedCount}`);
  }

  const entriesProtectedCount = countProtectedChars(entriesModel.entries || []);
  if (Number(entriesModel?.stats?.protected_char_count || 0) !== entriesProtectedCount) {
    failures.push(`catalog.entries protected char count drift: stats=${entriesModel?.stats?.protected_char_count || 0}, recomputed=${entriesProtectedCount}`);
  }

  if (Number(guideModel?.protected_char_count || 0) !== countProtectedChars(guideModel)) {
    failures.push('catalog.guide protected char count drift');
  }

  if (Number(symbolsModel?.protected_char_count || 0) !== countProtectedChars(symbolsModel)) {
    failures.push('catalog.symbols protected char count drift');
  }

  const indexHtml = readText(INDEX_PAGE_PATH);
  const indexMain = getMainHtml(indexHtml);
  if (!indexMain) {
    failures.push('catalog index missing <main id="page">');
  } else {
    if (!indexMain.includes('id="dex-performer"')) failures.push('catalog index main missing id="dex-performer"');
    if (!indexMain.includes('id="dex-instrument"')) failures.push('catalog index main missing id="dex-instrument"');
    if (!indexMain.includes('id="dex-lookup"')) failures.push('catalog index main missing id="dex-lookup"');
    if (indexMain.includes('id="dex-how"')) failures.push('catalog index must not render guide section inline');
    if (indexMain.includes('id="list-of-identifiers"')) failures.push('catalog index must not render symbols section inline');
    if (!indexMain.includes('data-catalog-index-app')) failures.push('catalog index missing data-catalog-index-app root');

    const badLinks = indexMain.match(/https?:\/\/(?:www\.)?dexdsl\.(?:org|com)\/(?:entry|catalog)\//gi) || [];
    if (badLinks.length > 0) {
      failures.push(`catalog index main contains remote catalog/entry links: ${Array.from(new Set(badLinks)).join(', ')}`);
    }
  }

  if (!indexHtml.includes('/css/components/dx-catalog-index.css')) {
    failures.push('catalog index must include /css/components/dx-catalog-index.css');
  }
  if (!indexHtml.includes('/assets/js/catalog.index.js')) {
    failures.push('catalog index must include /assets/js/catalog.index.js');
  }

  const howHtml = readText(HOW_PAGE_PATH);
  const howMain = getMainHtml(howHtml);
  if (!howMain) {
    failures.push('catalog how page missing <main id="page">');
  } else {
    if (!howMain.includes('data-catalog-how-app')) failures.push('catalog how main missing data-catalog-how-app root');
    if (!howMain.includes('id="dex-how"')) failures.push('catalog how main missing id="dex-how"');
  }
  if (!howHtml.includes('/css/components/dx-catalog-how.css')) {
    failures.push('catalog how page must include /css/components/dx-catalog-how.css');
  }
  if (!howHtml.includes('/assets/js/catalog.how.js')) {
    failures.push('catalog how page must include /assets/js/catalog.how.js');
  }

  const symbolsHtml = readText(SYMBOLS_PAGE_PATH);
  const symbolsMain = getMainHtml(symbolsHtml);
  if (!symbolsMain) {
    failures.push('catalog symbols page missing <main id="page">');
  } else {
    if (!symbolsMain.includes('data-catalog-symbols-app')) failures.push('catalog symbols main missing data-catalog-symbols-app root');
    if (!symbolsMain.includes('id="list-of-identifiers"')) failures.push('catalog symbols main missing id="list-of-identifiers"');
  }
  if (!symbolsHtml.includes('/css/components/dx-catalog-symbols.css')) {
    failures.push('catalog symbols page must include /css/components/dx-catalog-symbols.css');
  }
  if (!symbolsHtml.includes('/assets/js/catalog.symbols.js')) {
    failures.push('catalog symbols page must include /assets/js/catalog.symbols.js');
  }

  const lookupRedirectHtml = readText(LOOKUP_REDIRECT_PATH);
  if (!lookupRedirectHtml.includes('/catalog/how/#dex-how')) {
    failures.push('lookup compatibility route must redirect to /catalog/how/#dex-how');
  }

  const homeHtml = readText(HOME_PAGE_PATH);
  if (!homeHtml.includes('/data/home.featured.snapshot.json')) {
    failures.push('home page featured carousel must load /data/home.featured.snapshot.json');
  }
  if (homeHtml.includes('id=\"featured-manifest\"')) {
    failures.push('home page must not source featured cards from inline featured-manifest');
  }

  const indexRuntimeSource = readText(INDEX_RUNTIME_SOURCE_PATH);
  if (!indexRuntimeSource.includes("'#dex-how': '/catalog/how/#dex-how'")) {
    failures.push('catalog index runtime missing #dex-how hash redirect');
  }
  if (!indexRuntimeSource.includes("'#list-of-identifiers': '/catalog/symbols/#list-of-identifiers'")) {
    failures.push('catalog index runtime missing #list-of-identifiers hash redirect');
  }
  if (!indexRuntimeSource.includes('/data/catalog.seasons.json')) {
    failures.push('catalog index runtime missing catalog.seasons fetch source');
  }

  if (failures.length > 0) {
    console.error(`catalog:verify failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`catalog:verify passed (${model.entries.length} entries, ${guideParts.length} guide parts, ${symbolCount} symbols).`);
}

try {
  main();
} catch (error) {
  console.error(`catalog:verify failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
