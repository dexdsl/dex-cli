import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  DEXNOTES_CONTENT_DIR,
  REQUIRED_FRONTMATTER_KEYS,
  listMarkdownPostFiles,
  parseMdWithJsonFrontmatter,
  toText,
} from './dexnotes-pipeline.mjs';

function parseArgs(rest = []) {
  const [subcommand = '', ...rawArgs] = rest;
  const flags = new Map();
  const values = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index += 1;
        continue;
      }
      flags.set(name, 'true');
      continue;
    }
    values.push(arg);
  }
  return { subcommand, flags, values };
}

function printUsage() {
  console.log('Usage: dex notes <list|add|edit|set|build|validate|publish> [args]');
  console.log('  dex notes list');
  console.log('  dex notes add [--title ... --slug ...]');
  console.log('  dex notes edit --slug <slug>');
  console.log('  dex notes set --slug <slug> --field <frontmatter-key> --value <value> [--json]');
  console.log('  dex notes build');
  console.log('  dex notes validate');
  console.log('  dex notes publish');
}

function findPostPathBySlug(slug) {
  const needle = toText(slug).trim();
  if (!needle) throw new Error('notes requires --slug <slug>');
  const filePath = path.join(DEXNOTES_CONTENT_DIR, `${needle}.md`);
  if (fs.existsSync(filePath)) return filePath;

  const files = listMarkdownPostFiles();
  for (const candidate of files) {
    const parsed = parseMdWithJsonFrontmatter(candidate);
    if (toText(parsed?.frontmatter?.slug).trim() === needle) return candidate;
  }

  throw new Error(`dex notes post not found for slug: ${needle}`);
}

function runScript(relativePath, args = [], { inherit = true } = {}) {
  const scriptPath = path.join(process.cwd(), relativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    stdio: inherit ? 'inherit' : 'pipe',
  });

  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr) : '';
    const stdout = result.stdout ? String(result.stdout) : '';
    throw new Error(`Command failed (${relativePath})\n${stdout}${stderr}`.trim());
  }

  return result;
}

function openInEditor(filePath) {
  // Prefer VISUAL / $EDITOR for full markdown-body edits.
  const editor = toText(process.env.VISUAL || process.env.EDITOR || 'vi');
  const result = spawnSync(editor, [filePath], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to launch editor: ${editor}`);
  }
}

function writeMarkdownWithFrontmatter(filePath, frontmatter, body) {
  const next = `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${String(body || '')}`;
  fs.writeFileSync(filePath, next, 'utf8');
}

function parseValue(raw, asJson) {
  const source = String(raw ?? '');
  if (!asJson) return source;
  return JSON.parse(source);
}

function normalizeAllowedSet(frontmatter = {}) {
  const keys = new Set([...REQUIRED_FRONTMATTER_KEYS, ...Object.keys(frontmatter || {})]);
  keys.add('updated_at_iso');
  keys.add('source_file_raw');
  return keys;
}

export async function runDexNotesCommand(rest = []) {
  const { subcommand, flags, values } = parseArgs(rest);
  if (!subcommand) {
    printUsage();
    return;
  }

  if (subcommand === 'list') {
    const files = listMarkdownPostFiles();
    if (!files.length) {
      console.log('notes:list no markdown posts found.');
      return;
    }
    for (const filePath of files) {
      const parsed = parseMdWithJsonFrontmatter(filePath);
      const slug = toText(parsed?.frontmatter?.slug).trim();
      const title = toText(parsed?.frontmatter?.title_raw).trim();
      const published = toText(parsed?.frontmatter?.published_at_iso).trim();
      console.log(`${slug}\t${published}\t${title}`);
    }
    return;
  }

  if (subcommand === 'add') {
    const passThroughArgs = [];
    for (const [key, value] of flags.entries()) {
      passThroughArgs.push(key);
      if (value !== 'true') passThroughArgs.push(value);
    }
    runScript('scripts/dexnotes_new.mjs', passThroughArgs, { inherit: true });
    return;
  }

  if (subcommand === 'edit') {
    const slug = flags.get('--slug') || values[0] || '';
    const filePath = findPostPathBySlug(slug);
    openInEditor(filePath);
    const parsed = parseMdWithJsonFrontmatter(filePath);
    parsed.frontmatter.updated_at_iso = new Date().toISOString();
    writeMarkdownWithFrontmatter(filePath, parsed.frontmatter, parsed.body);
    console.log(`notes:edit wrote ${path.relative(process.cwd(), filePath)}`);
    return;
  }

  if (subcommand === 'set') {
    const slug = flags.get('--slug') || values[0] || '';
    const field = toText(flags.get('--field') || values[1]).trim();
    const valueRaw = flags.get('--value') || values[2];
    if (!field) throw new Error('notes:set requires --field <frontmatter-key>');
    if (valueRaw === undefined) throw new Error('notes:set requires --value <value>');

    const filePath = findPostPathBySlug(slug);
    const parsed = parseMdWithJsonFrontmatter(filePath);
    const allowed = normalizeAllowedSet(parsed.frontmatter);
    if (!allowed.has(field)) {
      throw new Error(`notes:set unknown or disallowed field: ${field}`);
    }

    parsed.frontmatter[field] = parseValue(valueRaw, flags.has('--json'));
    parsed.frontmatter.updated_at_iso = new Date().toISOString();
    writeMarkdownWithFrontmatter(filePath, parsed.frontmatter, parsed.body);
    console.log(`notes:set wrote ${path.relative(process.cwd(), filePath)} field=${field}`);
    return;
  }

  if (subcommand === 'build') {
    runScript('scripts/build-dexnotes.mjs', [], { inherit: true });
    return;
  }

  if (subcommand === 'validate') {
    runScript('scripts/verify_dexnotes_integrity.mjs', [], { inherit: true });
    return;
  }

  if (subcommand === 'publish') {
    runScript('scripts/build-dexnotes.mjs', [], { inherit: true });
    runScript('scripts/sync_runtime_css.mjs', [], { inherit: true });
    runScript('scripts/verify_dexnotes_integrity.mjs', [], { inherit: true });
    console.log('notes:publish complete (build + sync + verify).');
    return;
  }

  throw new Error(`Unknown notes command: ${subcommand}`);
}

export function printDexNotesUsage() {
  printUsage();
}
