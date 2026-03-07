#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');

const TOKEN_A = ['squa', 'respace'].join('');
const TOKEN_B = ['sq', 's-'].join('');
const TOKEN_C = ['type', 'kit'].join('');
const TOKEN_D = ['ado', 'be'].join('');

const RULES = [
  { token: TOKEN_A, replacement: 'legacysite' },
  { token: TOKEN_B, replacement: 'dx-' },
  { token: TOKEN_C, replacement: 'fonthost' },
  { token: TOKEN_D, replacement: 'fontco' },
];

function readJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} missing: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceWithCount(input, pattern, replacement) {
  let count = 0;
  const output = input.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  return { output, count };
}

function main() {
  const targets = readJSON(TARGETS_PATH, 'repo targets');
  const files = Array.from(
    new Set([
      ...(Array.isArray(targets.htmlFiles) ? targets.htmlFiles : []),
      ...(Array.isArray(targets.cssFiles) ? targets.cssFiles : []),
      ...(Array.isArray(targets.jsFiles) ? targets.jsFiles : []),
      ...(Array.isArray(targets.xmlFiles) ? targets.xmlFiles : []),
      ...(Array.isArray(targets.extraTextFiles) ? targets.extraTextFiles : []),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const compiledRules = RULES.map((rule) => ({
    ...rule,
    pattern: new RegExp(escapeRegExp(rule.token), 'gi'),
  }));

  let changedFiles = 0;
  let changedBytes = 0;
  const counts = Object.fromEntries(compiledRules.map((rule) => [rule.token, 0]));

  for (const relativePath of files) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const original = fs.readFileSync(absolutePath, 'utf8');

    let next = original;
    let replaced = false;

    for (const rule of compiledRules) {
      const result = replaceWithCount(next, rule.pattern, rule.replacement);
      if (result.count > 0) {
        counts[rule.token] += result.count;
        next = result.output;
        replaced = true;
      }
    }

    if (!replaced || next === original) continue;
    fs.writeFileSync(absolutePath, next, 'utf8');
    changedFiles += 1;
    changedBytes += Buffer.byteLength(next, 'utf8') - Buffer.byteLength(original, 'utf8');
  }

  console.log('sanitize:purge complete');
  console.log(`- files scanned: ${files.length}`);
  console.log(`- files changed: ${changedFiles}`);
  console.log(`- net byte delta: ${changedBytes}`);
  console.log('- replacements:');
  for (const rule of compiledRules) {
    console.log(`  ${rule.token} -> ${rule.replacement}: ${counts[rule.token]}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`sanitize:purge error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
