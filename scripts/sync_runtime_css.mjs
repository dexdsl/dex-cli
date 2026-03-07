#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SYNC_MAP = [
  {
    source: 'public/data/dexnotes.index.json',
    targets: ['data/dexnotes.index.json', 'docs/data/dexnotes.index.json'],
  },
  {
    source: 'public/data/dexnotes.entries.json',
    targets: ['data/dexnotes.entries.json', 'docs/data/dexnotes.entries.json'],
  },
  {
    source: 'public/data/dexnotes.comments.json',
    targets: ['data/dexnotes.comments.json', 'docs/data/dexnotes.comments.json'],
  },
  {
    source: 'public/data/catalog.data.json',
    targets: ['data/catalog.data.json', 'docs/data/catalog.data.json'],
  },
  {
    source: 'public/data/catalog.entries.json',
    targets: ['data/catalog.entries.json', 'docs/data/catalog.entries.json'],
  },
  {
    source: 'data/catalog.seasons.json',
    targets: ['public/data/catalog.seasons.json', 'docs/data/catalog.seasons.json'],
  },
  {
    source: 'data/catalog.editorial.json',
    targets: ['public/data/catalog.editorial.json', 'docs/data/catalog.editorial.json'],
  },
  {
    source: 'data/catalog.curation.snapshot.json',
    targets: ['public/data/catalog.curation.snapshot.json', 'docs/data/catalog.curation.snapshot.json'],
  },
  {
    source: 'data/home.featured.json',
    targets: ['public/data/home.featured.json', 'docs/data/home.featured.json'],
  },
  {
    source: 'data/home.featured.snapshot.json',
    targets: ['public/data/home.featured.snapshot.json', 'docs/data/home.featured.snapshot.json'],
  },
  {
    source: 'data/protected.assets.json',
    targets: ['public/data/protected.assets.json', 'docs/data/protected.assets.json'],
  },
  {
    source: 'data/entry-runtime-audit.exemptions.json',
    targets: ['public/data/entry-runtime-audit.exemptions.json', 'docs/data/entry-runtime-audit.exemptions.json'],
  },
  {
    source: 'public/data/catalog.guide.json',
    targets: ['data/catalog.guide.json', 'docs/data/catalog.guide.json'],
  },
  {
    source: 'public/data/catalog.symbols.json',
    targets: ['data/catalog.symbols.json', 'docs/data/catalog.symbols.json'],
  },
  {
    source: 'public/data/catalog.search.json',
    targets: ['data/catalog.search.json', 'docs/data/catalog.search.json'],
  },
  {
    source: 'public/data/call.data.json',
    targets: ['data/call.data.json', 'docs/data/call.data.json'],
  },
  {
    source: 'data/calls.registry.json',
    targets: ['public/data/calls.registry.json', 'docs/data/calls.registry.json'],
  },
  {
    source: 'public/data/call.editorial.copy.json',
    targets: ['data/call.editorial.copy.json', 'docs/data/call.editorial.copy.json'],
  },
  {
    source: 'public/data/about.data.json',
    targets: ['data/about.data.json', 'docs/data/about.data.json'],
  },
  {
    source: 'data/achievements.registry.json',
    targets: ['public/data/achievements.registry.json', 'docs/data/achievements.registry.json'],
  },
  {
    source: 'public/data/achievements.data.json',
    targets: ['data/achievements.data.json', 'docs/data/achievements.data.json'],
  },
  {
    source: 'public/data/profile-taxonomy.json',
    targets: ['data/profile-taxonomy.json', 'docs/data/profile-taxonomy.json'],
  },
  {
    source: 'public/data/submit.call.schema.json',
    targets: ['data/submit.call.schema.json', 'docs/data/submit.call.schema.json'],
  },
  {
    source: 'public/data/hdr.media-manifest.json',
    targets: ['data/hdr.media-manifest.json', 'docs/data/hdr.media-manifest.json'],
  },
  {
    source: 'public/css/base.css',
    targets: ['css/base.css', 'docs/css/base.css'],
  },
  {
    source: 'public/css/components/dx-catalog-index.css',
    targets: ['css/components/dx-catalog-index.css', 'docs/css/components/dx-catalog-index.css'],
  },
  {
    source: 'public/css/components/dx-catalog-how.css',
    targets: ['css/components/dx-catalog-how.css', 'docs/css/components/dx-catalog-how.css'],
  },
  {
    source: 'public/css/components/dx-catalog-symbols.css',
    targets: ['css/components/dx-catalog-symbols.css', 'docs/css/components/dx-catalog-symbols.css'],
  },
  {
    source: 'public/css/components/dx-call-editorial.css',
    targets: ['css/components/dx-call-editorial.css', 'docs/css/components/dx-call-editorial.css'],
  },
  {
    source: 'public/css/components/dx-marketing-newsletter.css',
    targets: ['css/components/dx-marketing-newsletter.css', 'docs/css/components/dx-marketing-newsletter.css'],
  },
  {
    source: 'public/css/components/dx-polls-embed.css',
    targets: ['css/components/dx-polls-embed.css', 'docs/css/components/dx-polls-embed.css'],
  },
  {
    source: 'public/css/components/dx-submit-samples.css',
    targets: ['css/components/dx-submit-samples.css', 'docs/css/components/dx-submit-samples.css'],
  },
  {
    source: 'public/css/components/dx-submission-tracker.css',
    targets: ['css/components/dx-submission-tracker.css', 'docs/css/components/dx-submission-tracker.css'],
  },
  {
    source: 'public/css/components/dx-pressroom.css',
    targets: ['css/components/dx-pressroom.css', 'docs/css/components/dx-pressroom.css'],
  },
  {
    source: 'public/css/components/dx-settings-membership.css',
    targets: ['css/components/dx-settings-membership.css', 'docs/css/components/dx-settings-membership.css'],
  },
  {
    source: 'public/css/components/dx-settings-profile.css',
    targets: ['css/components/dx-settings-profile.css', 'docs/css/components/dx-settings-profile.css'],
  },
  {
    source: 'public/css/components/dx-controls.css',
    targets: ['css/components/dx-controls.css', 'docs/css/components/dx-controls.css'],
  },
  {
    source: 'public/css/components/dx-about.css',
    targets: ['css/components/dx-about.css', 'docs/css/components/dx-about.css'],
  },
  {
    source: 'public/css/components/dx-donate.css',
    targets: ['css/components/dx-donate.css', 'docs/css/components/dx-donate.css'],
  },
  {
    source: 'public/css/components/dx-contact.css',
    targets: ['css/components/dx-contact.css', 'docs/css/components/dx-contact.css'],
  },
  {
    source: 'public/css/components/dx-achievements.css',
    targets: ['css/components/dx-achievements.css', 'docs/css/components/dx-achievements.css'],
  },
  {
    source: 'public/css/components/dx-dexnotes-index.css',
    targets: ['css/components/dx-dexnotes-index.css', 'docs/css/components/dx-dexnotes-index.css'],
  },
  {
    source: 'public/css/components/dx-dexnotes-entry.css',
    targets: ['css/components/dx-dexnotes-entry.css', 'docs/css/components/dx-dexnotes-entry.css'],
  },
  {
    source: 'public/assets/js/catalog.index.js',
    targets: ['assets/js/catalog.index.js', 'docs/assets/js/catalog.index.js'],
  },
  {
    source: 'public/assets/js/catalog.how.js',
    targets: ['assets/js/catalog.how.js', 'docs/assets/js/catalog.how.js'],
  },
  {
    source: 'public/assets/js/catalog.symbols.js',
    targets: ['assets/js/catalog.symbols.js', 'docs/assets/js/catalog.symbols.js'],
  },
  {
    source: 'public/assets/js/dx-favorites.js',
    targets: ['assets/js/dx-favorites.js', 'docs/assets/js/dx-favorites.js'],
  },
  {
    source: 'public/assets/js/dx-bag.js',
    targets: ['assets/js/dx-bag.js', 'docs/assets/js/dx-bag.js'],
  },
  {
    source: 'public/assets/js/bag.app.js',
    targets: ['assets/js/bag.app.js', 'docs/assets/js/bag.app.js'],
  },
  {
    source: 'public/assets/js/call.editorial.js',
    targets: ['assets/js/call.editorial.js', 'docs/assets/js/call.editorial.js'],
  },
  {
    source: 'public/assets/js/dx-marketing-newsletter.js',
    targets: ['assets/js/dx-marketing-newsletter.js', 'docs/assets/js/dx-marketing-newsletter.js'],
  },
  {
    source: 'public/assets/js/dexnotes.index.js',
    targets: ['assets/js/dexnotes.index.js', 'docs/assets/js/dexnotes.index.js'],
  },
  {
    source: 'public/assets/js/dexnotes.entry.js',
    targets: ['assets/js/dexnotes.entry.js', 'docs/assets/js/dexnotes.entry.js'],
  },
  {
    source: 'public/assets/js/settings.membership.js',
    targets: ['assets/js/settings.membership.js', 'docs/assets/js/settings.membership.js'],
  },
  {
    source: 'public/assets/js/settings.profile.js',
    targets: ['assets/js/settings.profile.js', 'docs/assets/js/settings.profile.js'],
  },
  {
    source: 'public/assets/js/header-slot.js',
    targets: ['assets/js/header-slot.js', 'docs/assets/js/header-slot.js'],
  },
  {
    source: 'public/assets/js/dex-breadcrumb-motion.js',
    targets: ['assets/js/dex-breadcrumb-motion.js', 'docs/assets/js/dex-breadcrumb-motion.js'],
  },
  {
    source: 'public/assets/js/dx-scroll-dot.js',
    targets: ['assets/js/dx-scroll-dot.js', 'docs/assets/js/dx-scroll-dot.js'],
  },
  {
    source: 'public/assets/js/dx-about.js',
    targets: ['assets/js/dx-about.js', 'docs/assets/js/dx-about.js'],
  },
  {
    source: 'public/assets/js/donate.js',
    targets: ['assets/js/donate.js', 'docs/assets/js/donate.js'],
  },
  {
    source: 'public/assets/js/contact.js',
    targets: ['assets/js/contact.js', 'docs/assets/js/contact.js'],
  },
  {
    source: 'public/assets/js/achievements.js',
    targets: ['assets/js/achievements.js', 'docs/assets/js/achievements.js'],
  },
  {
    source: 'public/assets/css/dex.css',
    targets: ['assets/css/dex.css', 'docs/assets/css/dex.css'],
  },
  {
    source: 'public/assets/dex-sidebar.js',
    targets: ['assets/dex-sidebar.js', 'docs/assets/dex-sidebar.js'],
  },
  {
    source: 'public/assets/series/dex.png',
    targets: ['assets/series/dex.png', 'docs/assets/series/dex.png'],
  },
  {
    source: 'public/assets/series/index.png',
    targets: ['assets/series/index.png', 'docs/assets/series/index.png'],
  },
  {
    source: 'public/assets/series/dexfest.png',
    targets: ['assets/series/dexfest.png', 'docs/assets/series/dexfest.png'],
  },
  {
    source: 'public/assets/dex-auth.js',
    targets: ['assets/dex-auth.js', 'docs/assets/dex-auth.js'],
  },
  {
    source: 'public/assets/dex-runtime-config.js',
    targets: ['assets/dex-runtime-config.js', 'docs/assets/dex-runtime-config.js'],
  },
  {
    source: 'public/assets/dex-auth0-config.js',
    targets: ['assets/dex-auth0-config.js', 'docs/assets/dex-auth0-config.js'],
  },
  {
    source: 'public/assets/dex-auth-config.js',
    targets: ['assets/dex-auth-config.js', 'docs/assets/dex-auth-config.js'],
  },
  {
    source: 'public/assets/vendor/auth0-spa-js.umd.min.js',
    targets: ['assets/vendor/auth0-spa-js.umd.min.js', 'docs/assets/vendor/auth0-spa-js.umd.min.js'],
  },
  {
    source: 'public/dexnotes/rss.xml',
    targets: ['dexnotes/rss.xml'],
  },
];

function ensureSourceExists(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing source file: ${relativePath}`);
  }
  return absolutePath;
}

function syncOne(sourceAbsolutePath, sourceRelativePath, targetRelativePath) {
  const targetAbsolutePath = path.join(ROOT, targetRelativePath);
  fs.mkdirSync(path.dirname(targetAbsolutePath), { recursive: true });
  fs.copyFileSync(sourceAbsolutePath, targetAbsolutePath);
  console.log(`synced ${sourceRelativePath} -> ${targetRelativePath}`);
}

function main() {
  for (const entry of SYNC_MAP) {
    const sourceAbsolutePath = ensureSourceExists(entry.source);
    for (const target of entry.targets) {
      syncOne(sourceAbsolutePath, entry.source, target);
    }
  }
}

main();
