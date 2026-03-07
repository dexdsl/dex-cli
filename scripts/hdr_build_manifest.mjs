#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const MANIFEST_PUBLIC_PATH = path.join(ROOT, 'public', 'data', 'hdr.media-manifest.json');
const MANIFEST_RUNTIME_TARGETS = [
  path.join(ROOT, 'data', 'hdr.media-manifest.json'),
  path.join(ROOT, 'docs', 'data', 'hdr.media-manifest.json'),
];

const IMAGE_VARIANTS = [
  {
    id: 'about-team-ssuarez',
    source: '/assets/img/2319bdb331c97527f23f.jpg',
    sdrAvif: '/assets/hdr/images/2319bdb331c97527f23f.sdr.avif',
    hdrAvif: '/assets/hdr/images/2319bdb331c97527f23f.hdr.avif',
    targets: ['docs/about/index.html'],
  },
  {
    id: 'about-team-cchurch',
    source: '/assets/img/8777ddc189323d789f1c.jpg',
    sdrAvif: '/assets/hdr/images/8777ddc189323d789f1c.sdr.avif',
    hdrAvif: '/assets/hdr/images/8777ddc189323d789f1c.hdr.avif',
    targets: ['docs/about/index.html'],
  },
  {
    id: 'about-team-tjordan',
    source: '/assets/img/15e1054490df27af1ca2.jpg',
    sdrAvif: '/assets/hdr/images/15e1054490df27af1ca2.sdr.avif',
    hdrAvif: '/assets/hdr/images/15e1054490df27af1ca2.hdr.avif',
    targets: ['docs/about/index.html'],
  },
];

const VIDEO_VARIANTS = [
  {
    id: 'home-signup-loop',
    legacySource: '/assets/media/placeholder.m3u8',
    sdrMp4: '/assets/media/placeholder.sdr.mp4',
    hdrMp4: '/assets/media/placeholder.hdr.mp4',
    targets: ['components/home/signup.js', 'docs/index.html'],
  },
];

function toPublicAssetPath(assetUrl) {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('/assets/')) return '';
  return path.join(ROOT, 'public', assetUrl.slice(1));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyFileSafe(fromPath, toPath) {
  await ensureDir(toPath);
  await fs.copyFile(fromPath, toPath);
}

async function syncAssetToRuntime(assetUrl) {
  const src = toPublicAssetPath(assetUrl);
  if (!src || !(await exists(src))) return false;
  const rel = assetUrl.replace(/^\//, '');
  const runtimeTargets = [
    path.join(ROOT, rel),
    path.join(ROOT, 'docs', rel),
  ];
  for (const dest of runtimeTargets) {
    await copyFileSafe(src, dest);
  }
  return true;
}

function collectMissing(assetMap) {
  return Object.entries(assetMap)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
}

async function buildImageEntries() {
  const entries = [];
  for (const item of IMAGE_VARIANTS) {
    const sourceOk = await exists(toPublicAssetPath(item.source));
    const sdrOk = await exists(toPublicAssetPath(item.sdrAvif));
    const hdrOk = await exists(toPublicAssetPath(item.hdrAvif));
    entries.push({
      ...item,
      ready: sourceOk && sdrOk && hdrOk,
      missing: collectMissing({ source: sourceOk, sdrAvif: sdrOk, hdrAvif: hdrOk }),
    });
  }
  return entries;
}

async function buildVideoEntries() {
  const entries = [];
  for (const item of VIDEO_VARIANTS) {
    const legacyOk = await exists(toPublicAssetPath(item.legacySource));
    const sdrOk = await exists(toPublicAssetPath(item.sdrMp4));
    const hdrOk = await exists(toPublicAssetPath(item.hdrMp4));
    entries.push({
      ...item,
      ready: legacyOk && sdrOk && hdrOk,
      missing: collectMissing({ legacySource: legacyOk, sdrMp4: sdrOk, hdrMp4: hdrOk }),
    });
  }
  return entries;
}

async function writeManifest(manifest) {
  await ensureDir(MANIFEST_PUBLIC_PATH);
  await fs.writeFile(MANIFEST_PUBLIC_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  for (const targetPath of MANIFEST_RUNTIME_TARGETS) {
    await copyFileSafe(MANIFEST_PUBLIC_PATH, targetPath);
  }
}

async function syncAssets(manifest) {
  const assetUrls = new Set();
  for (const image of manifest.images) {
    assetUrls.add(image.source);
    assetUrls.add(image.sdrAvif);
    assetUrls.add(image.hdrAvif);
  }
  for (const video of manifest.videos) {
    assetUrls.add(video.legacySource);
    assetUrls.add(video.sdrMp4);
    assetUrls.add(video.hdrMp4);
  }

  let copied = 0;
  let skipped = 0;
  for (const assetUrl of assetUrls) {
    if (!assetUrl) continue;
    const ok = await syncAssetToRuntime(assetUrl);
    if (ok) copied += 1;
    else skipped += 1;
  }
  return { copied, skipped };
}

async function main() {
  const images = await buildImageEntries();
  const videos = await buildVideoEntries();

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    images,
    videos,
  };

  await writeManifest(manifest);
  const syncStats = await syncAssets(manifest);

  const readyImages = images.filter((item) => item.ready).length;
  const readyVideos = videos.filter((item) => item.ready).length;

  console.log(
    `hdr:manifest wrote ${path.relative(ROOT, MANIFEST_PUBLIC_PATH)} `
    + `(images ready ${readyImages}/${images.length}, videos ready ${readyVideos}/${videos.length}).`
  );
  console.log(`hdr:manifest synced assets (copied ${syncStats.copied}, skipped ${syncStats.skipped}).`);
}

main().catch((error) => {
  console.error(`hdr:manifest failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
