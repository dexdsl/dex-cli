#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const BUILD_TARGET = {
  entry: path.join(ROOT, 'scripts', 'src', 'support.status.entry.mjs'),
  publicOut: path.join(ROOT, 'public', 'assets', 'js', 'support-status.js'),
  mirrors: [
    path.join(ROOT, 'assets', 'js', 'support-status.js'),
    path.join(ROOT, 'docs', 'assets', 'js', 'support-status.js'),
  ],
};

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyFile(source, target) {
  await ensureDir(target);
  await fs.copyFile(source, target);
}

async function main() {
  await ensureDir(BUILD_TARGET.publicOut);
  await build({
    entryPoints: [BUILD_TARGET.entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    outfile: BUILD_TARGET.publicOut,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
  });

  for (const mirror of BUILD_TARGET.mirrors) {
    await copyFile(BUILD_TARGET.publicOut, mirror);
  }

  console.log(`support-status:build wrote ${path.relative(ROOT, BUILD_TARGET.publicOut)}`);
  for (const mirror of BUILD_TARGET.mirrors) {
    console.log(`support-status:build wrote ${path.relative(ROOT, mirror)}`);
  }
}

main().catch((error) => {
  console.error(`support-status:build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
