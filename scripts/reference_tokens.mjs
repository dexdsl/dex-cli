#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, 'artifacts', 'reference', 'style-inventory.dedup.json');
const OUTPUT_TOKENS_JSON_PATH = path.join(ROOT, 'artifacts', 'reference', 'tokens.candidates.json');
const OUTPUT_CSS_PATH = path.join(ROOT, 'public', 'css', 'tokens.css');
const OUTPUT_DOCS_CSS_PATH = path.join(ROOT, 'docs', 'css', 'tokens.css');
const OUTPUT_LEGACY_CSS_PATH = path.join(ROOT, 'css', 'tokens.css');
const TOKENIZER_PATH = path.join(ROOT, 'scripts', 'tokenize_inventory.mjs');

function ensureExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing input file: ${path.relative(ROOT, filePath)}`);
  }
}

function syncCssTargets(sourcePath, targets) {
  for (const targetPath of targets) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function main() {
  ensureExists(INPUT_PATH);
  fs.mkdirSync(path.dirname(OUTPUT_TOKENS_JSON_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(OUTPUT_CSS_PATH), { recursive: true });

  const args = [
    TOKENIZER_PATH,
    '--in',
    INPUT_PATH,
    '--outTokensJson',
    OUTPUT_TOKENS_JSON_PATH,
    '--outCss',
    OUTPUT_CSS_PATH,
  ];
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return;
  }

  syncCssTargets(OUTPUT_CSS_PATH, [OUTPUT_DOCS_CSS_PATH, OUTPUT_LEGACY_CSS_PATH]);

  console.log(`reference tokens json: ${path.relative(ROOT, OUTPUT_TOKENS_JSON_PATH)}`);
  console.log(`reference tokens css: ${path.relative(ROOT, OUTPUT_CSS_PATH)}`);
}

main();
