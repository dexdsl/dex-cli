#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'sanitize.config.json');
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const MAX_FINDINGS_PER_DOMAIN = 20;
const MAX_FINDINGS_TOTAL = 500;
const FORBIDDEN_DOMAIN_ALLOWLIST_KEY = 'forbiddenDomainAllowlistFiles';

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeDomains(list) {
  if (!Array.isArray(list)) return [];
  return list.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
}

function normalizePathList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, ''))
    .filter(Boolean);
}

function contextSnippet(content, start, length) {
  const left = Math.max(0, start - 50);
  const right = Math.min(content.length, start + length + 50);
  return content.slice(left, right).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function findIndexes(haystackLower, needleLower) {
  const indexes = [];
  let cursor = 0;
  while (cursor <= haystackLower.length) {
    const index = haystackLower.indexOf(needleLower, cursor);
    if (index === -1) break;
    indexes.push(index);
    if (indexes.length >= MAX_FINDINGS_PER_DOMAIN) break;
    cursor = index + Math.max(needleLower.length, 1);
  }
  return indexes;
}

function main() {
  const config = loadJSON(CONFIG_PATH, 'sanitize.config.json');
  const targets = loadJSON(TARGETS_PATH, 'artifacts/repo-targets.json');
  const forbiddenDomains = normalizeDomains(config.forbiddenDomains);
  const allowlistedFiles = new Set(normalizePathList(config[FORBIDDEN_DOMAIN_ALLOWLIST_KEY]));
  if (forbiddenDomains.length === 0) {
    throw new Error('forbiddenDomains is empty in sanitize.config.json.');
  }

  const files = Array.from(
    new Set([
      ...(Array.isArray(targets.htmlFiles) ? targets.htmlFiles : []),
      ...(Array.isArray(targets.cssFiles) ? targets.cssFiles : []),
      ...(Array.isArray(targets.jsFiles) ? targets.jsFiles : []),
      ...(Array.isArray(targets.xmlFiles) ? targets.xmlFiles : []),
      ...(Array.isArray(targets.extraTextFiles) ? targets.extraTextFiles : []),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const findings = [];
  for (const relativePath of files) {
    if (allowlistedFiles.has(relativePath)) continue;
    if (findings.length >= MAX_FINDINGS_TOTAL) break;
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');
    const lower = content.toLowerCase();
    for (const domain of forbiddenDomains) {
      if (findings.length >= MAX_FINDINGS_TOTAL) break;
      const indexes = findIndexes(lower, domain);
      for (const start of indexes) {
        if (findings.length >= MAX_FINDINGS_TOTAL) break;
        findings.push({
          file: relativePath,
          domain,
          snippet: contextSnippet(content, start, domain.length),
        });
      }
    }
  }

  if (findings.length > 0) {
    findings.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.domain.localeCompare(b.domain);
    });
    console.error(`verify:no-forbidden-domains failed. Findings: ${findings.length}`);
    if (findings.length >= MAX_FINDINGS_TOTAL) {
      console.error(`(output truncated to first ${MAX_FINDINGS_TOTAL} findings)`);
    }
    for (const finding of findings) {
      console.error(`- ${finding.file} :: ${finding.domain}`);
      console.error(`  ${finding.snippet}`);
    }
    process.exit(1);
  }

  console.log(`verify:no-forbidden-domains passed (${files.length} files scanned).`);
}

try {
  main();
} catch (error) {
  console.error(`verify:no-forbidden-domains error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
