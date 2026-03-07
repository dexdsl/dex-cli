import fs from 'node:fs/promises';
import path from 'node:path';
import { verifySanitizedHtml } from './lib/sanitize-generated-html.mjs';

const ENTRIES_DIR = path.resolve('entries');

async function walkEntryHtml(dir, out = []) {
  const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      await walkEntryHtml(fullPath, out);
      continue;
    }
    if (dirent.isFile() && dirent.name === 'index.html') out.push(fullPath);
  }
  return out;
}

function toText(value) {
  return String(value || '').trim();
}

async function readRuntimeExemptions() {
  const filePath = path.resolve('data', 'entry-runtime-audit.exemptions.json');
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      skipSlugs: Array.isArray(raw.skipSlugs) ? raw.skipSlugs.map((value) => toText(value)).filter(Boolean) : [],
      skipPrefixes: Array.isArray(raw.skipPrefixes) ? raw.skipPrefixes.map((value) => toText(value)).filter(Boolean) : [],
    };
  } catch {
    return { skipSlugs: [], skipPrefixes: [] };
  }
}

function isExemptFile(filePath, exemptions) {
  const normalized = path.resolve(filePath);
  const marker = `${path.sep}entries${path.sep}`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return false;
  const afterEntries = normalized.slice(markerIndex + marker.length);
  const slug = toText(afterEntries.split(path.sep)[0]);
  if (!slug) return false;
  if ((exemptions.skipSlugs || []).includes(slug)) return true;
  return (exemptions.skipPrefixes || []).some((prefix) => prefix && slug.startsWith(prefix));
}

async function main() {
  const files = await walkEntryHtml(ENTRIES_DIR);
  if (!files.length) {
    console.log('No entries/**/index.html files found.');
    return;
  }

  const exemptions = await readRuntimeExemptions();
  const failures = [];
  let audited = 0;
  let skipped = 0;
  for (const file of files.sort()) {
    if (isExemptFile(file, exemptions)) {
      skipped += 1;
      continue;
    }
    audited += 1;
    const html = await fs.readFile(file, 'utf8');
    const result = verifySanitizedHtml(html);
    if (!result.ok) {
      failures.push({
        file,
        token: result.issues[0]?.token || 'unknown',
      });
    }
  }

  if (!audited) {
    console.error('Sanitized entry HTML verification failed: no non-exempt entries audited.');
    process.exit(1);
  }

  if (failures.length) {
    console.error(`Sanitized entry HTML verification failed (${failures.length}/${audited} file(s), skipped=${skipped}):`);
    for (const failure of failures) {
      console.error(`- ${failure.file} :: ${failure.token}`);
    }
    process.exit(1);
  }

  console.log(`Sanitized entry HTML check passed for ${audited} audited file(s) (skipped=${skipped}).`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
