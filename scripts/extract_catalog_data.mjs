#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCatalogModelFromHtml, buildSearchIndex } from './lib/catalog-model.mjs';
import {
  applyCatalogEditorialToModel,
  buildCatalogManifestSnapshot,
  defaultCatalogEditorialData,
} from './lib/catalog-editorial-store.mjs';
import { normalizeCatalogEditorialFile } from './lib/catalog-editorial-schema.mjs';
import { buildHomeFeaturedSnapshot } from './lib/home-featured-store.mjs';
import { normalizeHomeFeaturedFile } from './lib/home-featured-schema.mjs';

const ROOT = process.cwd();
const SOURCE_PATH = path.join(ROOT, 'docs', 'catalog', 'index.html');
const OUT_DATA_PATH = path.join(ROOT, 'public', 'data', 'catalog.data.json');
const OUT_ENTRIES_PATH = path.join(ROOT, 'public', 'data', 'catalog.entries.json');
const OUT_GUIDE_PATH = path.join(ROOT, 'public', 'data', 'catalog.guide.json');
const OUT_SYMBOLS_PATH = path.join(ROOT, 'public', 'data', 'catalog.symbols.json');
const OUT_SEARCH_PATH = path.join(ROOT, 'public', 'data', 'catalog.search.json');
const OUT_CATALOG_CURATION_SNAPSHOT_PATH = path.join(ROOT, 'public', 'data', 'catalog.curation.snapshot.json');
const OUT_HOME_FEATURED_SNAPSHOT_PATH = path.join(ROOT, 'public', 'data', 'home.featured.snapshot.json');
const FALLBACK_GUIDE_PATH = path.join(ROOT, 'data', 'catalog.guide.json');
const FALLBACK_SYMBOLS_PATH = path.join(ROOT, 'data', 'catalog.symbols.json');
const CATALOG_EDITORIAL_PATH = path.join(ROOT, 'data', 'catalog.editorial.json');
const HOME_FEATURED_PATH = path.join(ROOT, 'data', 'home.featured.json');
const LIVE_CATALOG_URLS = String(process.env.CATALOG_LIVE_URLS || 'https://dexdsl.com/catalog,https://dexdsl.org/catalog')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function deriveLiveUrls(pathname) {
  const next = [];
  for (const raw of LIVE_CATALOG_URLS) {
    try {
      const url = new URL(raw);
      url.pathname = pathname;
      url.search = '';
      url.hash = '';
      next.push(url.toString());
    } catch {
      // Ignore malformed URLs in env override list.
    }
  }
  return Array.from(new Set(next));
}

const LIVE_GUIDE_URLS = deriveLiveUrls('/catalog/how');
const LIVE_SYMBOLS_URLS = deriveLiveUrls('/catalog/symbols');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readGitHeadJson(repoPath) {
  try {
    const jsonText = execFileSync('git', ['show', `HEAD:${repoPath}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function tryReadExistingModel() {
  if (!fs.existsSync(OUT_DATA_PATH)) return null;
  try {
    const existing = JSON.parse(fs.readFileSync(OUT_DATA_PATH, 'utf8'));
    if (Array.isArray(existing.entries) && existing.entries.length > 0) return existing;
  } catch {
    // Ignore malformed existing outputs.
  }
  return null;
}

async function fetchLiveHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'dexdsl-catalog-extract/1.0 (+https://dexdsl.com/catalog)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function tryExtractFromLiveCatalog() {
  for (const url of LIVE_CATALOG_URLS) {
    try {
      const html = await fetchLiveHtml(url);
      const hostname = (() => {
        try {
          return new URL(url).hostname.replace(/\./g, '-');
        } catch {
          return 'live-catalog';
        }
      })();
      const model = buildCatalogModelFromHtml(html, `live-${hostname}-catalog`);
      if (Array.isArray(model.entries) && model.entries.length > 0) {
        return model;
      }
    } catch {
      // Keep probing candidate live URLs.
    }
  }
  return null;
}

function symbolRowCount(symbols) {
  return ['instrument', 'collection', 'quality', 'qualifier']
    .reduce((sum, key) => sum + (Array.isArray(symbols?.[key]) ? symbols[key].length : 0), 0);
}

async function tryExtractAuxModel(urls, labelSuffix) {
  for (const url of urls) {
    try {
      const html = await fetchLiveHtml(url);
      const hostname = (() => {
        try {
          return new URL(url).hostname.replace(/\./g, '-');
        } catch {
          return 'live-catalog';
        }
      })();
      return buildCatalogModelFromHtml(html, `live-${hostname}-${labelSuffix}`);
    } catch {
      // Keep probing candidate live URLs.
    }
  }
  return null;
}

async function enrichGuideAndSymbols(model) {
  const enriched = { ...model };

  const hasGuide = Array.isArray(enriched?.guide?.parts) && enriched.guide.parts.length > 0;
  const hasSymbols = symbolRowCount(enriched?.symbols) > 0;
  if (hasGuide && hasSymbols) return enriched;

  if (!hasGuide) {
    const guideModel = await tryExtractAuxModel(LIVE_GUIDE_URLS, 'catalog-how');
    if (Array.isArray(guideModel?.guide?.parts) && guideModel.guide.parts.length > 0) {
      enriched.guide = guideModel.guide;
    }
  }

  if (!hasSymbols) {
    const symbolsModel = await tryExtractAuxModel(LIVE_SYMBOLS_URLS, 'catalog-symbols');
    if (symbolRowCount(symbolsModel?.symbols) > 0) {
      enriched.symbols = symbolsModel.symbols;
    }
  }

  const stillMissingGuide = !Array.isArray(enriched?.guide?.parts) || enriched.guide.parts.length === 0;
  const stillMissingSymbols = symbolRowCount(enriched?.symbols) === 0;
  if (stillMissingGuide || stillMissingSymbols) {
    const diskGuide = readJsonIfExists(FALLBACK_GUIDE_PATH);
    const diskSymbols = readJsonIfExists(FALLBACK_SYMBOLS_PATH);
    if (stillMissingGuide && Array.isArray(diskGuide?.parts) && diskGuide.parts.length > 0) {
      enriched.guide = {
        intro_raw: String(diskGuide?.intro_raw || ''),
        parts: diskGuide.parts,
        examples: Array.isArray(diskGuide?.examples) ? diskGuide.examples : [],
        anchors: Array.isArray(diskGuide?.anchors) ? diskGuide.anchors : [],
      };
    }
    if (stillMissingSymbols && symbolRowCount(diskSymbols) > 0) {
      enriched.symbols = {
        heading_raw: String(diskSymbols?.heading_raw || 'List of Symbols'),
        instrument: Array.isArray(diskSymbols?.instrument) ? diskSymbols.instrument : [],
        collection: Array.isArray(diskSymbols?.collection) ? diskSymbols.collection : [],
        quality: Array.isArray(diskSymbols?.quality) ? diskSymbols.quality : [],
        qualifier: Array.isArray(diskSymbols?.qualifier) ? diskSymbols.qualifier : [],
      };
    }
  }

  const missingAfterDiskGuide = !Array.isArray(enriched?.guide?.parts) || enriched.guide.parts.length === 0;
  const missingAfterDiskSymbols = symbolRowCount(enriched?.symbols) === 0;
  if (missingAfterDiskGuide || missingAfterDiskSymbols) {
    const headGuide = readGitHeadJson('data/catalog.guide.json');
    const headSymbols = readGitHeadJson('data/catalog.symbols.json');
    if (missingAfterDiskGuide && Array.isArray(headGuide?.parts) && headGuide.parts.length > 0) {
      enriched.guide = {
        intro_raw: String(headGuide?.intro_raw || ''),
        parts: headGuide.parts,
        examples: Array.isArray(headGuide?.examples) ? headGuide.examples : [],
        anchors: Array.isArray(headGuide?.anchors) ? headGuide.anchors : [],
      };
    }
    if (missingAfterDiskSymbols && symbolRowCount(headSymbols) > 0) {
      enriched.symbols = {
        heading_raw: String(headSymbols?.heading_raw || 'List of Symbols'),
        instrument: Array.isArray(headSymbols?.instrument) ? headSymbols.instrument : [],
        collection: Array.isArray(headSymbols?.collection) ? headSymbols.collection : [],
        quality: Array.isArray(headSymbols?.quality) ? headSymbols.quality : [],
        qualifier: Array.isArray(headSymbols?.qualifier) ? headSymbols.qualifier : [],
      };
    }
  }

  const stillMissingAfterFilesGuide = !Array.isArray(enriched?.guide?.parts) || enriched.guide.parts.length === 0;
  const stillMissingAfterFilesSymbols = symbolRowCount(enriched?.symbols) === 0;
  if (stillMissingAfterFilesGuide || stillMissingAfterFilesSymbols) {
    const existing = tryReadExistingModel();
    if (existing) {
      if (stillMissingAfterFilesGuide && Array.isArray(existing?.guide?.parts) && existing.guide.parts.length > 0) {
        enriched.guide = existing.guide;
      }
      if (stillMissingAfterFilesSymbols && symbolRowCount(existing?.symbols) > 0) {
        enriched.symbols = existing.symbols;
      }
    }
  }

  return enriched;
}

function countProtectedChars(value) {
  if (typeof value === 'string') {
    const match = value.match(/[\u00A0\u200B\u200C\u200D]/g);
    return match ? match.length : 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countProtectedChars(item), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((sum, item) => sum + countProtectedChars(item), 0);
  }
  return 0;
}

function readCatalogEditorialIfExists() {
  if (!fs.existsSync(CATALOG_EDITORIAL_PATH)) return defaultCatalogEditorialData();
  try {
    return normalizeCatalogEditorialFile(JSON.parse(fs.readFileSync(CATALOG_EDITORIAL_PATH, 'utf8')));
  } catch {
    return defaultCatalogEditorialData();
  }
}

function readHomeFeaturedIfExists() {
  if (!fs.existsSync(HOME_FEATURED_PATH)) return null;
  try {
    return normalizeHomeFeaturedFile(JSON.parse(fs.readFileSync(HOME_FEATURED_PATH, 'utf8')));
  } catch {
    return null;
  }
}

function buildEntriesPayload(model) {
  const entries = Array.isArray(model?.entries) ? model.entries : [];
  return {
    source: model?.source || 'unknown',
    generated_at: new Date().toISOString(),
    anchors: {
      performer: model?.anchors?.performer || '#dex-performer',
      instrument: model?.anchors?.instrument || '#dex-instrument',
      lookup: model?.anchors?.lookup || '#dex-lookup',
    },
    stats: {
      entries_count: Number(model?.stats?.entries_count || entries.length),
      lookup_count: Number(model?.stats?.lookup_count || 0),
      seasons: Array.isArray(model?.stats?.seasons) ? model.stats.seasons : [],
      instruments: Array.isArray(model?.stats?.instruments) ? model.stats.instruments : [],
      protected_char_count: countProtectedChars(entries),
    },
    spotlight: model?.spotlight || {},
    entries,
  };
}

function buildGuidePayload(model) {
  const guide = model?.guide || {};
  const payload = {
    source: model?.source || 'unknown',
    generated_at: new Date().toISOString(),
    route: '/catalog/how/',
    anchor: model?.anchors?.how || '#dex-how',
    heading_raw: 'How to Read Our Lookup Numbers',
    intro_raw: guide.intro_raw || '',
    parts: Array.isArray(guide.parts) ? guide.parts : [],
    examples: Array.isArray(guide.examples) ? guide.examples : [],
    anchors: Array.isArray(guide.anchors) ? guide.anchors : [],
  };
  payload.protected_char_count = countProtectedChars(payload);
  return payload;
}

function buildSymbolsPayload(model) {
  const symbols = model?.symbols || {};
  const payload = {
    source: model?.source || 'unknown',
    generated_at: new Date().toISOString(),
    route: '/catalog/symbols/',
    anchor: model?.anchors?.symbols || '#list-of-identifiers',
    heading_raw: symbols.heading_raw || 'List of Symbols',
    instrument: Array.isArray(symbols.instrument) ? symbols.instrument : [],
    collection: Array.isArray(symbols.collection) ? symbols.collection : [],
    quality: Array.isArray(symbols.quality) ? symbols.quality : [],
    qualifier: Array.isArray(symbols.qualifier) ? symbols.qualifier : [],
  };
  payload.protected_char_count = countProtectedChars(payload);
  return payload;
}

async function main() {
  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(`Missing source catalog html: ${SOURCE_PATH}`);
  }

  const html = fs.readFileSync(SOURCE_PATH, 'utf8');
  const localModel = buildCatalogModelFromHtml(html, 'local-catalog-html');
  const fromLiveCatalog = await tryExtractFromLiveCatalog();

  let model = null;
  if (fromLiveCatalog) {
    model = fromLiveCatalog;
  } else if (process.env.CATALOG_EXTRACT_ALLOW_LOCAL === '1') {
    if (!Array.isArray(localModel.entries) || localModel.entries.length === 0) {
      throw new Error('Live catalog extraction failed and local catalog HTML contains no entries.');
    }
    model = localModel;
  } else if (process.env.CATALOG_EXTRACT_ALLOW_EXISTING === '1') {
    const existing = tryReadExistingModel();
    if (!existing) {
      throw new Error('Live catalog extraction failed and no existing catalog model is available for fallback.');
    }
    model = existing;
  } else {
    throw new Error(
      'Live catalog extraction failed (dexdsl.com/catalog). Re-run with network access, or set CATALOG_EXTRACT_ALLOW_LOCAL=1 (use local HTML) or CATALOG_EXTRACT_ALLOW_EXISTING=1 (use stale existing model).',
    );
  }

  model = await enrichGuideAndSymbols(model);
  const editorial = readCatalogEditorialIfExists();
  model = applyCatalogEditorialToModel(model, editorial);
  model.stats = model.stats || {};
  model.stats.protected_char_count = countProtectedChars(model);

  const search = buildSearchIndex(model);
  const entries = buildEntriesPayload(model);
  const guide = buildGuidePayload(model);
  const symbols = buildSymbolsPayload(model);

  writeJson(OUT_DATA_PATH, model);
  writeJson(OUT_ENTRIES_PATH, entries);
  writeJson(OUT_GUIDE_PATH, guide);
  writeJson(OUT_SYMBOLS_PATH, symbols);
  writeJson(OUT_SEARCH_PATH, search);
  writeJson(OUT_CATALOG_CURATION_SNAPSHOT_PATH, buildCatalogManifestSnapshot(model, editorial));

  const homeFeatured = readHomeFeaturedIfExists();
  if (homeFeatured) {
    writeJson(
      OUT_HOME_FEATURED_SNAPSHOT_PATH,
      buildHomeFeaturedSnapshot(homeFeatured, {
        catalogEntries: Array.isArray(model.entries) ? model.entries : [],
        requireCatalogMatch: false,
      }),
    );
  }

  console.log(`catalog:extract wrote ${path.relative(ROOT, OUT_DATA_PATH)} (${model.entries.length} entries)`);
  console.log(`catalog:extract wrote ${path.relative(ROOT, OUT_ENTRIES_PATH)} (${entries.entries.length} entries)`);
  console.log(`catalog:extract wrote ${path.relative(ROOT, OUT_GUIDE_PATH)} (${guide.parts.length} guide parts)`);
  console.log(
    `catalog:extract wrote ${path.relative(ROOT, OUT_SYMBOLS_PATH)} (${symbols.instrument.length + symbols.collection.length + symbols.quality.length + symbols.qualifier.length} symbol rows)`,
  );
  console.log(`catalog:extract wrote ${path.relative(ROOT, OUT_SEARCH_PATH)} (${search.entries.length} search rows)`);
  console.log(`catalog:extract wrote ${path.relative(ROOT, OUT_CATALOG_CURATION_SNAPSHOT_PATH)}`);
  if (homeFeatured) {
    console.log(`catalog:extract wrote ${path.relative(ROOT, OUT_HOME_FEATURED_SNAPSHOT_PATH)} (${homeFeatured.featured.length} featured rows)`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`catalog:extract failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
