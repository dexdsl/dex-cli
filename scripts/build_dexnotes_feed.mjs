#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  DEXNOTES_ENTRIES_DATA_PATH,
  toRssDate,
  xmlEscape,
  readJson,
  writeText,
  toText,
} from './lib/dexnotes-pipeline.mjs';

const ROOT = process.cwd();
const SITE_ORIGIN = 'https://dexdsl.github.io';
const OUT_PUBLIC_PATH = path.join(ROOT, 'public', 'dexnotes', 'rss.xml');
const OUT_DOCS_PATH = path.join(ROOT, 'docs', 'dexnotes', 'rss.xml');

function itemXml(entry) {
  const slug = toText(entry.slug).trim();
  const link = `${SITE_ORIGIN}/dexnotes/${slug}/`;
  const title = xmlEscape(toText(entry.title_raw));
  const description = xmlEscape(toText(entry.excerpt_raw || 'Dex Notes story'));
  const pubDate = toRssDate(toText(entry.published_at_iso));
  const guid = xmlEscape(link);

  return `    <item>
      <title>${title}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="true">${guid}</guid>
      <pubDate>${xmlEscape(pubDate)}</pubDate>
      <description>${description}</description>
    </item>`;
}

function buildFeed(entries) {
  const items = entries.map((entry) => itemXml(entry)).join('\n');
  const latestDate = entries.length > 0 ? toRssDate(toText(entries[0].published_at_iso)) : new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>dex notes — dex digital sample library</title>
    <link>${SITE_ORIGIN}/dexnotes/</link>
    <description>Dex Notes newsroom for artists, releases, entries, and Dex updates.</description>
    <language>en-us</language>
    <lastBuildDate>${xmlEscape(latestDate)}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function writeFeed(targetPath, xml) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeText(targetPath, xml);
}

function main() {
  if (!fs.existsSync(DEXNOTES_ENTRIES_DATA_PATH)) {
    throw new Error(`Missing entries data file: ${path.relative(ROOT, DEXNOTES_ENTRIES_DATA_PATH)}`);
  }

  const entriesPayload = readJson(DEXNOTES_ENTRIES_DATA_PATH);
  const entries = Array.isArray(entriesPayload.entries) ? entriesPayload.entries : [];
  const feedXml = buildFeed(entries);

  writeFeed(OUT_PUBLIC_PATH, feedXml);
  writeFeed(OUT_DOCS_PATH, feedXml);

  console.log(`dexnotes:feed wrote ${path.relative(ROOT, OUT_PUBLIC_PATH)}`);
  console.log(`dexnotes:feed wrote ${path.relative(ROOT, OUT_DOCS_PATH)}`);
}

try {
  main();
} catch (error) {
  console.error(`dexnotes:feed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
