#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  DEXNOTES_COMMENTS_DATA_PATH,
  DEXNOTES_CONTENT_DIR,
  DEXNOTES_ENTRIES_DATA_PATH,
  DEXNOTES_INDEX_DATA_PATH,
  REQUIRED_FRONTMATTER_KEYS,
  computeProtectedCharDigest,
  listMarkdownPostFiles,
  parseMdWithJsonFrontmatter,
  readJson,
  toText,
} from './lib/dexnotes-pipeline.mjs';

const ROOT = process.cwd();
const INDEX_PAGE_PATH = path.join(ROOT, 'docs', 'dexnotes', 'index.html');
const ENTRY_RUNTIME_SOURCE_PATH = path.join(ROOT, 'scripts', 'src', 'dexnotes.entry.entry.mjs');
const INDEX_RUNTIME_SOURCE_PATH = path.join(ROOT, 'scripts', 'src', 'dexnotes.index.entry.mjs');
const ENTRY_RUNTIME_PUBLIC_PATH = path.join(ROOT, 'public', 'assets', 'js', 'dexnotes.entry.js');
const INDEX_RUNTIME_PUBLIC_PATH = path.join(ROOT, 'public', 'assets', 'js', 'dexnotes.index.js');
const INDEX_CSS_PATH = path.join(ROOT, 'public', 'css', 'components', 'dx-dexnotes-index.css');
const ENTRY_CSS_PATH = path.join(ROOT, 'public', 'css', 'components', 'dx-dexnotes-entry.css');
const DEX_CLI_PATH = path.join(ROOT, 'scripts', 'dex.mjs');
const NOTES_CLI_PATH = path.join(ROOT, 'scripts', 'lib', 'dex-notes-cli.mjs');
const RSS_PUBLIC_PATH = path.join(ROOT, 'public', 'dexnotes', 'rss.xml');
const RSS_DOCS_PATH = path.join(ROOT, 'docs', 'dexnotes', 'rss.xml');
const RSS_COMPAT_PATH = path.join(ROOT, 'docs', 'dexnotes?format=rss');

const REQUIRED_ENTRY_MAIN_MARKERS = [
  'data-dexnotes-entry-app',
];

const REQUIRED_INDEX_MAIN_MARKERS = [
  'data-dexnotes-index-app',
];

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

function verifyMarkdownSources(failures) {
  if (!fs.existsSync(DEXNOTES_CONTENT_DIR)) {
    failures.push(`missing source directory ${path.relative(ROOT, DEXNOTES_CONTENT_DIR)}`);
    return [];
  }

  const markdownFiles = listMarkdownPostFiles();
  if (markdownFiles.length === 0) {
    failures.push('no markdown posts found in content/dexnotes/posts');
    return [];
  }

  const parsed = [];
  for (const filePath of markdownFiles) {
    try {
      const source = parseMdWithJsonFrontmatter(filePath);
      const fm = source.frontmatter;
      for (const key of REQUIRED_FRONTMATTER_KEYS) {
        if (!(key in fm)) {
          failures.push(`markdown frontmatter missing key "${key}" in ${path.relative(ROOT, filePath)}`);
        }
      }
      parsed.push({
        filePath,
        frontmatter: fm,
        body: source.body,
      });
    } catch (error) {
      failures.push(`invalid markdown source ${path.relative(ROOT, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return parsed;
}

function verifyRoutes(indexData, entriesData, failures) {
  const entries = Array.isArray(entriesData.entries) ? entriesData.entries : [];
  const categories = Array.isArray(indexData.categories) ? indexData.categories : [];
  const tags = Array.isArray(indexData.tags) ? indexData.tags : [];

  const indexHtml = readText(INDEX_PAGE_PATH);
  const indexMain = getMainHtml(indexHtml);
  if (!indexMain) {
    failures.push('dexnotes index missing <main id="page">');
  } else {
    for (const marker of REQUIRED_INDEX_MAIN_MARKERS) {
      if (!indexMain.includes(marker)) {
        failures.push(`dexnotes index main missing marker ${marker}`);
      }
    }
    if (indexMain.includes('section.page-section')) {
      failures.push('dexnotes index main still contains legacy page-section scaffolding');
    }
  }

  if (indexHtml.includes('https://dexdsl.org/')) {
    failures.push('dexnotes index still includes dexdsl.org metadata; expected dexdsl.github.io');
  }
  if (!indexHtml.includes('https://dexdsl.github.io/dexnotes/')) {
    failures.push('dexnotes index missing dexdsl.github.io canonical metadata');
  }
  if (!indexHtml.includes('/css/components/dx-dexnotes-index.css')) {
    failures.push('dexnotes index missing /css/components/dx-dexnotes-index.css include');
  }
  if (!indexHtml.includes('/assets/js/dexnotes.index.js')) {
    failures.push('dexnotes index missing /assets/js/dexnotes.index.js include');
  }
  if (!indexHtml.includes('/dexnotes/rss.xml')) {
    failures.push('dexnotes index missing rss alternate href to /dexnotes/rss.xml');
  }

  for (const category of categories) {
    const slug = toText(category.slug_raw).trim();
    if (!slug) continue;
    const categoryPath = path.join(ROOT, 'docs', 'dexnotes', 'category', slug, 'index.html');
    if (!fs.existsSync(categoryPath)) {
      failures.push(`missing category route ${path.relative(ROOT, categoryPath)}`);
    }
  }

  for (const tag of tags) {
    const slug = toText(tag.slug_raw).trim();
    if (!slug) continue;
    const tagPath = path.join(ROOT, 'docs', 'dexnotes', 'tag', slug, 'index.html');
    if (!fs.existsSync(tagPath)) {
      failures.push(`missing tag route ${path.relative(ROOT, tagPath)}`);
    }
  }

  for (const entry of entries) {
    const slug = toText(entry.slug).trim();
    if (!slug) {
      failures.push('entry payload contains empty slug');
      continue;
    }
    const routePath = path.join(ROOT, 'docs', 'dexnotes', slug, 'index.html');
    const wrapperPath = path.join(ROOT, 'docs', 'dexnotes', `${slug}.html`);
    if (!fs.existsSync(routePath)) {
      failures.push(`missing entry route ${path.relative(ROOT, routePath)}`);
      continue;
    }
    if (!fs.existsSync(wrapperPath)) {
      failures.push(`missing entry wrapper ${path.relative(ROOT, wrapperPath)}`);
    }
    const html = readText(routePath);
    const main = getMainHtml(html);
    for (const marker of REQUIRED_ENTRY_MAIN_MARKERS) {
      if (!main.includes(marker)) {
        failures.push(`entry route ${path.relative(ROOT, routePath)} missing marker ${marker}`);
      }
    }
    if (main.includes('section.page-section')) {
      failures.push(`entry route ${path.relative(ROOT, routePath)} still contains legacy page-section scaffolding`);
    }
    if (!html.includes('/css/components/dx-dexnotes-entry.css')) {
      failures.push(`entry route ${path.relative(ROOT, routePath)} missing /css/components/dx-dexnotes-entry.css include`);
    }
    if (!html.includes('/assets/js/dexnotes.entry.js')) {
      failures.push(`entry route ${path.relative(ROOT, routePath)} missing /assets/js/dexnotes.entry.js include`);
    }
    if (html.includes('https://dexdsl.org/')) {
      failures.push(`entry route ${path.relative(ROOT, routePath)} still includes dexdsl.org metadata`);
    }
  }
}

function verifyProtectedCharDigests(indexData, entriesData, sourcePosts, failures) {
  const leadSummary = indexData.lead_story || null;
  const summaries = Array.isArray(indexData.posts) ? indexData.posts : [];
  const categories = Array.isArray(indexData.categories) ? indexData.categories : [];
  const tags = Array.isArray(indexData.tags) ? indexData.tags : [];
  const authors = Array.isArray(indexData.authors) ? indexData.authors : [];

  const expectedIndexDigest = computeProtectedCharDigest({
    leadSummary,
    summaries,
    categories,
    tags,
    authors,
  });
  if (Number(indexData?.stats?.protected_char_count || 0) !== Number(expectedIndexDigest.protected_char_count)) {
    failures.push(
      `dexnotes index protected_char_count drift: stats=${indexData?.stats?.protected_char_count || 0}, recomputed=${expectedIndexDigest.protected_char_count}`,
    );
  }
  if (toText(indexData?.stats?.protected_char_hash) !== toText(expectedIndexDigest.protected_char_hash)) {
    failures.push('dexnotes index protected_char_hash drift');
  }

  const entries = Array.isArray(entriesData.entries) ? entriesData.entries : [];
  const expectedEntriesDigest = computeProtectedCharDigest(
    entries.map((entry) => ({
      title_raw: entry.title_raw,
      excerpt_raw: entry.excerpt_raw,
      body_html: entry.body_html,
    })),
  );
  if (Number(entriesData?.stats?.protected_char_count || 0) !== Number(expectedEntriesDigest.protected_char_count)) {
    failures.push(
      `dexnotes entries protected_char_count drift: stats=${entriesData?.stats?.protected_char_count || 0}, recomputed=${expectedEntriesDigest.protected_char_count}`,
    );
  }
  if (toText(entriesData?.stats?.protected_char_hash) !== toText(expectedEntriesDigest.protected_char_hash)) {
    failures.push('dexnotes entries protected_char_hash drift');
  }

  const sourceProtected = sourcePosts.reduce(
    (sum, item) =>
      sum +
      countProtectedChars({
        title_raw: item.frontmatter.title_raw,
        excerpt_raw: item.frontmatter.excerpt_raw,
        body_raw: item.body,
      }),
    0,
  );
  if (sourceProtected < expectedEntriesDigest.protected_char_count) {
    failures.push(
      `dexnotes source protected-char count (${sourceProtected}) lower than compiled entries (${expectedEntriesDigest.protected_char_count})`,
    );
  }
}

function verifyCommentsContract(failures) {
  const comments = readJson(DEXNOTES_COMMENTS_DATA_PATH);
  if (toText(comments.provider) !== 'giscus') {
    failures.push('dexnotes comments config provider must be "giscus"');
  }
  if (!('enabled' in comments)) {
    failures.push('dexnotes comments config missing enabled flag');
  }
  if (!toText(comments.fallback_message_raw)) {
    failures.push('dexnotes comments config missing fallback_message_raw');
  }

  const entryRuntimeSource = readText(ENTRY_RUNTIME_SOURCE_PATH);
  if (!entryRuntimeSource.includes('https://giscus.app/client.js')) {
    failures.push('dexnotes entry runtime missing giscus loader');
  }
  if (!entryRuntimeSource.includes('dx-dexnotes-comments-fallback')) {
    failures.push('dexnotes entry runtime missing comments fallback panel');
  }
}

function verifyRssAndCompat(failures) {
  if (!fs.existsSync(RSS_PUBLIC_PATH)) {
    failures.push(`missing rss output ${path.relative(ROOT, RSS_PUBLIC_PATH)}`);
  }
  if (!fs.existsSync(RSS_DOCS_PATH)) {
    failures.push(`missing rss output ${path.relative(ROOT, RSS_DOCS_PATH)}`);
  }
  if (!fs.existsSync(RSS_COMPAT_PATH)) {
    failures.push(`missing rss compatibility wrapper ${path.relative(ROOT, RSS_COMPAT_PATH)}`);
  }

  if (fs.existsSync(RSS_PUBLIC_PATH)) {
    const xml = readText(RSS_PUBLIC_PATH);
    if (!xml.includes('<rss')) failures.push('rss public output is not valid rss xml');
    if (!xml.includes('dex notes')) failures.push('rss public output missing channel title content');
  }

  const indexRuntimeSource = readText(INDEX_RUNTIME_SOURCE_PATH);
  if (!indexRuntimeSource.includes("params.get('format') === 'rss'")) {
    failures.push('dexnotes index runtime missing ?format=rss redirect guard');
  }
}

function verifyBuiltAssets(failures) {
  const requiredFiles = [
    INDEX_CSS_PATH,
    ENTRY_CSS_PATH,
    INDEX_RUNTIME_PUBLIC_PATH,
    ENTRY_RUNTIME_PUBLIC_PATH,
    DEXNOTES_INDEX_DATA_PATH,
    DEXNOTES_ENTRIES_DATA_PATH,
    DEXNOTES_COMMENTS_DATA_PATH,
  ];
  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      failures.push(`missing output file ${path.relative(ROOT, filePath)}`);
    }
  }
}

function verifyDexNotesCliContract(failures) {
  const dexCli = readText(DEX_CLI_PATH);
  const notesCli = readText(NOTES_CLI_PATH);
  const requiredDexMarkers = [
    "firstNonFlag === 'notes'",
    "topLevel.command === 'notes'",
  ];
  for (const marker of requiredDexMarkers) {
    if (!dexCli.includes(marker)) {
      failures.push(`dex CLI missing notes marker: ${marker}`);
    }
  }

  const requiredNotesCliMarkers = [
    'dex notes list',
    'dex notes add',
    'dex notes edit',
    'dex notes set',
    'dex notes build',
    'dex notes validate',
    'dex notes publish',
    '$EDITOR',
  ];
  for (const marker of requiredNotesCliMarkers) {
    if (!notesCli.includes(marker)) {
      failures.push(`dex-notes-cli missing marker: ${marker}`);
    }
  }
}

function main() {
  const failures = [];
  const sourcePosts = verifyMarkdownSources(failures);
  verifyBuiltAssets(failures);

  const indexData = readJson(DEXNOTES_INDEX_DATA_PATH);
  const entriesData = readJson(DEXNOTES_ENTRIES_DATA_PATH);

  verifyRoutes(indexData, entriesData, failures);
  verifyProtectedCharDigests(indexData, entriesData, sourcePosts, failures);
  verifyCommentsContract(failures);
  verifyRssAndCompat(failures);
  verifyDexNotesCliContract(failures);

  if (failures.length > 0) {
    console.error(`verify:dexnotes failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  const count = Array.isArray(entriesData.entries) ? entriesData.entries.length : 0;
  console.log(`verify:dexnotes passed (${count} entries).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:dexnotes failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
