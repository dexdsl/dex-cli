#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const NEEDLE = '/static/vta/';

function loadTargets() {
  if (!fs.existsSync(TARGETS_PATH)) {
    throw new Error('Missing artifacts/repo-targets.json. Run `npm run repo:discover` first.');
  }
  return JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf8'));
}

function main() {
  const targets = loadTargets();
  const htmlFiles = Array.isArray(targets.htmlFiles) ? targets.htmlFiles : [];
  const findings = [];

  for (const relativePath of htmlFiles) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;

    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(NEEDLE)) continue;
      findings.push({ file: relativePath, line: index + 1 });
    }
  }

  if (findings.length > 0) {
    console.error(`verify:no-dead-static-refs failed. Found ${findings.length} /static/vta/ references:`);
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line}`);
    }
    process.exit(1);
  }

  console.log(`verify:no-dead-static-refs passed (${htmlFiles.length} html files scanned).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:no-dead-static-refs error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
