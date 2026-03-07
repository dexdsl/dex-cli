#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import {
  ROOT,
  DEXNOTES_CONTENT_DIR,
  countProtectedChars,
  normalizeLookupSlugFromHref,
  parseDateIsoToTimestamp,
  slugifyBase,
  writeJson,
  writeText,
  sha256,
  toText,
} from './lib/dexnotes-pipeline.mjs';

const INDEX_PATH = path.join(ROOT, 'docs', 'dexnotes', 'index.html');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'reference', 'dexnotes-migration-report.json');

function ensure(value, label, filePath) {
  const text = toText(value).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (!text) {
    throw new Error(`Missing required ${label} in ${path.relative(ROOT, filePath)}`);
  }
  return text;
}

function parseDisplayDateToIso(display, fallbackIso = '') {
  const value = toText(display).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const month = slash[1].padStart(2, '0');
    const day = slash[2].padStart(2, '0');
    const yearToken = slash[3];
    const year = yearToken.length === 2 ? `20${yearToken}` : yearToken;
    return `${year}-${month}-${day}`;
  }

  const textual = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (textual) {
    const monthMap = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    const month = monthMap[textual[1].slice(0, 3).toLowerCase()] || '01';
    const day = textual[2].padStart(2, '0');
    const year = textual[3] || '2025';
    return `${year}-${month}-${day}`;
  }

  if (fallbackIso && !Number.isNaN(parseDateIsoToTimestamp(fallbackIso))) return fallbackIso;
  return '2023-01-01';
}

function extractExactOuterHtml(sourceHtml, node, fallbackHtml) {
  if (!node || typeof node.startIndex !== 'number' || typeof node.endIndex !== 'number') {
    return toText(fallbackHtml);
  }
  return sourceHtml.slice(node.startIndex, node.endIndex + 1);
}

function parseAuthorId(href) {
  const value = toText(href);
  const match = value.match(/[?&]author=([^&/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function parseLegacyIndex() {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const $ = load(html, { decodeEntities: false });
  const posts = [];

  $('article.blog-item').each((index, article) => {
    const $article = $(article);
    const href = toText($article.find('h1.blog-title a').first().attr('href') || '');
    const slug = normalizeLookupSlugFromHref(href, 'dexnotes');
    if (!slug) return;

    const categoryAnchor = $article.find('.blog-categories').first();
    const categoryHref = toText(categoryAnchor.attr('href') || '');
    const categorySlug = normalizeLookupSlugFromHref(categoryHref, 'category');

    const authorName = toText($article.find('.blog-author').first().text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    const dateDisplay = toText($article.find('.blog-date').first().text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

    const tagsRaw = [];
    $article.find('.blog-item-tag, .blog-tag-item').each((_, tag) => {
      const $tag = $(tag);
      const label = toText($tag.text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
      if (!label) return;
      const tagHref = toText($tag.attr('href') || '');
      const tagSlug = normalizeLookupSlugFromHref(tagHref, 'tag') || label;
      tagsRaw.push({ slug_raw: tagSlug, label_raw: label });
    });

    const excerptRaw = toText($article.find('.blog-excerpt-wrapper').first().text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    const titleRaw = toText($article.find('h1.blog-title a').first().text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    const coverImage = $article.find('img').first();
    const coverImageSrc =
      toText(coverImage.attr('src') || '') ||
      toText(coverImage.attr('data-src') || '') ||
      toText(coverImage.attr('data-image') || '');
    const coverImageAltRaw = toText(coverImage.attr('alt') || '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

    posts.push({
      order_index: index,
      slug,
      title_raw: titleRaw,
      excerpt_raw: excerptRaw,
      category_slug_raw: categorySlug || 'Update',
      category_label_raw: toText(categoryAnchor.text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') || categorySlug || 'Update',
      author_name_raw: authorName || 'dex Team',
      published_display_raw: dateDisplay || '1/1/23',
      published_at_iso: parseDisplayDateToIso(dateDisplay),
      cover_image_src: coverImageSrc,
      cover_image_alt_raw: coverImageAltRaw,
      tags_raw: tagsRaw,
      legacy_route_raw: `/dexnotes/${slug}/`,
      lead_story_pinned: index === 0,
    });
  });

  return posts;
}

function extractPostDetail(summary) {
  const sourcePath = path.join(ROOT, 'docs', 'dexnotes', summary.slug, 'index.html');
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing legacy post page: ${path.relative(ROOT, sourcePath)}`);
  }
  const html = fs.readFileSync(sourcePath, 'utf8');
  const $ = load(html, {
    decodeEntities: false,
    withStartIndices: true,
    withEndIndices: true,
  });

  const titleRaw = toText($('.blog-item-title .entry-title').first().text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') || summary.title_raw;

  const categoryAnchor = $('.blog-item-category').first();
  const categoryHref = toText(categoryAnchor.attr('href') || '');
  const categorySlugRaw = normalizeLookupSlugFromHref(categoryHref, 'category') || summary.category_slug_raw;
  const categoryLabelRaw = toText(categoryAnchor.text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') || summary.category_label_raw;

  const authorAnchor = $('.blog-author-name').first();
  const authorProfileAnchor = $('.blog-item-author-profile-wrapper a').first();
  const authorHref = toText(authorAnchor.attr('href') || authorProfileAnchor.attr('href') || '');
  const authorId = parseAuthorId(authorHref) || summary.author_id || '';
  const authorNameRaw = toText(authorAnchor.text() || authorProfileAnchor.text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') || summary.author_name_raw;

  const displayDate = toText($('.blog-date').first().text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') || summary.published_display_raw;
  const publishedIso = parseDisplayDateToIso(displayDate, summary.published_at_iso);

  const coverImage = $('.blog-item-content img').first();
  const coverImageSrc =
    toText(coverImage.attr('src') || '') ||
    toText(coverImage.attr('data-src') || '') ||
    toText(coverImage.attr('data-image') || '') ||
    summary.cover_image_src;
  const coverImageAltRaw = toText(coverImage.attr('alt') || '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') || summary.cover_image_alt_raw;

  const tagsRaw = [];
  $('.blog-item-tag').each((_, tag) => {
    const $tag = $(tag);
    const labelRaw = toText($tag.text()).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    const href = toText($tag.attr('href') || '');
    const slugRaw = normalizeLookupSlugFromHref(href, 'tag') || labelRaw;
    if (!labelRaw) return;
    tagsRaw.push({ slug_raw: slugRaw, label_raw: labelRaw });
  });

  const bodyNode = $('.blog-item-content.e-content').first().get(0);
  const bodyHtmlRaw = extractExactOuterHtml(html, bodyNode, $('.blog-item-content.e-content').first().toString());
  const excerptFallback = toText($('.blog-item-content.e-content').first().text()).replace(/\r\n/g, '\n');
  const excerptLines = excerptFallback
    .split('\n')
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ''))
    .filter((line) => line.length > 0);
  const excerptRaw = summary.excerpt_raw || excerptLines[0] || '';
  const bodyMode = 'raw_html';

  const prevHref = toText($('#itemPagination .item-pagination-link--prev').first().attr('href') || '');
  const nextHref = toText($('#itemPagination .item-pagination-link--next').first().attr('href') || '');
  const prevSlugRaw = normalizeLookupSlugFromHref(prevHref, 'dexnotes');
  const nextSlugRaw = normalizeLookupSlugFromHref(nextHref, 'dexnotes');

  const finalSlug = summary.slug || slugifyBase(titleRaw);
  const id = `dexnotes-${finalSlug}`;

  return {
    id,
    slug: finalSlug,
    title_raw: ensure(titleRaw, 'title_raw', sourcePath),
    excerpt_raw: ensure(excerptRaw, 'excerpt_raw', sourcePath),
    published_at_iso: ensure(publishedIso, 'published_at_iso', sourcePath),
    published_display_raw: ensure(displayDate, 'published_display_raw', sourcePath),
    updated_at_iso: '',
    category_slug_raw: ensure(categorySlugRaw, 'category_slug_raw', sourcePath),
    category_label_raw: ensure(categoryLabelRaw, 'category_label_raw', sourcePath),
    author_id: ensure(authorId || summary.author_id || 'unknown-author', 'author_id', sourcePath),
    author_name_raw: ensure(authorNameRaw, 'author_name_raw', sourcePath),
    tags_raw: tagsRaw,
    cover_image_src: ensure(coverImageSrc || summary.cover_image_src, 'cover_image_src', sourcePath),
    cover_image_alt_raw: coverImageAltRaw,
    lead_story_pinned: !!summary.lead_story_pinned,
    body_mode: bodyMode,
    legacy_route_raw: ensure(summary.legacy_route_raw, 'legacy_route_raw', sourcePath),
    legacy_prev_slug_raw: prevSlugRaw,
    legacy_next_slug_raw: nextSlugRaw,
    source_file_raw: path.relative(ROOT, sourcePath),
    body_html_raw: ensure(bodyHtmlRaw, 'body_html_raw', sourcePath),
  };
}

function writeMarkdownPost(post) {
  const filePath = path.join(DEXNOTES_CONTENT_DIR, `${post.slug}.md`);
  const frontmatter = {
    id: post.id,
    slug: post.slug,
    title_raw: post.title_raw,
    excerpt_raw: post.excerpt_raw,
    published_at_iso: post.published_at_iso,
    published_display_raw: post.published_display_raw,
    updated_at_iso: post.updated_at_iso,
    category_slug_raw: post.category_slug_raw,
    category_label_raw: post.category_label_raw,
    author_id: post.author_id,
    author_name_raw: post.author_name_raw,
    tags_raw: post.tags_raw,
    cover_image_src: post.cover_image_src,
    cover_image_alt_raw: post.cover_image_alt_raw,
    lead_story_pinned: post.lead_story_pinned,
    body_mode: post.body_mode,
    legacy_route_raw: post.legacy_route_raw,
    legacy_prev_slug_raw: post.legacy_prev_slug_raw,
    legacy_next_slug_raw: post.legacy_next_slug_raw,
    source_file_raw: post.source_file_raw,
  };

  const content = `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${post.body_html_raw}${post.body_html_raw.endsWith('\n') ? '' : '\n'}`;
  writeText(filePath, content);
  return filePath;
}

function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(`Missing legacy dexnotes index: ${path.relative(ROOT, INDEX_PATH)}`);
  }

  fs.mkdirSync(DEXNOTES_CONTENT_DIR, { recursive: true });

  const summaries = parseLegacyIndex();
  if (summaries.length === 0) {
    throw new Error('No legacy dexnotes posts found in docs/dexnotes/index.html');
  }

  const posts = summaries.map((summary) => extractPostDetail(summary));

  const reportPosts = [];
  for (const post of posts) {
    const outPath = writeMarkdownPost(post);
    reportPosts.push({
      slug: post.slug,
      source_file_raw: post.source_file_raw,
      markdown_file_raw: path.relative(ROOT, outPath),
      protected_char_count: countProtectedChars({
        title_raw: post.title_raw,
        excerpt_raw: post.excerpt_raw,
        body_html_raw: post.body_html_raw,
      }),
      body_sha256: sha256(post.body_html_raw),
      title_sha256: sha256(post.title_raw),
      excerpt_sha256: sha256(post.excerpt_raw),
      category_slug_raw: post.category_slug_raw,
      tag_count: post.tags_raw.length,
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    source_index_raw: path.relative(ROOT, INDEX_PATH),
    post_count: posts.length,
    protected_char_count_total: reportPosts.reduce((sum, post) => sum + post.protected_char_count, 0),
    posts: reportPosts,
  };

  writeJson(REPORT_PATH, report);

  console.log(`dexnotes:migrate wrote ${posts.length} markdown posts to ${path.relative(ROOT, DEXNOTES_CONTENT_DIR)}`);
  console.log(`dexnotes:migrate wrote ${path.relative(ROOT, REPORT_PATH)}`);
}

try {
  main();
} catch (error) {
  console.error(`dexnotes:migrate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
