#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INCLUDED_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs']);
const EXCLUDED_PREFIXES = [
  'node_modules/',
  'dist/',
  'build/',
  'artifacts/',
  '.git/',
  'playwright-report/',
  'test-results/',
];

const substringPatterns = [
  { key: 'legacy-host-legacysite.com', regex: /legacysite\.com/gi },
  { key: 'legacy-host-legacysite-cdn.com', regex: /legacysite-cdn\.com/gi },
  { key: 'legacy-substring-static1.', regex: /static1\./gi },
  { key: 'legacy-substring-assets.', regex: /assets\./gi },
  { key: 'legacy-substring-images.', regex: /images\./gi },
  { key: 'legacy-substring-versioned-site-css', regex: /versioned-site-css/gi },
  { key: 'legacy-substring-user-account-core', regex: /user-account-core/gi },
  { key: 'legacy-substring-format=1500w', regex: /format=1500w/gi },
  { key: 'legacy-substring-format={N}w', regex: /format=\d+w/gi },
];

const absoluteStylesheetPatterns = [
  /<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*\bhref\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi,
  /<link\b[^>]*\bhref\s*=\s*["']https?:\/\/[^"']+["'][^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi,
];

const baseTagPattern = /<base\b[^>]*\bhref\s*=\s*["'][^"']*["'][^>]*>/gi;
const cssImportPattern = /@import\s+(?:url\(\s*)?["']?https?:\/\/[^"')\s]+(?:["']?\s*\))?/gi;
const jsStylesheetInjectionPatterns = [
  /setAttribute\(\s*["']rel["']\s*,\s*["']stylesheet["']\s*\)/gi,
  /\.rel\s*=\s*["']stylesheet["']/gi,
];
const jsBaseMutationPatterns = [
  /document\.baseURI/gi,
  /createElement\(\s*["']base["']\s*\)/gi,
  /querySelector\(\s*["'][^"']*base[^"']*["']\s*\)/gi,
];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split('\0')
    .filter(Boolean)
    .map(toPosix);
}

function isExcluded(filePath) {
  return EXCLUDED_PREFIXES.some((prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix));
}

function isIncluded(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return INCLUDED_EXTENSIONS.has(ext);
}

function buildLineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineFromIndex(index, starts) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= index) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function snippetAt(content, index, length) {
  const start = Math.max(0, index - 70);
  const end = Math.min(content.length, index + Math.max(length, 1) + 70);
  return content.slice(start, end).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function collectMatches(filePath, content, lineStarts, key, regex) {
  const results = [];
  regex.lastIndex = 0;
  let match = regex.exec(content);
  while (match) {
    const index = match.index;
    const length = match[0].length;
    results.push({
      type: key,
      file: filePath,
      line: lineFromIndex(index, lineStarts),
      snippet: snippetAt(content, index, length),
    });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
    match = regex.exec(content);
  }
  return results;
}

function scanFile(filePath) {
  const absolutePath = path.join(ROOT, filePath);
  if (!fs.existsSync(absolutePath)) return [];
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lineStarts = buildLineStarts(content);
  const findings = [];

  for (const { key, regex } of substringPatterns) {
    findings.push(...collectMatches(filePath, content, lineStarts, key, regex));
  }

  for (const regex of absoluteStylesheetPatterns) {
    findings.push(...collectMatches(filePath, content, lineStarts, 'absolute-stylesheet-link', regex));
  }

  findings.push(...collectMatches(filePath, content, lineStarts, 'base-tag', baseTagPattern));
  findings.push(...collectMatches(filePath, content, lineStarts, 'css-import-http', cssImportPattern));

  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.html')) {
    for (const regex of jsStylesheetInjectionPatterns) {
      findings.push(...collectMatches(filePath, content, lineStarts, 'js-stylesheet-injection-hint', regex));
    }
    for (const regex of jsBaseMutationPatterns) {
      findings.push(...collectMatches(filePath, content, lineStarts, 'js-base-mutation-hint', regex));
    }
  }

  return findings;
}

function main() {
  const files = listTrackedFiles()
    .filter((filePath) => !isExcluded(filePath))
    .filter((filePath) => isIncluded(filePath))
    .sort((a, b) => a.localeCompare(b));

  const findings = [];
  for (const filePath of files) {
    findings.push(...scanFile(filePath));
  }

  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.type.localeCompare(b.type);
  });

  const byType = new Map();
  for (const finding of findings) {
    byType.set(finding.type, (byType.get(finding.type) || 0) + 1);
  }

  console.log('diag:legacy report');
  console.log(`- files scanned: ${files.length}`);
  console.log(`- findings: ${findings.length}`);
  console.log('- findings by type:');
  for (const [type, count] of Array.from(byType.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  - ${type}: ${count}`);
  }
  if (findings.length === 0) return;

  console.log('- details:');
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line} [${finding.type}] ${finding.snippet}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`diag:legacy error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
