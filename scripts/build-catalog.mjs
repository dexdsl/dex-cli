#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const BUILD_TARGETS = [
  {
    entry: path.join(ROOT, 'scripts', 'src', 'catalog.index.entry.mjs'),
    publicOut: path.join(ROOT, 'public', 'assets', 'js', 'catalog.index.js'),
    mirrors: [
      path.join(ROOT, 'assets', 'js', 'catalog.index.js'),
      path.join(ROOT, 'docs', 'assets', 'js', 'catalog.index.js'),
    ],
  },
  {
    entry: path.join(ROOT, 'scripts', 'src', 'catalog.how.entry.mjs'),
    publicOut: path.join(ROOT, 'public', 'assets', 'js', 'catalog.how.js'),
    mirrors: [
      path.join(ROOT, 'assets', 'js', 'catalog.how.js'),
      path.join(ROOT, 'docs', 'assets', 'js', 'catalog.how.js'),
    ],
  },
  {
    entry: path.join(ROOT, 'scripts', 'src', 'catalog.symbols.entry.mjs'),
    publicOut: path.join(ROOT, 'public', 'assets', 'js', 'catalog.symbols.js'),
    mirrors: [
      path.join(ROOT, 'assets', 'js', 'catalog.symbols.js'),
      path.join(ROOT, 'docs', 'assets', 'js', 'catalog.symbols.js'),
    ],
  },
];

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyFile(source, target) {
  await ensureDir(target);
  await fs.copyFile(source, target);
}

function runNodeScript(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const result = spawnSync(process.execPath, [absolutePath], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed step: ${relativePath}`);
  }
}

async function buildOne(target) {
  await ensureDir(target.publicOut);

  await build({
    entryPoints: [target.entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    outfile: target.publicOut,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
  });

  for (const mirror of target.mirrors) {
    await copyFile(target.publicOut, mirror);
  }

  console.log(`catalog:build wrote ${path.relative(ROOT, target.publicOut)}`);
  for (const mirror of target.mirrors) {
    console.log(`catalog:build wrote ${path.relative(ROOT, mirror)}`);
  }
}

async function main() {
  for (const target of BUILD_TARGETS) {
    await buildOne(target);
  }
  runNodeScript('scripts/inject_header_slot_scripts.mjs');
}

main().catch((error) => {
  console.error(`catalog:build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
