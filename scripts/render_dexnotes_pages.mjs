#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  DEXNOTES_ENTRIES_DATA_PATH,
  DEXNOTES_INDEX_DATA_PATH,
  escapeAttr,
  escapeHtml,
  ensureLeadingSlash,
  readJson,
  toText,
} from './lib/dexnotes-pipeline.mjs';

const ROOT = process.cwd();
const SHELL_SOURCE_PATH = path.join(ROOT, 'docs', 'dexnotes', 'index.html');
const FALLBACK_SHELL_SOURCE_PATH = path.join(ROOT, 'docs', 'index.html');
const SITE_ORIGIN = 'https://dexdsl.github.io';

const GOOEY_MESH_MARKUP = `
      <div id="gooey-mesh-wrapper">
        <div class="gooey-stage">
          <div class="gooey-blob" style="--d:36vmax;--g1a:#ff5f6d;--g1b:#ffc371;--g2a:#47c9e5;--g2b:#845ef7"></div>
          <div class="gooey-blob" style="--d:32vmax;--g1a:#7F00FF;--g1b:#E100FF;--g2a:#00DBDE;--g2b:#FC00FF"></div>
          <div class="gooey-blob" style="--d:33vmax;--g1a:#FFD452;--g1b:#FFB347;--g2a:#FF8456;--g2b:#FF5E62"></div>
          <div class="gooey-blob" style="--d:37vmax;--g1a:#13F1FC;--g1b:#0470DC;--g2a:#A1FFCE;--g2b:#FAFFD1"></div>
          <div class="gooey-blob" style="--d:27vmax;--g1a:#F9516D;--g1b:#FF9A44;--g2a:#FA8BFF;--g2b:#6F7BF7"></div>
        </div>
        <svg id="goo-filter" aria-hidden="true">
          <defs>
            <filter id="goo">
              <feGaussianBlur in="SourceGraphic" stdDeviation="15" result="blur"></feGaussianBlur>
              <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0                   0 1 0 0 0                   0 0 1 0 0                   0 0 0 18 -8" result="goo"></feColorMatrix>
              <feBlend in="SourceGraphic" in2="goo" mode="normal"></feBlend>
            </filter>
          </defs>
        </svg>
      </div>
`;

function readShellParts() {
  const sourcePath = fs.existsSync(SHELL_SOURCE_PATH) ? SHELL_SOURCE_PATH : FALLBACK_SHELL_SOURCE_PATH;
  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Missing shell source: ${path.relative(ROOT, SHELL_SOURCE_PATH)} and ${path.relative(ROOT, FALLBACK_SHELL_SOURCE_PATH)}`,
    );
  }

  const source = fs.readFileSync(sourcePath, 'utf8');
  const mainStart = source.indexOf('<main id="page"');
  if (mainStart < 0) {
    throw new Error(`Unable to find <main id=\"page\"> in ${path.relative(ROOT, sourcePath)}`);
  }
  const mainEnd = source.indexOf('</main>', mainStart);
  if (mainEnd < 0) {
    throw new Error(`Unable to find closing </main> in ${path.relative(ROOT, sourcePath)}`);
  }

  let preMain = source.slice(0, mainStart);
  const postMain = source.slice(mainEnd + '</main>'.length);

  const gooStart = preMain.indexOf('<div id="gooey-mesh-wrapper">');
  if (gooStart >= 0) {
    preMain = preMain.slice(0, gooStart);
  }

  const headStart = preMain.indexOf('<head>');
  const headEnd = preMain.indexOf('</head>', headStart);
  if (headStart < 0) {
    throw new Error(`Unable to split shell head/body in ${path.relative(ROOT, sourcePath)}`);
  }

  const htmlPrefix = preMain.slice(0, headStart);
  if (headEnd >= 0) {
    const bodyPrefix = preMain.slice(headEnd + '</head>'.length);
    return { htmlPrefix, bodyPrefix, bodySuffix: postMain };
  }

  const bodyStartMatch = preMain.match(/<body\b/i);
  if (bodyStartMatch && typeof bodyStartMatch.index === 'number') {
    const bodyPrefix = preMain.slice(bodyStartMatch.index);
    return { htmlPrefix, bodyPrefix, bodySuffix: postMain };
  }

  const dropzoneMarker = '<div class="dx-announcement-bar-dropzone">';
  const dropzoneIndex = preMain.indexOf(dropzoneMarker);
  if (dropzoneIndex >= 0) {
    const bodyPrefix = `<body>\n${preMain.slice(dropzoneIndex)}`;
    return { htmlPrefix, bodyPrefix, bodySuffix: postMain };
  }

  const bodyPrefix = `<body>\n${preMain.slice(headStart + '<head>'.length)}`;
  return { htmlPrefix, bodyPrefix, bodySuffix: postMain };
}

function canonicalUrl(pathname) {
  return `${SITE_ORIGIN}${ensureLeadingSlash(pathname)}`;
}

function buildHead({
  title,
  description,
  canonicalPath,
  ogType,
  imageSrc,
  runtimeScript,
  componentCss,
}) {
  const canonical = canonicalUrl(canonicalPath);
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeAttr(description || '');
  const escapedImage = escapeAttr(imageSrc || '/assets/img/7142b356c8cfe9d18b7c.png');

  return `<head>
    <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <!-- dexdsl -->
<meta charset="utf-8" />
<title>${escapedTitle}</title>
<meta http-equiv="Accept-CH" content="Sec-CH-UA-Platform-Version, Sec-CH-UA-Model" /><link rel="icon" type="image/x-icon" href="/assets/img/54952c48d15771b9cb2a.ico"/>
<link rel="canonical" href="${escapeAttr(canonical)}"/>
<meta property="og:site_name" content="dex digital sample library"/>
<meta property="og:title" content="${escapedTitle}"/>
<meta property="og:url" content="${escapeAttr(canonical)}"/>
<meta property="og:type" content="${escapeAttr(ogType)}"/>
<meta property="og:image" content="${escapedImage}"/>
<meta itemprop="name" content="${escapedTitle}"/>
<meta itemprop="url" content="${escapeAttr(canonical)}"/>
<meta itemprop="thumbnailUrl" content="${escapedImage}"/>
<link rel="image_src" href="${escapedImage}" />
<meta itemprop="image" content="${escapedImage}"/>
<meta name="twitter:title" content="${escapedTitle}"/>
<meta name="twitter:image" content="${escapedImage}"/>
<meta name="twitter:url" content="${escapeAttr(canonical)}"/>
<meta name="twitter:card" content="summary"/>
<meta name="description" content="${escapedDescription}" />

    <link rel="stylesheet" href="/css/tokens.css">
    <link rel="stylesheet" href="/css/base.css">
    <link rel="stylesheet" href="/css/bridge.squarespace.css">
    <link rel="stylesheet" href="/css/components/dx-layout.css">
    <link rel="stylesheet" href="/css/components/dx-surface.css">
    <link rel="stylesheet" href="/css/components/dx-controls.css">
    <link rel="stylesheet" href="/css/components/dx-nav.css">
    <link rel="stylesheet" href="${escapeAttr(componentCss)}">
    <link rel="stylesheet" href="/css/components/dx-marketing-newsletter.css">
    <link rel="stylesheet" href="/css/components/dx-polls-embed.css">
    <link rel="stylesheet" href="/css/fonts.css">
    <link rel="stylesheet" href="/assets/css/dex.css">
<script src="/assets/vendor/auth0-spa-js.umd.min.js"></script>
<script defer src="/assets/dex-auth0-config.js"></script>
<script defer src="/assets/dex-auth.js"></script>
<script defer src="/assets/js/header-slot.js"></script>
<script defer src="${escapeAttr(runtimeScript)}"></script>
<link rel="preconnect" href="https://use.fonthost.net" crossorigin>
<link rel="preconnect" href="https://p.fonthost.net" crossorigin>
<link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/dexnotes/rss.xml" />
<!-- header code injection.css -->

<!-- End of legacysite Headers -->
    
  </head>`;
}

function buildIndexMain({ filterType, filterValue }) {
  return `
            <main id="page" class="container dx-dexnotes-page" role="main">
        <script>
          (function(){
            try {
              var params = new URLSearchParams(window.location.search || '');
              if (params.get('format') === 'rss') {
                window.location.replace('/dexnotes/rss.xml');
              }
            } catch (error) {}
          })();
        </script>
        <section class="dx-dexnotes-index-shell" aria-label="dex notes editorial signal desk">
          <div id="dx-dexnotes-index-app" class="dx-dexnotes-index-app" data-dexnotes-index-app data-dexnotes-filter-type="${escapeAttr(filterType)}" data-dexnotes-filter-value="${escapeAttr(filterValue)}">
            <section class="dx-dexnotes-surface dx-dexnotes-loading">
              <h1 class="dx-dexnotes-title">LOADING DEX NOTES...</h1>
            </section>
            <noscript>
              <section class="dx-dexnotes-surface dx-dexnotes-error">
                <h2 class="dx-dexnotes-title">DEX NOTES REQUIRES JAVASCRIPT.</h2>
                <p class="dx-dexnotes-copy">Enable JavaScript to browse Dex Notes stories, filters, and editorial modules.</p>
              </section>
            </noscript>
          </div>
        </section>
      </main>`;
}

function buildEntryMain(slug) {
  return `
      <main id="page" class="container dx-dexnotes-page" role="main">
        <section class="dx-dexnotes-entry-shell" aria-label="dex notes article">
          <article id="dx-dexnotes-entry-app" class="dx-dexnotes-entry-app" data-dexnotes-entry-app data-dexnotes-slug="${escapeAttr(slug)}">
            <section class="dx-dexnotes-surface dx-dexnotes-loading">
              <h1 class="dx-dexnotes-title">LOADING STORY...</h1>
            </section>
            <noscript>
              <section class="dx-dexnotes-surface dx-dexnotes-error">
                <h2 class="dx-dexnotes-title">DEX NOTES ENTRY REQUIRES JAVASCRIPT.</h2>
                <p class="dx-dexnotes-copy">Enable JavaScript to load the full story body, context rail, and comments.</p>
              </section>
            </noscript>
          </article>
        </section>
      </main>`;
}

function buildDocument(shellParts, pageMeta, mainHtml) {
  const head = buildHead(pageMeta);
  return `${shellParts.htmlPrefix}${head}${shellParts.bodyPrefix}${GOOEY_MESH_MARKUP}\n${mainHtml}${shellParts.bodySuffix}`;
}

function writePage(relativePath, html) {
  const absolutePath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, html, 'utf8');
  return absolutePath;
}

function redirectDoc(target) {
  const escapedTarget = escapeAttr(target);
  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${escapedTarget}">
<link rel="canonical" href="${escapedTarget}">
<script>location.replace("${escapedTarget}");</script>

<script defer src="/assets/vendor/auth0-spa-js.umd.min.js"></script>
<script defer src="/assets/dex-auth0-config.js"></script>
<script defer src="/assets/dex-auth.js"></script>
<script defer src="/assets/js/header-slot.js"></script>
`;
}

function unique(items) {
  return Array.from(new Set(items));
}

function entryDescription(entry) {
  const excerpt = toText(entry.excerpt_raw || '').trim();
  if (excerpt) return excerpt;
  return 'Dex Notes article from dex digital sample library.';
}

function main() {
  const shell = readShellParts();
  const indexData = readJson(DEXNOTES_INDEX_DATA_PATH);
  const entriesData = readJson(DEXNOTES_ENTRIES_DATA_PATH);
  const entries = Array.isArray(entriesData.entries) ? entriesData.entries : [];
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));

  if (entries.length === 0) {
    throw new Error('No entries found in dexnotes.entries.json. Run build_dexnotes_data.mjs first.');
  }

  const leadStory = indexData.lead_story || entries[0];
  const defaultImage = toText(leadStory.cover_image_src || '/assets/img/7142b356c8cfe9d18b7c.png');

  const written = [];

  const indexHtml = buildDocument(
    shell,
    {
      title: 'dex notes — dex digital sample library',
      description: 'Dex Notes newsroom for artists, releases, entries, and Dex updates.',
      canonicalPath: '/dexnotes/',
      ogType: 'website',
      imageSrc: defaultImage,
      runtimeScript: '/assets/js/dexnotes.index.js',
      componentCss: '/css/components/dx-dexnotes-index.css',
    },
    buildIndexMain({ filterType: 'none', filterValue: '' }),
  );
  written.push(writePage('docs/dexnotes/index.html', indexHtml));

  const categories = Array.isArray(indexData.categories) ? indexData.categories : [];
  const tags = Array.isArray(indexData.tags) ? indexData.tags : [];

  for (const category of categories) {
    const slug = toText(category.slug_raw).trim();
    if (!slug) continue;
    const html = buildDocument(
      shell,
      {
        title: `dex notes / category: ${toText(category.label_raw)} — dex digital sample library`,
        description: `Dex Notes category view for ${toText(category.label_raw)}.`,
        canonicalPath: `/dexnotes/category/${slug}/`,
        ogType: 'website',
        imageSrc: defaultImage,
        runtimeScript: '/assets/js/dexnotes.index.js',
        componentCss: '/css/components/dx-dexnotes-index.css',
      },
      buildIndexMain({ filterType: 'category', filterValue: slug }),
    );
    written.push(writePage(`docs/dexnotes/category/${slug}/index.html`, html));
    written.push(writePage(`docs/dexnotes/category/${slug}.html`, redirectDoc(`./${slug}/`)));
  }

  for (const tag of tags) {
    const slug = toText(tag.slug_raw).trim();
    if (!slug) continue;
    const html = buildDocument(
      shell,
      {
        title: `dex notes / tag: ${toText(tag.label_raw)} — dex digital sample library`,
        description: `Dex Notes tag view for ${toText(tag.label_raw)}.`,
        canonicalPath: `/dexnotes/tag/${slug}/`,
        ogType: 'website',
        imageSrc: defaultImage,
        runtimeScript: '/assets/js/dexnotes.index.js',
        componentCss: '/css/components/dx-dexnotes-index.css',
      },
      buildIndexMain({ filterType: 'tag', filterValue: slug }),
    );
    written.push(writePage(`docs/dexnotes/tag/${slug}/index.html`, html));
    written.push(writePage(`docs/dexnotes/tag/${slug}.html`, redirectDoc(`./${slug}/`)));
  }

  for (const entry of entries) {
    const slug = toText(entry.slug).trim();
    if (!slug) continue;

    const html = buildDocument(
      shell,
      {
        title: `${toText(entry.title_raw)} — dex notes — dex digital sample library`,
        description: entryDescription(entry),
        canonicalPath: `/dexnotes/${slug}/`,
        ogType: 'article',
        imageSrc: toText(entry.cover_image_src || defaultImage),
        runtimeScript: '/assets/js/dexnotes.entry.js',
        componentCss: '/css/components/dx-dexnotes-entry.css',
      },
      buildEntryMain(slug),
    );

    written.push(writePage(`docs/dexnotes/${slug}/index.html`, html));
    written.push(writePage(`docs/dexnotes/${slug}.html`, redirectDoc(`./${slug}/`)));
  }

  written.push(writePage('docs/dexnotes.html', redirectDoc('./dexnotes/')));

  const authors = Array.isArray(indexData.authors) ? indexData.authors : [];
  for (const author of authors) {
    const id = toText(author.id).trim();
    if (!id) continue;
    written.push(writePage(`docs/dexnotes?author=${id}.html`, redirectDoc(`./dexnotes/?author=${id}`)));
    written.push(writePage(`docs/dexnotes?author=${id}/index.html`, redirectDoc(`/dexnotes/?author=${id}`)));
  }

  written.push(writePage('docs/dexnotes?format=rss', redirectDoc('/dexnotes/rss.xml')));

  const expectedWrappers = unique(entries.map((entry) => toText(entry.slug).trim()).filter(Boolean));
  for (const slug of expectedWrappers) {
    if (!fs.existsSync(path.join(ROOT, `docs/dexnotes/${slug}.html`))) {
      written.push(writePage(`docs/dexnotes/${slug}.html`, redirectDoc(`./${slug}/`)));
    }
  }

  const missing = [];
  for (const entry of entries) {
    const slug = toText(entry.slug).trim();
    if (!bySlug.has(slug)) {
      missing.push(slug);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing rendered entry pages for slugs: ${missing.join(', ')}`);
  }

  console.log(`dexnotes:render wrote ${written.length} files.`);
}

try {
  main();
} catch (error) {
  console.error(`dexnotes:render failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
