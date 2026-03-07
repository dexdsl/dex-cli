#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import {
  DEXNOTES_CONTENT_DIR,
  slugifyBase,
  toText,
  writeText,
} from './lib/dexnotes-pipeline.mjs';

const ROOT = process.cwd();

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = 'true';
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return flags;
}

function todayIso() {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function displayFromIso(iso) {
  const value = toText(iso);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const yy = match[1].slice(2);
  const m = String(Number(match[2]));
  const d = String(Number(match[3]));
  return `${m}/${d}/${yy}`;
}

function parseTags(tagsRaw) {
  const raw = toText(tagsRaw);
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''))
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':');
      if (colon > 0) {
        const slug = part.slice(0, colon).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
        const label = part.slice(colon + 1).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
        return {
          slug_raw: slug || slugifyBase(label),
          label_raw: label || slug,
        };
      }
      return {
        slug_raw: slugifyBase(part),
        label_raw: part,
      };
    });
}

async function collectMissing(values) {
  if (!process.stdin.isTTY) return values;
  const questions = [];

  if (!values.title_raw) {
    questions.push({ type: 'text', name: 'title_raw', message: 'Title (raw):' });
  }
  if (!values.slug) {
    questions.push({ type: 'text', name: 'slug', message: 'Slug (leave empty for auto):', initial: '' });
  }
  if (!values.excerpt_raw) {
    questions.push({ type: 'text', name: 'excerpt_raw', message: 'Excerpt (raw):' });
  }
  if (!values.category_slug_raw) {
    questions.push({ type: 'text', name: 'category_slug_raw', message: 'Category slug:', initial: 'Update' });
  }
  if (!values.category_label_raw) {
    questions.push({ type: 'text', name: 'category_label_raw', message: 'Category label:', initial: values.category_slug_raw || 'Update' });
  }
  if (!values.author_id) {
    questions.push({ type: 'text', name: 'author_id', message: 'Author id:', initial: 'dex-team' });
  }
  if (!values.author_name_raw) {
    questions.push({ type: 'text', name: 'author_name_raw', message: 'Author display name:', initial: 'dex Team' });
  }
  if (!values.tags_input) {
    questions.push({
      type: 'text',
      name: 'tags_input',
      message: 'Tags (comma list, optionally slug:Label):',
      initial: '',
    });
  }
  if (!values.cover_image_src) {
    questions.push({
      type: 'text',
      name: 'cover_image_src',
      message: 'Cover image src:',
      initial: '/assets/img/7142b356c8cfe9d18b7c.png',
    });
  }
  if (!values.cover_image_alt_raw) {
    questions.push({ type: 'text', name: 'cover_image_alt_raw', message: 'Cover image alt text:', initial: '' });
  }
  if (!values.body_mode) {
    questions.push({
      type: 'select',
      name: 'body_mode',
      message: 'Body mode:',
      choices: [
        { title: 'markdown', value: 'markdown' },
        { title: 'raw_html', value: 'raw_html' },
      ],
      initial: 0,
    });
  }
  if (!values.lead_story_pinned_input) {
    questions.push({
      type: 'toggle',
      name: 'lead_story_pinned_input',
      message: 'Pin as lead story?',
      initial: false,
      active: 'yes',
      inactive: 'no',
    });
  }

  const answers = await prompts(questions, {
    onCancel: () => {
      process.exit(1);
    },
  });

  return { ...values, ...answers };
}

function normalize(values) {
  const titleRaw = toText(values.title_raw);
  const slug = toText(values.slug || slugifyBase(titleRaw) || `dexnotes-${Date.now()}`);
  const publishedIso = toText(values.published_at_iso || todayIso());
  const tagsRaw = parseTags(values.tags_input || values.tags || '');
  const bodyMode = toText(values.body_mode || 'markdown') === 'raw_html' ? 'raw_html' : 'markdown';
  const leadPinnedRaw = toText(values.lead_story_pinned_input || values.lead_story_pinned || 'false').toLowerCase();
  const leadStoryPinned = leadPinnedRaw === 'true' || leadPinnedRaw === '1' || leadPinnedRaw === 'yes';

  return {
    id: toText(values.id || `dexnotes-${slug}`),
    slug,
    title_raw: titleRaw,
    excerpt_raw: toText(values.excerpt_raw || ''),
    published_at_iso: publishedIso,
    published_display_raw: toText(values.published_display_raw || displayFromIso(publishedIso)),
    updated_at_iso: toText(values.updated_at_iso || ''),
    category_slug_raw: toText(values.category_slug_raw || 'Update'),
    category_label_raw: toText(values.category_label_raw || values.category_slug_raw || 'Update'),
    author_id: toText(values.author_id || 'dex-team'),
    author_name_raw: toText(values.author_name_raw || 'dex Team'),
    tags_raw: tagsRaw,
    cover_image_src: toText(values.cover_image_src || '/assets/img/7142b356c8cfe9d18b7c.png'),
    cover_image_alt_raw: toText(values.cover_image_alt_raw || ''),
    lead_story_pinned: leadStoryPinned,
    body_mode: bodyMode,
    legacy_route_raw: toText(values.legacy_route_raw || `/dexnotes/${slug}/`),
    legacy_prev_slug_raw: toText(values.legacy_prev_slug_raw || ''),
    legacy_next_slug_raw: toText(values.legacy_next_slug_raw || ''),
    source_file_raw: '',
  };
}

function templateBody(bodyMode) {
  if (bodyMode === 'raw_html') {
    return `<div class="dx-dexnotes-post">
  <p>Write raw HTML content here.</p>
</div>
`;
  }
  return `Write markdown content here.
`;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const input = {
    id: flags.id,
    slug: flags.slug,
    title_raw: flags.title,
    excerpt_raw: flags.excerpt,
    published_at_iso: flags.published,
    published_display_raw: flags.display,
    updated_at_iso: flags.updated,
    category_slug_raw: flags.category,
    category_label_raw: flags.categoryLabel,
    author_id: flags.author,
    author_name_raw: flags.authorName,
    tags_input: flags.tags,
    cover_image_src: flags.cover,
    cover_image_alt_raw: flags.coverAlt,
    lead_story_pinned_input: flags.pinned,
    body_mode: flags.bodyMode,
    legacy_route_raw: flags.legacyRoute,
    legacy_prev_slug_raw: flags.prev,
    legacy_next_slug_raw: flags.next,
  };

  const merged = await collectMissing(input);
  const frontmatter = normalize(merged);

  if (!frontmatter.title_raw) {
    throw new Error('title_raw is required.');
  }
  if (!frontmatter.excerpt_raw) {
    throw new Error('excerpt_raw is required.');
  }

  const outputPath = path.join(DEXNOTES_CONTENT_DIR, `${frontmatter.slug}.md`);
  if (fs.existsSync(outputPath)) {
    throw new Error(`Post already exists: ${path.relative(ROOT, outputPath)}`);
  }

  const sourceFileRaw = path.relative(ROOT, outputPath);
  const finalFrontmatter = {
    ...frontmatter,
    source_file_raw: sourceFileRaw,
  };

  const fileContent = `---\n${JSON.stringify(finalFrontmatter, null, 2)}\n---\n${templateBody(finalFrontmatter.body_mode)}`;
  writeText(outputPath, fileContent);
  console.log(`dexnotes:new created ${path.relative(ROOT, outputPath)}`);
}

main().catch((error) => {
  console.error(`dexnotes:new failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
