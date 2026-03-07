#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const vendorPath = path.join(ROOT, 'public', 'assets', 'vendor', 'auth0-spa-js.umd.min.js');

try {
  const stats = fs.statSync(vendorPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error('missing or empty');
  }
  console.log(`verify-auth0-vendor passed: ${path.relative(ROOT, vendorPath)} (${stats.size} bytes)`);
} catch {
  console.error(`verify-auth0-vendor failed: missing vendor bundle at ${path.relative(ROOT, vendorPath)}.`);
  console.error('Fix: npm run vendor:auth0');
  process.exit(1);
}
