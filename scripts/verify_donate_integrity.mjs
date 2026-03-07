#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const RUNTIME_SOURCE_PATH = path.join(ROOT, 'scripts', 'src', 'donate.entry.mjs');
const BUNDLE_PATH = path.join(ROOT, 'public', 'assets', 'js', 'donate.js');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'components', 'dx-donate.css');
const PAGE_PATH = path.join(ROOT, 'docs', 'donate', 'index.html');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertIncludes(label, source, markers, failures) {
  markers.forEach((marker) => {
    if (!source.includes(marker)) {
      failures.push(`${label} missing marker: ${marker}`);
    }
  });
}

function assertExcludes(label, source, markers, failures) {
  markers.forEach((marker) => {
    if (source.includes(marker)) {
      failures.push(`${label} contains forbidden marker: ${marker}`);
    }
  });
}

function main() {
  const failures = [];

  const runtimeSource = readText(RUNTIME_SOURCE_PATH);
  const bundle = readText(BUNDLE_PATH);
  const css = readText(CSS_PATH);
  const page = readText(PAGE_PATH);

  assertIncludes('donate runtime source', runtimeSource, [
    '/donations/checkout-session',
    'x-dx-idempotency-key',
    'challengeToken',
    'submittedAt',
    'honey',
    '/entry/settings?via=donate#membership',
  ], failures);

  assertIncludes('donate bundle', bundle, [
    '/donations/checkout-session',
    'x-dx-idempotency-key',
  ], failures);

  assertIncludes('donate css', css, [
    '.dx-donate-shell',
    '.dx-donate-card',
    '.dx-donate-honey-wrap',
  ], failures);

  assertIncludes('donate page', page, [
    'data-dx-donate-app',
    '/css/components/dx-donate.css',
    '/assets/js/donate.js',
    '/assets/dex-runtime-config.js',
    'window.DEX_DONATE_CONFIG',
    'challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  ], failures);

  assertExcludes('donate page', page, [
    'website.components.donation',
    'data-definition-name="website.components.donation"',
    'dx-donation-block-container',
    'patreon.com/dexdsl',
    "Y.use('website.components.donation'",
  ], failures);

  if (failures.length) {
    console.error(`verify:donate failed with ${failures.length} issue(s):`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log('verify:donate passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:donate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
