#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const BUILD_TARGET = {
  entry: path.join(ROOT, 'scripts', 'src', 'polls.app.entry.mjs'),
  publicOut: path.join(ROOT, 'public', 'assets', 'js', 'polls.app.js'),
  mirrors: [
    path.join(ROOT, 'assets', 'js', 'polls.app.js'),
    path.join(ROOT, 'docs', 'assets', 'js', 'polls.app.js'),
  ],
};

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

async function main() {
  runNodeScript('scripts/render_polls_pages.mjs');

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

  runNodeScript('scripts/inject_header_slot_scripts.mjs');

  console.log(`polls:build wrote ${path.relative(ROOT, BUILD_TARGET.publicOut)}`);
  for (const mirror of BUILD_TARGET.mirrors) {
    console.log(`polls:build wrote ${path.relative(ROOT, mirror)}`);
  }
}

main().catch((error) => {
  console.error(`polls:build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
