#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const entry = path.join(ROOT, 'scripts', 'src', 'donate.entry.mjs');
const publicOut = path.join(ROOT, 'public', 'assets', 'js', 'donate.js');
const mirrors = [
  path.join(ROOT, 'assets', 'js', 'donate.js'),
  path.join(ROOT, 'docs', 'assets', 'js', 'donate.js'),
];

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyFile(source, target) {
  await ensureDir(target);
  await fs.copyFile(source, target);
}

async function main() {
  await ensureDir(publicOut);

  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    outfile: publicOut,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
  });

  for (const mirror of mirrors) {
    await copyFile(publicOut, mirror);
  }

  console.log(`donate:build wrote ${path.relative(ROOT, publicOut)}`);
  for (const mirror of mirrors) {
    console.log(`donate:build wrote ${path.relative(ROOT, mirror)}`);
  }
}

main().catch((error) => {
  console.error(`donate:build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
