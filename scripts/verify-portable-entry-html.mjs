import fs from 'node:fs/promises';
import path from 'node:path';

const ENTRIES_DIR = path.resolve('entries');
const ATTR_RX = /\b(src|href)\s*=\s*(["'])([^"']*)\2/gi;
const LOCAL_ASSET_RX = /^(?:\/(?:assets|scripts)\/|(?:assets|scripts)\/)/;

async function walk(dir, out = []) {
  const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      await walk(fullPath, out);
      continue;
    }
    if (dirent.isFile() && dirent.name === 'index.html') out.push(fullPath);
  }
  return out;
}

function lineFromIndex(source, index) {
  return source.slice(0, index).split('\n').length;
}

async function main() {
  const files = await walk(ENTRIES_DIR);
  if (!files.length) {
    console.log('No entries/**/index.html files found.');
    return;
  }

  const violations = [];
  for (const file of files) {
    const html = await fs.readFile(file, 'utf8');
    ATTR_RX.lastIndex = 0;
    for (const match of html.matchAll(ATTR_RX)) {
      const attr = String(match[1] || '');
      const value = String(match[3] || '').trim();
      if (!LOCAL_ASSET_RX.test(value)) continue;
      const line = lineFromIndex(html, match.index || 0);
      violations.push({ file, line, attr, value });
    }
  }

  if (violations.length) {
    console.error('Found non-portable local asset links in entry HTML:');
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line} ${v.attr}="${v.value}"`);
    }
    process.exit(1);
  }

  console.log(`Portable entry HTML check passed for ${files.length} file(s).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
