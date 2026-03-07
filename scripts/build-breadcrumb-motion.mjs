import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const entry = path.join(PROJECT_ROOT, 'scripts', 'src', 'dex-breadcrumb-motion.entry.mjs');
const outAssets = path.join(PROJECT_ROOT, 'assets', 'js', 'dex-breadcrumb-motion.js');
const outDocs = path.join(PROJECT_ROOT, 'docs', 'assets', 'js', 'dex-breadcrumb-motion.js');

async function bundleTo(outfile) {
  await fs.mkdir(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    outfile,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
  });
}

await bundleTo(outAssets);
await bundleTo(outDocs);

console.log(`built ${path.relative(PROJECT_ROOT, outAssets)}`);
console.log(`built ${path.relative(PROJECT_ROOT, outDocs)}`);
