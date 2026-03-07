#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  DEXNOTES_COMMENTS_DATA_PATH,
  DEXNOTES_ENTRIES_DATA_PATH,
  DEXNOTES_INDEX_DATA_PATH,
  REQUIRED_FRONTMATTER_KEYS,
  compileMarkdownToHtml,
  computeProtectedCharDigest,
  countProtectedChars,
  listMarkdownPostFiles,
  parseDateIsoToTimestamp,
  parseMdWithJsonFrontmatter,
  readJson,
  toText,
  writeJson,
} from './lib/dexnotes-pipeline.mjs';
import { emitAnnouncementPublishHooks, resolveEventsEnv } from './lib/worker-hooks.mjs';

const ROOT = process.cwd();

const DEFAULT_COMMENTS_CONFIG = {
  enabled: false,
  provider: 'giscus',
  repo: '',
  repoId: '',
  category: '',
  categoryId: '',
  mapping: 'pathname',
  strict: '0',
  reactionsEnabled: '1',
  emitMetadata: '0',
  inputPosition: 'bottom',
  theme: 'preferred_color_scheme',
  lang: 'en',
  loading: 'lazy',
  fallback_message_raw: 'Comments unavailable right now. Check back soon.',
};

const POLL_SHORTCODE_RE = /\[dx-poll\s+id=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\s*\]/gi;

function normalizePollEmbedId(raw) {
  const value = toText(raw).trim();
  if (!value) return '';
  const normalized = value.replace(/[^a-zA-Z0-9._:-]/g, '');
  return normalized.slice(0, 128);
}

function replacePollShortcodes(body) {
  const source = String(body || '');
  return source.replace(POLL_SHORTCODE_RE, (_match, dq, sq, bare) => {
    const id = normalizePollEmbedId(dq || sq || bare || '');
    if (!id) return '';
    return `<div data-dx-poll-embed="true" data-dx-poll-mode="compact" data-dx-poll-id="${id}"></div>`;
  });
}

function ensureFrontmatter(frontmatter, sourcePath) {
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!(key in frontmatter)) {
      throw new Error(`Missing frontmatter key ${key} in ${path.relative(ROOT, sourcePath)}`);
    }
  }

  if (!Array.isArray(frontmatter.tags_raw)) {
    throw new Error(`Expected tags_raw array in ${path.relative(ROOT, sourcePath)}`);
  }

  const bodyMode = toText(frontmatter.body_mode);
  if (bodyMode !== 'raw_html' && bodyMode !== 'markdown') {
    throw new Error(`Unsupported body_mode ${bodyMode} in ${path.relative(ROOT, sourcePath)}`);
  }
}

function normalizeTag(tag) {
  if (!tag || typeof tag !== 'object') return { slug_raw: '', label_raw: '' };
  const slugRaw = toText(tag.slug_raw).trim();
  const labelRaw = toText(tag.label_raw).trim() || slugRaw;
  return {
    slug_raw: slugRaw,
    label_raw: labelRaw,
  };
}

function buildEntryFromMarkdown(filePath) {
  const parsed = parseMdWithJsonFrontmatter(filePath);
  const frontmatter = parsed.frontmatter;
  ensureFrontmatter(frontmatter, filePath);

  const bodyMode = toText(frontmatter.body_mode).trim();
  const rawBody = parsed.body;
  const transformedBody = replacePollShortcodes(rawBody);
  const bodyHtml = bodyMode === 'raw_html' ? transformedBody : compileMarkdownToHtml(transformedBody);

  const publishedIso = toText(frontmatter.published_at_iso).trim();
  const publishedTs = parseDateIsoToTimestamp(publishedIso);

  if (Number.isNaN(publishedTs)) {
    throw new Error(`Invalid published_at_iso (${publishedIso}) in ${path.relative(ROOT, filePath)}`);
  }

  const tagsRaw = frontmatter.tags_raw.map((tag) => normalizeTag(tag)).filter((tag) => tag.slug_raw || tag.label_raw);

  return {
    id: toText(frontmatter.id).trim(),
    slug: toText(frontmatter.slug).trim(),
    title_raw: toText(frontmatter.title_raw),
    excerpt_raw: toText(frontmatter.excerpt_raw),
    published_at_iso: publishedIso,
    published_display_raw: toText(frontmatter.published_display_raw),
    updated_at_iso: toText(frontmatter.updated_at_iso || '').trim(),
    category_slug_raw: toText(frontmatter.category_slug_raw).trim(),
    category_label_raw: toText(frontmatter.category_label_raw),
    author_id: toText(frontmatter.author_id).trim(),
    author_name_raw: toText(frontmatter.author_name_raw),
    tags_raw: tagsRaw,
    cover_image_src: toText(frontmatter.cover_image_src).trim(),
    cover_image_alt_raw: toText(frontmatter.cover_image_alt_raw),
    lead_story_pinned: !!frontmatter.lead_story_pinned,
    body_mode: bodyMode,
    legacy_route_raw: toText(frontmatter.legacy_route_raw).trim(),
    legacy_prev_slug_raw: toText(frontmatter.legacy_prev_slug_raw || '').trim(),
    legacy_next_slug_raw: toText(frontmatter.legacy_next_slug_raw || '').trim(),
    source_file_raw: path.relative(ROOT, filePath),
    body_raw: transformedBody,
    body_html: bodyHtml,
    route_path: `/dexnotes/${toText(frontmatter.slug).trim()}/`,
    published_ts: publishedTs,
    search_blob: [
      toText(frontmatter.title_raw),
      toText(frontmatter.excerpt_raw),
      toText(frontmatter.author_name_raw),
      toText(frontmatter.category_label_raw),
      tagsRaw.map((tag) => `${tag.label_raw} ${tag.slug_raw}`).join(' '),
    ].join(' '),
  };
}

function compareEntries(a, b) {
  if (b.published_ts !== a.published_ts) return b.published_ts - a.published_ts;
  return a.slug.localeCompare(b.slug);
}

function buildCounts(entries) {
  const categoryMap = new Map();
  const tagMap = new Map();
  const authorMap = new Map();

  for (const entry of entries) {
    const catKey = entry.category_slug_raw;
    if (!categoryMap.has(catKey)) {
      categoryMap.set(catKey, {
        slug_raw: catKey,
        label_raw: entry.category_label_raw,
        count: 0,
      });
    }
    categoryMap.get(catKey).count += 1;

    const authorKey = entry.author_id;
    if (!authorMap.has(authorKey)) {
      authorMap.set(authorKey, {
        id: authorKey,
        name_raw: entry.author_name_raw,
        count: 0,
      });
    }
    authorMap.get(authorKey).count += 1;

    for (const tag of entry.tags_raw) {
      const tagKey = tag.slug_raw;
      if (!tagMap.has(tagKey)) {
        tagMap.set(tagKey, {
          slug_raw: tag.slug_raw,
          label_raw: tag.label_raw,
          count: 0,
        });
      }
      tagMap.get(tagKey).count += 1;
    }
  }

  const byCountThenLabel = (a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label_raw.localeCompare(b.label_raw);
  };

  const categories = Array.from(categoryMap.values()).sort(byCountThenLabel);
  const tags = Array.from(tagMap.values()).sort(byCountThenLabel);
  const authors = Array.from(authorMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name_raw.localeCompare(b.name_raw);
  });

  return { categories, tags, authors };
}

function buildRelated(entries) {
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));

  for (const entry of entries) {
    const scored = [];
    const entryTags = new Set(entry.tags_raw.map((tag) => tag.slug_raw));

    for (const candidate of entries) {
      if (candidate.slug === entry.slug) continue;

      let score = 0;
      if (candidate.category_slug_raw === entry.category_slug_raw) score += 3;
      if (candidate.author_id === entry.author_id) score += 2;

      const candidateTags = candidate.tags_raw.map((tag) => tag.slug_raw);
      let sharedTags = 0;
      for (const tag of candidateTags) {
        if (entryTags.has(tag)) sharedTags += 1;
      }
      score += sharedTags * 1.5;

      if (score <= 0) continue;

      const dateDelta = Math.abs(candidate.published_ts - entry.published_ts);
      scored.push({
        slug: candidate.slug,
        score,
        dateDelta,
      });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.dateDelta !== b.dateDelta) return a.dateDelta - b.dateDelta;
      return a.slug.localeCompare(b.slug);
    });

    entry.related_slugs = scored.slice(0, 6).map((item) => item.slug);
    entry.related_entries = entry.related_slugs.map((slug) => bySlug.get(slug)).filter(Boolean);
  }
}

function applyPagination(entries) {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const prev = entries[index - 1] || null;
    const next = entries[index + 1] || null;

    entry.prev_slug = prev ? prev.slug : '';
    entry.next_slug = next ? next.slug : '';

    if (!entry.prev_slug && entry.legacy_prev_slug_raw) entry.prev_slug = entry.legacy_prev_slug_raw;
    if (!entry.next_slug && entry.legacy_next_slug_raw) entry.next_slug = entry.legacy_next_slug_raw;
  }
}

function toSummary(entry) {
  return {
    id: entry.id,
    slug: entry.slug,
    title_raw: entry.title_raw,
    excerpt_raw: entry.excerpt_raw,
    published_at_iso: entry.published_at_iso,
    published_display_raw: entry.published_display_raw,
    updated_at_iso: entry.updated_at_iso,
    category_slug_raw: entry.category_slug_raw,
    category_label_raw: entry.category_label_raw,
    author_id: entry.author_id,
    author_name_raw: entry.author_name_raw,
    tags_raw: entry.tags_raw,
    cover_image_src: entry.cover_image_src,
    cover_image_alt_raw: entry.cover_image_alt_raw,
    route_path: entry.route_path,
    legacy_route_raw: entry.legacy_route_raw,
    lead_story_pinned: entry.lead_story_pinned,
  };
}

function findSummaryBySlug(entries, slug) {
  if (!slug) return null;
  const found = entries.find((candidate) => candidate.slug === slug);
  return found ? toSummary(found) : null;
}

function readOrInitCommentsConfig() {
  if (fs.existsSync(DEXNOTES_COMMENTS_DATA_PATH)) {
    const existing = readJson(DEXNOTES_COMMENTS_DATA_PATH);
    return {
      ...DEFAULT_COMMENTS_CONFIG,
      ...existing,
      provider: 'giscus',
      fallback_message_raw: toText(existing.fallback_message_raw || DEFAULT_COMMENTS_CONFIG.fallback_message_raw),
    };
  }
  return { ...DEFAULT_COMMENTS_CONFIG };
}

async function main() {
  const files = listMarkdownPostFiles();
  if (files.length === 0) {
    throw new Error('No markdown posts found in content/dexnotes/posts. Run dexnotes:migrate or dexnotes:new.');
  }

  const entries = files.map((filePath) => buildEntryFromMarkdown(filePath));
  entries.sort(compareEntries);

  const duplicateSlug = new Set();
  const seenSlug = new Set();
  for (const entry of entries) {
    if (seenSlug.has(entry.slug)) duplicateSlug.add(entry.slug);
    seenSlug.add(entry.slug);
  }
  if (duplicateSlug.size > 0) {
    throw new Error(`Duplicate post slugs: ${Array.from(duplicateSlug).join(', ')}`);
  }

  applyPagination(entries);
  buildRelated(entries);

  const leadStory = entries.find((entry) => entry.lead_story_pinned) || entries[0];
  const { categories, tags, authors } = buildCounts(entries);

  const summaries = entries.map((entry) => toSummary(entry));
  const leadSummary = leadStory ? toSummary(leadStory) : null;

  const indexPayload = {
    generated_at: new Date().toISOString(),
    source_dir_raw: path.relative(ROOT, path.join(ROOT, 'content', 'dexnotes', 'posts')),
    lead_story_slug: leadStory ? leadStory.slug : '',
    lead_story: leadSummary,
    posts: summaries,
    categories,
    tags,
    authors,
    routes: {
      index: '/dexnotes/',
      rss: '/dexnotes/rss.xml',
    },
    stats: {
      posts_count: summaries.length,
      categories_count: categories.length,
      tags_count: tags.length,
      authors_count: authors.length,
      ...computeProtectedCharDigest({ leadSummary, summaries, categories, tags, authors }),
    },
  };

  const entriesPayload = {
    generated_at: new Date().toISOString(),
    lead_story_slug: leadStory ? leadStory.slug : '',
    entries: entries.map((entry) => ({
      ...entry,
      related_entries: entry.related_entries.map((item) => toSummary(item)),
      prev_entry: findSummaryBySlug(entries, entry.prev_slug),
      next_entry: findSummaryBySlug(entries, entry.next_slug),
    })),
    stats: {
      entries_count: entries.length,
      ...computeProtectedCharDigest(entries.map((entry) => ({
        title_raw: entry.title_raw,
        excerpt_raw: entry.excerpt_raw,
        body_html: entry.body_html,
      }))),
    },
  };

  const commentsPayload = readOrInitCommentsConfig();
  commentsPayload.generated_at = new Date().toISOString();
  commentsPayload.protected_char_count = countProtectedChars(commentsPayload);

  writeJson(DEXNOTES_INDEX_DATA_PATH, indexPayload);
  writeJson(DEXNOTES_ENTRIES_DATA_PATH, entriesPayload);
  writeJson(DEXNOTES_COMMENTS_DATA_PATH, commentsPayload);

  console.log(`dexnotes:build-data wrote ${path.relative(ROOT, DEXNOTES_INDEX_DATA_PATH)}`);
  console.log(`dexnotes:build-data wrote ${path.relative(ROOT, DEXNOTES_ENTRIES_DATA_PATH)}`);
  console.log(`dexnotes:build-data wrote ${path.relative(ROOT, DEXNOTES_COMMENTS_DATA_PATH)}`);

  try {
    const events = await emitAnnouncementPublishHooks({
      env: resolveEventsEnv(process.env.DEX_DEXNOTES_EVENTS_ENV || process.env.DEX_EVENTS_ENV || 'prod'),
      entries,
    });
    console.log(
      `dexnotes:build-data events attempted=${events.attempted} sent=${events.sent} skipped=${events.skipped} failed=${events.failed}`,
    );
  } catch (error) {
    console.warn(`dexnotes:build-data events failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`dexnotes:build-data failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
