#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const README_REL = 'README.md';
const FAILURES = [];

function readText(relPath) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    FAILURES.push(`Missing required file: ${relPath}`);
    return '';
  }
  return fs.readFileSync(absPath, 'utf8');
}

function assertIncludes(relPath, text, markers, label) {
  for (const marker of markers) {
    if (!text.includes(marker)) {
      FAILURES.push(`${relPath} missing ${label}: ${marker}`);
    }
  }
}

function assertRegex(relPath, text, checks, label) {
  for (const check of checks) {
    if (!check.regex.test(text)) {
      FAILURES.push(`${relPath} missing ${label}: ${check.name}`);
    }
  }
}

function verifyManualStructure(readmeText) {
  assertIncludes(README_REL, readmeText, [
    '# Dex Operations Manual',
    '## Workspace Bootstrap (site + api repos)',
    '## Command Taxonomy',
    '## CLI Command Reference',
    '## TUI Command Centers + Keybindings',
    '## Canonical Production Workflows',
    '## Security + Secrets + Ownership',
    '## Troubleshooting Playbooks',
    '## Verification and CI Gates',
    '## Appendix: Command Equivalents (TUI <-> CLI)',
    '## How to update this manual safely',
  ], 'section heading');
}

function verifyCommandCoverage(readmeText) {
  assertRegex(README_REL, readmeText, [
    { name: 'dex setup', regex: /\bdex setup\b/i },
    { name: 'dex init', regex: /\bdex init\b/i },
    { name: 'dex update', regex: /\bdex update\b/i },
    { name: 'dex doctor', regex: /\bdex doctor\b/i },
    { name: 'dex entry audit', regex: /\bdex entry audit\b/i },
    { name: 'dex entry link', regex: /\bdex entry link\b/i },
    { name: 'dex catalog', regex: /\bdex catalog\b/i },
    { name: 'dex home', regex: /\bdex home\b/i },
    { name: 'dex notes', regex: /\bdex notes\b/i },
    { name: 'dex polls', regex: /\bdex polls\b/i },
    { name: 'dex newsletter', regex: /\bdex newsletter\b/i },
    { name: 'dex assets', regex: /\bdex assets\b/i },
    { name: 'dex release preflight', regex: /\bdex release preflight\b/i },
    { name: 'dex release publish', regex: /\bdex release publish\b/i },
    { name: 'dex deploy', regex: /\bdex deploy\b/i },
    { name: 'dex view', regex: /\bdex view\b/i },
    { name: 'dex status', regex: /\bdex status\b/i },
  ], 'command marker');
}

function verifyKeybindingCoverage(readmeText) {
  assertIncludes(README_REL, readmeText, [
    '### Dashboard',
    '### Init wizard',
    '### Update wizard',
    '### Doctor',
    '### Entry Audit',
    '### Catalog Manager',
    '### Home Featured Manager',
    '### Protected Assets Manager',
    '### Polls Manager',
    '### Newsletter Manager',
    '### Dex Notes Manager',
    '### Status Manager',
    'Ctrl+Q',
    'Esc',
    'Up/Down',
    'Enter',
  ], 'keybinding marker');
}

function verifyWorkflowCoverage(readmeText) {
  assertIncludes(README_REL, readmeText, [
    '### Workflow 1: Create and validate a new entry',
    '### Workflow 2: Validate assets + catalog/home curation',
    '### Workflow 3: Preflight and publish (test then prod)',
    '### Workflow 4: Notes editorial ship',
    'Stop condition',
  ], 'workflow marker');
}

function verifySecretsCoverage(readmeText) {
  assertIncludes(README_REL, readmeText, [
    'DEX_ASSETS_ADMIN_TOKEN_TEST',
    'DEX_ASSETS_ADMIN_TOKEN_PROD',
    'DEX_CATALOG_ADMIN_TOKEN_TEST',
    'DEX_CATALOG_ADMIN_TOKEN_PROD',
    'dex-api',
    'dexdsl.github.io',
  ], 'secrets marker');
  assertRegex(README_REL, readmeText, [
    { name: 'never commit secrets policy', regex: /never commit secrets/i },
  ], 'secrets marker');
}

function main() {
  const readmeText = readText(README_REL);
  verifyManualStructure(readmeText);
  verifyCommandCoverage(readmeText);
  verifyKeybindingCoverage(readmeText);
  verifyWorkflowCoverage(readmeText);
  verifySecretsCoverage(readmeText);

  if (FAILURES.length > 0) {
    console.error(`verify:dex-manual failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:dex-manual passed.');
}

main();
