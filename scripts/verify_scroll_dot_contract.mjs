#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');
const BASE_CSS_PATH = path.join(ROOT, 'public', 'css', 'base.css');
const DOT_RUNTIME_PATH = path.join(ROOT, 'public', 'assets', 'js', 'dx-scroll-dot.js');
const DOT_SCRIPT_NEEDLE = '/assets/js/dx-scroll-dot.js';

const REQUIRED_MARKERS = [
  '--dex-scroll-dot-size',
  '--dex-scroll-rail-w',
  '--dex-scroll-shift-x',
  '--dex-scroll-dot-z',
  '--dex-scroll-inset-top',
  '--dex-scroll-inset-bottom',
  '.dex-scroll-rail',
  '.dex-scroll-dot',
  '.dex-scroll-rail.is-visible',
  '.dex-scroll-dot.dragging',
];

const FORBIDDEN_INLINE_MARKERS = [
  'id="dex-scroll-dot-css"',
  'id="dex-scroll-dot-js"',
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function listHtmlFiles(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listHtmlFiles(absolutePath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(absolutePath);
    }
  }
  return out;
}

function needsDotRuntime(html) {
  return html.includes('<main id="page"')
    || html.includes('id="siteWrapper"')
    || html.includes('data-page-sections=')
    || html.includes('data-footer-sections')
    || html.includes('header-announcement-bar-wrapper');
}

function verifyCssContract(failures) {
  const css = readText(BASE_CSS_PATH);
  for (const marker of REQUIRED_MARKERS) {
    if (!css.includes(marker)) {
      failures.push(`base.css missing marker: ${marker}`);
    }
  }
}

function verifyHtmlCoverage(failures) {
  if (!fs.existsSync(DOCS_DIR)) {
    failures.push('docs directory is missing');
    return;
  }

  const htmlFiles = listHtmlFiles(DOCS_DIR);
  let runtimeRequiredCount = 0;

  for (const absolutePath of htmlFiles) {
    const relPath = path.relative(ROOT, absolutePath);
    const html = readText(absolutePath);

    for (const marker of FORBIDDEN_INLINE_MARKERS) {
      if (html.includes(marker)) {
        failures.push(`forbidden inline scroll-dot block found in ${relPath}: ${marker}`);
      }
    }

    if (!needsDotRuntime(html)) continue;
    runtimeRequiredCount += 1;
    if (!html.includes(DOT_SCRIPT_NEEDLE)) {
      failures.push(`missing dx-scroll-dot runtime include in ${relPath}`);
    }
  }

  if (runtimeRequiredCount === 0) {
    failures.push('no html routes were classified as requiring dx-scroll-dot runtime');
  }
}

function main() {
  const failures = [];

  readText(DOT_RUNTIME_PATH);
  verifyCssContract(failures);
  verifyHtmlCoverage(failures);

  if (failures.length > 0) {
    console.error(`verify:scroll-dot failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:scroll-dot passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:scroll-dot error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
