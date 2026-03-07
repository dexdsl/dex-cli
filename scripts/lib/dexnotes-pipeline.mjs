import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.cwd();
export const DEXNOTES_CONTENT_DIR = path.join(ROOT, 'content', 'dexnotes', 'posts');
export const DEXNOTES_INDEX_DATA_PATH = path.join(ROOT, 'public', 'data', 'dexnotes.index.json');
export const DEXNOTES_ENTRIES_DATA_PATH = path.join(ROOT, 'public', 'data', 'dexnotes.entries.json');
export const DEXNOTES_COMMENTS_DATA_PATH = path.join(ROOT, 'public', 'data', 'dexnotes.comments.json');

export const REQUIRED_FRONTMATTER_KEYS = [
  'id',
  'slug',
  'title_raw',
  'excerpt_raw',
  'published_at_iso',
  'published_display_raw',
  'category_slug_raw',
  'category_label_raw',
  'author_id',
  'author_name_raw',
  'tags_raw',
  'cover_image_src',
  'cover_image_alt_raw',
  'lead_story_pinned',
  'body_mode',
  'legacy_route_raw',
];

export function toText(value) {
  return String(value ?? '');
}

export function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, value, 'utf8');
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function listMarkdownPostFiles() {
  if (!fs.existsSync(DEXNOTES_CONTENT_DIR)) return [];
  return fs
    .readdirSync(DEXNOTES_CONTENT_DIR)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(DEXNOTES_CONTENT_DIR, name));
}

export function countProtectedChars(value) {
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

export function sha256(value) {
  return crypto.createHash('sha256').update(toText(value), 'utf8').digest('hex');
}

export function slugifyBase(value) {
  return toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

export function parseMdWithJsonFrontmatter(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error(`Missing JSON frontmatter in ${path.relative(ROOT, filePath)}`);
  }
  let frontmatter = null;
  try {
    frontmatter = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Invalid JSON frontmatter in ${path.relative(ROOT, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = source.slice(match[0].length);
  return {
    frontmatter,
    body,
    source,
  };
}

export function escapeHtml(value) {
  return toText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function parseDateIsoToTimestamp(isoDate) {
  const normalized = toText(isoDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return Number.NaN;
  const stamp = new Date(`${normalized}T00:00:00Z`).getTime();
  return Number.isNaN(stamp) ? Number.NaN : stamp;
}

export function normalizeLookupSlugFromHref(href, segmentName) {
  const value = toText(href).trim();
  const marker = `/${segmentName}/`;
  const idx = value.indexOf(marker);
  if (idx < 0) return '';
  const rest = value.slice(idx + marker.length);
  return rest.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function normalizeRoutePath(routePath) {
  const value = toText(routePath).trim();
  if (!value) return '/';
  if (value === '/') return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function renderInlineMarkdown(line) {
  let out = escapeHtml(line);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[(.+?)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

export function compileMarkdownToHtml(markdownSource) {
  const lines = toText(markdownSource).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeFence = '';

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.map((line) => line.trim()).join(' ');
    out.push(`<p>${renderInlineMarkdown(joined)}</p>`);
    paragraph = [];
  };

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (inCode) {
      if (trimmed.startsWith(codeFence)) {
        out.push('</code></pre>');
        inCode = false;
        codeFence = '';
      } else {
        out.push(escapeHtml(line));
      }
      continue;
    }

    const fenceMatch = trimmed.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      flushParagraph();
      closeLists();
      codeFence = fenceMatch[1];
      out.push('<pre><code>');
      inCode = true;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeLists();
      continue;
    }

    if (trimmed.startsWith('<')) {
      flushParagraph();
      closeLists();
      out.push(line);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      closeLists();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const ulMatch = trimmed.match(/^-\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${renderInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${renderInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  closeLists();

  if (inCode) {
    out.push('</code></pre>');
  }

  return out.join('\n');
}

export function computeProtectedCharDigest(value) {
  return {
    protected_char_count: countProtectedChars(value),
    protected_char_hash: sha256(JSON.stringify(value)),
  };
}

export function toRssDate(dateIso) {
  const stamp = parseDateIsoToTimestamp(dateIso);
  if (Number.isNaN(stamp)) return new Date().toUTCString();
  return new Date(stamp).toUTCString();
}

export function xmlEscape(value) {
  return toText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function ensureLeadingSlash(value) {
  const text = toText(value).trim();
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

export function classifyLocalLink(href) {
  const value = toText(href).trim();
  if (!value) return { href: value, external: false };
  if (value.startsWith('mailto:') || value.startsWith('tel:')) {
    return { href: value, external: true };
  }
  if (/^https?:\/\//i.test(value)) {
    return { href: value, external: true };
  }
  return { href: value, external: false };
}
