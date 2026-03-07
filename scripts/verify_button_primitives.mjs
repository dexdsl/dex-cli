#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const TARGETED_FILES = [
  'docs/index.html',
  'docs/dexnotes/help-us-seat-dexs-founding-expansion-board/index.html',
  'docs/entry/submit/index.html',
  'docs/entry/messages/index.html',
  'docs/entry/favorites/index.html',
  'docs/entry/pressroom/index.html',
  'docs/messages.html',
];

const PRIMARY_ALIASES = new Set(['cta-btn', 'cta', 'dex-btn']);
const SECONDARY_ALIASES = new Set(['ghost', 'ghost-btn']);
const SIZE_REQUIRED_ALIASES = new Set(['cta-btn', 'cta', 'dex-btn', 'ghost', 'ghost-btn']);

const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const LEGACY_SELECTOR_RE = /\.(cta-btn|ghost-btn|dex-btn)\b[^{}]*\{([\s\S]*?)\}/gi;
const SKIN_PROPERTY_RE = /\b(background(?:-color)?|border(?:-radius|-color)?|box-shadow|color|padding|font-family|font-size|font-weight|text-transform|letter-spacing)\s*:/i;
const CLASS_ATTR_DOUBLE_RE = /class\s*=\s*"([^"]*)"/gi;
const CLASS_ATTR_SINGLE_RE = /class\s*=\s*'([^']*)'/gi;
const CLASS_FACTORY_RE = /\$c\(\s*(['"])(?:button|a)\1\s*,\s*(['"])([^"']*)\2/g;

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function tokenizeClassList(classList) {
  return classList
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function listTrackedHtmlFiles() {
  const output = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.html'));
}

function collectClassRefs(fileContent) {
  const refs = [];
  CLASS_ATTR_DOUBLE_RE.lastIndex = 0;
  CLASS_ATTR_SINGLE_RE.lastIndex = 0;
  CLASS_FACTORY_RE.lastIndex = 0;

  let match = null;
  while ((match = CLASS_ATTR_DOUBLE_RE.exec(fileContent)) !== null) {
    refs.push({ classList: match[1], index: match.index });
  }
  while ((match = CLASS_ATTR_SINGLE_RE.exec(fileContent)) !== null) {
    refs.push({ classList: match[1], index: match.index });
  }
  while ((match = CLASS_FACTORY_RE.exec(fileContent)) !== null) {
    refs.push({ classList: match[3], index: match.index });
  }
  return refs;
}

function validateClassCoverage(filePath, fileContent, failures) {
  const refs = collectClassRefs(fileContent);
  for (const ref of refs) {
    const tokens = tokenizeClassList(ref.classList);
    if (tokens.length === 0) continue;

    const hasPrimaryAlias = tokens.some((token) => PRIMARY_ALIASES.has(token));
    const hasSecondaryAlias = tokens.some((token) => SECONDARY_ALIASES.has(token));
    if (!hasPrimaryAlias && !hasSecondaryAlias) continue;

    const hasBase = tokens.includes('dx-button-element');
    const hasPrimaryVariant = tokens.includes('dx-button-element--primary');
    const hasSecondaryVariant = tokens.includes('dx-button-element--secondary');
    const hasSize = tokens.includes('dx-button-size--md') || tokens.includes('dx-button-size--sm');

    const missing = [];
    if (!hasBase) missing.push('dx-button-element');
    if (hasPrimaryAlias && !hasPrimaryVariant && !hasSecondaryVariant) missing.push('dx-button-element--primary|dx-button-element--secondary');
    if (hasSecondaryAlias && !hasSecondaryVariant && !hasPrimaryVariant) missing.push('dx-button-element--secondary|dx-button-element--primary');
    const hasSizeRequiredAlias = tokens.some((token) => SIZE_REQUIRED_ALIASES.has(token));
    if (hasSizeRequiredAlias && !hasSize) missing.push('dx-button-size--md|dx-button-size--sm');

    if (missing.length > 0) {
      failures.push({
        kind: 'coverage',
        filePath,
        line: lineNumberAt(fileContent, ref.index),
        detail: `class="${ref.classList}" missing ${missing.join(', ')}`,
      });
    }
  }
}

function validateNoLocalSkinOverrides(filePath, fileContent, failures) {
  STYLE_BLOCK_RE.lastIndex = 0;
  let styleBlock = null;
  while ((styleBlock = STYLE_BLOCK_RE.exec(fileContent)) !== null) {
    const styleText = styleBlock[1];
    const styleBlockStart = styleBlock.index + styleBlock[0].indexOf(styleText);
    LEGACY_SELECTOR_RE.lastIndex = 0;
    let selectorMatch = null;
    while ((selectorMatch = LEGACY_SELECTOR_RE.exec(styleText)) !== null) {
      const selectorBody = selectorMatch[2];
      if (!SKIN_PROPERTY_RE.test(selectorBody)) continue;
      failures.push({
        kind: 'skin',
        filePath,
        line: lineNumberAt(fileContent, styleBlockStart + selectorMatch.index),
        detail: `local selector ".${selectorMatch[1]}" redefines primitive-owned skin properties`,
      });
    }
  }
}

async function main() {
  const failures = [];
  const trackedHtmlFiles = listTrackedHtmlFiles();

  for (const relativePath of trackedHtmlFiles) {
    const absolutePath = path.join(ROOT, relativePath);
    const fileContent = await fs.readFile(absolutePath, 'utf8');
    validateNoLocalSkinOverrides(relativePath, fileContent, failures);
  }

  for (const relativePath of TARGETED_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    try {
      const fileContent = await fs.readFile(absolutePath, 'utf8');
      validateClassCoverage(relativePath, fileContent, failures);
    } catch {
      failures.push({
        kind: 'coverage',
        filePath: relativePath,
        line: 1,
        detail: 'targeted file missing',
      });
    }
  }

  if (failures.length > 0) {
    console.error(`verify:buttons failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- [${failure.kind}] ${failure.filePath}:${failure.line} ${failure.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`verify:buttons passed (${trackedHtmlFiles.length} tracked html files, ${TARGETED_FILES.length} targeted files).`);
}

main().catch((error) => {
  console.error(`verify:buttons error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
