#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REFERENCE_PATH = path.join(ROOT, 'scripts', 'fixtures', 'entry-reference', 'index.html');
const TEMPLATE_PATH = path.join(ROOT, 'entry-template', 'index.html');
const TEST9_PATH = path.join(ROOT, 'entries', 'test-9', 'index.html');

const ANCHORS = [
  ['DEX:SIDEBAR_PAGE_CONFIG_START', 'DEX:SIDEBAR_PAGE_CONFIG_END'],
  ['DEX:TITLE_START', 'DEX:TITLE_END'],
  ['DEX:VIDEO_START', 'DEX:VIDEO_END'],
  ['DEX:DESC_START', 'DEX:DESC_END'],
];

const REQUIRED_CONTRACT_SCRIPT_IDS = [
  'dex-sidebar-config',
  'dex-sidebar-page-config',
  'dex-sidebar-page-config-bridge',
  'dex-manifest',
];

const REQUIRED_LINK_SIGNATURES = [
  /static1\.squarespace\.com\/static\/versioned-site-css/i,
  /assets\.squarespace\.com\/universal\/styles-compressed\/user-account-core/i,
  /images\.squarespace-cdn\.com/i,
  /use\.typekit\.net/i,
  /p\.typekit\.net/i,
  /dexdsl\.github\.io\/assets\/css\/dex\.css/i,
];

const REQUIRED_SCRIPT_SIGNATURES = [
  /zeffy-scripts\.s3\.ca-central-1\.amazonaws\.com\/embed-form-script\.min\.js/i,
  /ajax\.googleapis\.com\/ajax\/libs\/jquery\/3\.6\.0\/jquery\.min\.js/i,
  /app\.sparkplugin\.com\/app\.js/i,
  /googletagmanager\.com\/gtag\/js/i,
  /dexdsl\.github\.io\/assets\/dex-auth0-config\.js/i,
  /(?:dexdsl\.github\.io)?\/assets\/vendor\/auth0-spa-js\.umd\.min\.js/i,
  /dexdsl\.github\.io\/assets\/dex-auth\.js/i,
  /dexdsl\.github\.io\/assets\/js\/dex-breadcrumb-motion\.js/i,
  /dexdsl\.github\.io\/assets\/dex-sidebar\.js/i,
];

const REQUIRED_SQS_SIGNATURES = [
  /sqs-announcement-bar-dropzone/i,
  /sqs-block/i,
  /sqs-code-container/i,
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function countScriptById(html, id) {
  const rx = new RegExp(`<script[^>]*id=["']${id}["']`, 'gi');
  return (html.match(rx) || []).length;
}

function verifyAnchors(html, label, failures) {
  for (const [start, end] of ANCHORS) {
    if (!html.includes(`<!-- ${start} -->`) || !html.includes(`<!-- ${end} -->`)) {
      failures.push(`${label}: missing anchor pair ${start}/${end}`);
    }
  }
}

function verifyContractScripts(html, label, failures) {
  for (const id of REQUIRED_CONTRACT_SCRIPT_IDS) {
    const count = countScriptById(html, id);
    if (count !== 1) {
      failures.push(`${label}: expected 1 script#${id}, found ${count}`);
    }
  }
}

function verifySignatures(html, label, signatures, kind, failures) {
  for (const signature of signatures) {
    if (!signature.test(html)) {
      failures.push(`${label}: missing ${kind} signature ${signature}`);
    }
  }
}

function main() {
  const failures = [];

  const referenceHtml = readText(REFERENCE_PATH);
  const templateHtml = readText(TEMPLATE_PATH);
  const test9Html = readText(TEST9_PATH);

  const files = [
    ['reference fixture', referenceHtml],
    ['entry template', templateHtml],
    ['entries/test-9', test9Html],
  ];

  for (const [label, html] of files) {
    verifyAnchors(html, label, failures);
    verifyContractScripts(html, label, failures);
    verifySignatures(html, label, REQUIRED_SQS_SIGNATURES, 'sqs', failures);
  }

  // Require the same core runtime/link families on template + test-9.
  verifySignatures(templateHtml, 'entry template', REQUIRED_LINK_SIGNATURES, 'link', failures);
  verifySignatures(templateHtml, 'entry template', REQUIRED_SCRIPT_SIGNATURES, 'script', failures);
  verifySignatures(test9Html, 'entries/test-9', REQUIRED_LINK_SIGNATURES, 'link', failures);
  verifySignatures(test9Html, 'entries/test-9', REQUIRED_SCRIPT_SIGNATURES, 'script', failures);

  // Ensure the reference fixture itself still carries the expected signatures.
  verifySignatures(referenceHtml, 'reference fixture', REQUIRED_LINK_SIGNATURES, 'link', failures);
  verifySignatures(referenceHtml, 'reference fixture', REQUIRED_SCRIPT_SIGNATURES, 'script', failures);

  if (failures.length > 0) {
    console.error(`verify_entry_reference_parity failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify_entry_reference_parity passed.');
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
