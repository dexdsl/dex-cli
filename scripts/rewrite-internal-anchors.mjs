#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'parse5';

const TARGET_HOSTNAMES = new Set([
  'dexdsl.github.io',
  'www.dexdsl.github.io',
  'dexdsl.org',
  'www.dexdsl.org',
  'dexdsl.com',
  'www.dexdsl.com',
]);

const PUBLISH_DIR = process.env.PUBLISH_DIR
  ? path.resolve(process.env.PUBLISH_DIR)
  : process.cwd();

const isCheckMode = process.argv.includes('--check');

function normalizeBase(base) {
  if (!base || base === '/') return '';

  let normalized = base.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(/\/+$/, '');
  return normalized === '/' ? '' : normalized;
}

function deriveDefaultBasePath() {
  const explicit = process.env.BASE_PATH;
  if (typeof explicit === 'string') {
    return normalizeBase(explicit);
  }

  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
  if (!repo) return '';
  if (repo.toLowerCase().endsWith('.github.io')) return '';
  return normalizeBase(`/${repo}`);
}

function isSupportedHref(href) {
  if (!href) return false;
  const lowered = href.trim().toLowerCase();
  if (!lowered) return false;

  if (
    lowered.startsWith('mailto:') ||
    lowered.startsWith('tel:') ||
    lowered.startsWith('javascript:') ||
    lowered.startsWith('data:')
  ) {
    return false;
  }

  return (
    lowered.startsWith('http://') ||
    lowered.startsWith('https://') ||
    lowered.startsWith('//')
  );
}

function getReplacementHref(href, basePath) {
  if (!isSupportedHref(href)) return null;

  let url;
  try {
    url = new URL(href, 'https://dexdsl.github.io');
  } catch {
    return null;
  }

  if (!TARGET_HOSTNAMES.has(url.hostname.toLowerCase())) return null;
  if (!(url.protocol === 'http:' || url.protocol === 'https:')) return null;

  const pathAndSuffix = `${url.pathname}${url.search}${url.hash}`;
  return basePath ? `${basePath}${pathAndSuffix}` : pathAndSuffix;
}

async function collectHtmlFiles(rootDir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

function gatherReplacements(html, basePath) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const replacements = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if ((node.nodeName === 'a' || node.nodeName === 'area') && node.attrs && node.sourceCodeLocation?.attrs?.href) {
      const hrefAttr = node.attrs.find((attr) => attr.name === 'href');
      if (hrefAttr) {
        const replacementHref = getReplacementHref(hrefAttr.value, basePath);
        if (replacementHref && replacementHref !== hrefAttr.value) {
          const loc = node.sourceCodeLocation.attrs.href;
          replacements.push({
            startOffset: loc.startOffset,
            endOffset: loc.endOffset,
            text: `href="${replacementHref}"`,
          });
        }
      }
    }

    if (node.childNodes) {
      for (const child of node.childNodes) {
        visit(child);
      }
    }
  }

  visit(document);
  return replacements;
}

function applyReplacements(content, replacements) {
  if (replacements.length === 0) return content;

  const ordered = [...replacements].sort((a, b) => b.startOffset - a.startOffset);
  let updated = content;
  for (const replacement of ordered) {
    updated =
      updated.slice(0, replacement.startOffset) +
      replacement.text +
      updated.slice(replacement.endOffset);
  }
  return updated;
}

async function processFile(filePath, basePath, checkMode) {
  const original = await fs.readFile(filePath, 'utf8');
  const replacements = gatherReplacements(original, basePath);

  if (!checkMode && replacements.length > 0) {
    const updated = applyReplacements(original, replacements);
    if (updated !== original) {
      await fs.writeFile(filePath, updated, 'utf8');
    }
  }

  return replacements.length;
}

async function main() {
  const basePath = deriveDefaultBasePath();
  const htmlFiles = await collectHtmlFiles(PUBLISH_DIR);

  if (htmlFiles.length === 0) {
    console.error(`No HTML files found in ${PUBLISH_DIR}`);
    process.exit(1);
  }

  let total = 0;
  for (const filePath of htmlFiles) {
    const count = await processFile(filePath, basePath, isCheckMode);
    total += count;
    console.log(`${path.relative(PUBLISH_DIR, filePath)}: ${count}`);
  }

  if (isCheckMode && total > 0) {
    console.error(`Check failed: found ${total} link(s) requiring rewrite.`);
    process.exit(1);
  }

  console.log(`Total ${isCheckMode ? 'matches' : 'rewrites'}: ${total}`);
}

await main();
