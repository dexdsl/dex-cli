#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'public', 'data', 'hdr.media-manifest.json');

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

function wrapImageWithPicture(html, image) {
  const sourceRe = new RegExp(`(<img\\b[^>]*\\bsrc=\"${escapeRegExp(image.source)}\"[^>]*>)`, 'g');
  let replaced = 0;

  const next = html.replace(sourceRe, (imgTag, _whole, offset, all) => {
    const before = all.slice(0, offset);
    const openPictures = (before.match(/<picture\b[^>]*class="[^"]*dx-hdr-picture[^"]*"[^>]*>/g) || []).length;
    const closedPictures = (before.match(/<\/picture>/g) || []).length;
    if (openPictures > closedPictures) return imgTag;
    replaced += 1;
    return [
      '<picture class="dx-hdr-picture">',
      `  <source media="(dynamic-range: high) and (color-gamut: p3)" type="image/avif" srcset="${image.hdrAvif}">`,
      `  <source type="image/avif" srcset="${image.sdrAvif}">`,
      `  ${imgTag}`,
      '</picture>',
    ].join('\n');
  });

  return { html: next, replaced };
}

function injectVideoSources(html, video) {
  const re = /<video\b([\s\S]*?)\bsrc="\/assets\/media\/placeholder\.m3u8"([\s\S]*?)>\s*<\/video>/g;
  let replaced = 0;
  const next = html.replace(re, (full, beforeSrc, afterSrc) => {
    if (full.includes('data-dx-hdr-video="true"')) return full;
    const attrs = `${beforeSrc || ''}${afterSrc || ''}`;
    const compactAttrs = attrs
      .replace(/\s+/g, ' ')
      .replace(/\s+>/g, '>')
      .trim();
    replaced += 1;
    return [
      `<video ${compactAttrs} data-dx-hdr-video="true">`,
      `  <source media="(video-dynamic-range: high)" src="${video.hdrMp4}" type="video/mp4">`,
      `  <source src="${video.sdrMp4}" type="video/mp4">`,
      `  <source src="${video.legacySource}" type="application/vnd.apple.mpegurl">`,
      '</video>',
    ].join('\n');
  });
  return { html: next, replaced };
}

async function processFile(relativePath, manifest) {
  const absolutePath = path.join(ROOT, relativePath);
  let original;
  try {
    original = await fs.readFile(absolutePath, 'utf8');
  } catch {
    return { file: relativePath, changed: false, imageReplacements: 0, videoReplacements: 0, missing: true };
  }

  let html = original;
  let imageReplacements = 0;
  let videoReplacements = 0;

  const images = (manifest.images || []).filter((item) => item.ready && Array.isArray(item.targets) && item.targets.includes(relativePath));
  for (const image of images) {
    const res = wrapImageWithPicture(html, image);
    html = res.html;
    imageReplacements += res.replaced;
  }

  const videos = (manifest.videos || []).filter((item) => item.ready && Array.isArray(item.targets) && item.targets.includes(relativePath));
  for (const video of videos) {
    const res = injectVideoSources(html, video);
    html = res.html;
    videoReplacements += res.replaced;
  }

  if (html === original) {
    return { file: relativePath, changed: false, imageReplacements, videoReplacements, missing: false };
  }

  await fs.writeFile(absolutePath, html, 'utf8');
  return { file: relativePath, changed: true, imageReplacements, videoReplacements, missing: false };
}

async function main() {
  const manifest = await readJson(MANIFEST_PATH);

  const targetFiles = new Set();
  for (const image of manifest.images || []) {
    for (const target of image.targets || []) targetFiles.add(target);
  }
  for (const video of manifest.videos || []) {
    for (const target of video.targets || []) targetFiles.add(target);
  }

  const results = [];
  for (const relativePath of targetFiles) {
    results.push(await processFile(relativePath, manifest));
  }

  const missingFiles = results.filter((result) => result.missing);
  const changedFiles = results.filter((result) => result.changed);
  const imageCount = results.reduce((sum, result) => sum + result.imageReplacements, 0);
  const videoCount = results.reduce((sum, result) => sum + result.videoReplacements, 0);

  if (missingFiles.length) {
    for (const missing of missingFiles) {
      console.warn(`hdr:inject skipped missing file: ${missing.file}`);
    }
  }

  console.log(
    `hdr:inject processed ${results.length} file(s), changed ${changedFiles.length}, `
    + `image replacements ${imageCount}, video replacements ${videoCount}.`
  );
}

main().catch((error) => {
  console.error(`hdr:inject failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
