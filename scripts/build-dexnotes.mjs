#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const PRE_STEPS = ['scripts/build_dexnotes_data.mjs', 'scripts/render_dexnotes_pages.mjs'];

const BUILD_TARGETS = [
  {
    entry: path.join(ROOT, 'scripts', 'src', 'dexnotes.index.entry.mjs'),
    publicOut: path.join(ROOT, 'public', 'assets', 'js', 'dexnotes.index.js'),
    mirrors: [
      path.join(ROOT, 'assets', 'js', 'dexnotes.index.js'),
      path.join(ROOT, 'docs', 'assets', 'js', 'dexnotes.index.js'),
    ],
  },
  {
    entry: path.join(ROOT, 'scripts', 'src', 'dexnotes.entry.entry.mjs'),
    publicOut: path.join(ROOT, 'public', 'assets', 'js', 'dexnotes.entry.js'),
    mirrors: [
      path.join(ROOT, 'assets', 'js', 'dexnotes.entry.js'),
      path.join(ROOT, 'docs', 'assets', 'js', 'dexnotes.entry.js'),
    ],
  },
];

const POST_STEPS = ['scripts/build_dexnotes_feed.mjs', 'scripts/inject_header_slot_scripts.mjs'];

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

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyFile(source, target) {
  await ensureDir(target);
  await fs.copyFile(source, target);
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

  console.log(`dexnotes:build wrote ${path.relative(ROOT, target.publicOut)}`);
  for (const mirror of target.mirrors) {
    console.log(`dexnotes:build wrote ${path.relative(ROOT, mirror)}`);
  }
}

async function main() {
  for (const step of PRE_STEPS) {
    runNodeScript(step);
  }

  for (const target of BUILD_TARGETS) {
    await buildOne(target);
  }

  for (const step of POST_STEPS) {
    runNodeScript(step);
  }
}

main().catch((error) => {
  console.error(`dexnotes:build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
