#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const BUILD_TARGET = {
  entry: path.join(ROOT, 'scripts', 'src', 'submit.samples.entry.mjs'),
  publicOut: path.join(ROOT, 'public', 'assets', 'js', 'submit.samples.js'),
  mirrors: [
    path.join(ROOT, 'assets', 'js', 'submit.samples.js'),
    path.join(ROOT, 'docs', 'assets', 'js', 'submit.samples.js'),
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

  console.log(`submit:build wrote ${path.relative(ROOT, BUILD_TARGET.publicOut)}`);
  for (const mirror of BUILD_TARGET.mirrors) {
    console.log(`submit:build wrote ${path.relative(ROOT, mirror)}`);
  }
}

main().catch((error) => {
  console.error(`submit:build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
