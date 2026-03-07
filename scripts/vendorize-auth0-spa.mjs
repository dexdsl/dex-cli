#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'node_modules', '@auth0', 'auth0-spa-js', 'dist', 'auth0-spa-js.production.js');
const DEST_PUBLIC = path.join(ROOT, 'public', 'assets', 'vendor', 'auth0-spa-js.umd.min.js');
const MIRRORS = [
  path.join(ROOT, 'assets', 'vendor', 'auth0-spa-js.umd.min.js'),
  path.join(ROOT, 'docs', 'assets', 'vendor', 'auth0-spa-js.umd.min.js'),
];

async function ensureSource(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size <= 0) {
      throw new Error('not a non-empty file');
    }
  } catch {
    throw new Error(`Missing source bundle: ${path.relative(ROOT, filePath)}`);
  }
}

async function copyTo(source, destination, bytes) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  console.log(`copied ${bytes} bytes -> ${path.relative(ROOT, destination)}`);
}

async function main() {
  await ensureSource(SOURCE);
  const sourceStats = await fs.stat(SOURCE);
  const bytes = sourceStats.size;

  await copyTo(SOURCE, DEST_PUBLIC, bytes);
  for (const destination of MIRRORS) {
    await copyTo(SOURCE, destination, bytes);
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
