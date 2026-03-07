#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'sanitize.config.json');
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const MAX_FINDINGS_PER_TERM = 3;
const MAX_TOTAL_FINDINGS = 1000;
const FORBIDDEN_DOMAIN_ALLOWLIST_KEY = 'forbiddenDomainAllowlistFiles';

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
}

function normalizePathList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, ''))
    .filter(Boolean);
}

function buildSnippet(content, start, length) {
  const left = Math.max(0, start - 50);
  const right = Math.min(content.length, start + length + 50);
  return content
    .slice(left, right)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function findAll(haystackLower, needleLower) {
  const indexes = [];
  let cursor = 0;
  while (cursor <= haystackLower.length) {
    const index = haystackLower.indexOf(needleLower, cursor);
    if (index === -1) break;
    indexes.push(index);
    if (indexes.length >= MAX_FINDINGS_PER_TERM) break;
    cursor = index + Math.max(needleLower.length, 1);
  }
  return indexes;
}

function scanFile(relativePath, forbiddenNeedles, forbiddenDomains) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const content = fs.readFileSync(absolutePath, 'utf8');
  const contentLower = content.toLowerCase();
  const findings = [];

  for (const needle of forbiddenNeedles) {
    if (findings.length >= MAX_TOTAL_FINDINGS) break;
    const positions = findAll(contentLower, needle);
    for (const index of positions) {
      if (findings.length >= MAX_TOTAL_FINDINGS) break;
      findings.push({
        file: relativePath,
        kind: 'needle',
        match: needle,
        snippet: buildSnippet(content, index, needle.length),
      });
    }
  }

  for (const domain of forbiddenDomains) {
    if (findings.length >= MAX_TOTAL_FINDINGS) break;
    const positions = findAll(contentLower, domain);
    for (const index of positions) {
      if (findings.length >= MAX_TOTAL_FINDINGS) break;
      findings.push({
        file: relativePath,
        kind: 'domain',
        match: domain,
        snippet: buildSnippet(content, index, domain.length),
      });
    }
  }

  return findings;
}

function main() {
  const config = loadJSON(CONFIG_PATH, 'sanitize.config.json');
  const targets = loadJSON(TARGETS_PATH, 'artifacts/repo-targets.json');

  const forbiddenNeedles = normalizeList(config.forbiddenNeedles);
  const forbiddenDomains = normalizeList(config.forbiddenDomains);
  const allowlistedFiles = new Set(normalizePathList(config[FORBIDDEN_DOMAIN_ALLOWLIST_KEY]));
  if (forbiddenNeedles.length === 0 || forbiddenDomains.length === 0) {
    throw new Error('forbiddenNeedles and forbiddenDomains must both be configured in sanitize.config.json.');
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
  for (const filePath of files) {
    if (allowlistedFiles.has(filePath)) continue;
    if (findings.length >= MAX_TOTAL_FINDINGS) break;
    findings.push(...scanFile(filePath, forbiddenNeedles, forbiddenDomains));
  }

  if (findings.length > 0) {
    findings.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.match.localeCompare(b.match);
    });
    console.error(`sanitize:scan failed. Findings: ${findings.length}`);
    if (findings.length >= MAX_TOTAL_FINDINGS) {
      console.error(`(output truncated to first ${MAX_TOTAL_FINDINGS} findings)`);
    }
    for (const finding of findings) {
      console.error(`- ${finding.file} [${finding.kind}] ${finding.match}`);
      console.error(`  ${finding.snippet}`);
    }
    process.exit(1);
  }

  console.log(`sanitize:scan passed (${files.length} files scanned).`);
}

try {
  main();
} catch (error) {
  console.error(`sanitize:scan error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
