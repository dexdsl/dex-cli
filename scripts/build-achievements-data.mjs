#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE = path.join(ROOT, 'data', 'achievements.registry.json');
const OUTPUT = path.join(ROOT, 'public', 'data', 'achievements.data.json');

const GROWLIX_MARKERS = ['!!!', '???', '***', '@@@'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toText(value) {
  return String(value ?? '').trim();
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function validateCatalog(input) {
  assert(input && typeof input === 'object', 'catalog root must be an object');
  const catalogVersion = toText(input.catalogVersion);
  assert(catalogVersion, 'catalogVersion is required');
  const updatedAt = toText(input.updatedAt);
  assert(updatedAt, 'updatedAt is required');
  const sequenceGroup = toText(input.sequenceGroup) || 'dex-achievements';
  const rows = Array.isArray(input.achievements) ? input.achievements : [];
  assert(rows.length > 0, 'achievements must be a non-empty array');

  const ids = new Set();
  const achievements = rows.map((row, index) => {
    assert(row && typeof row === 'object', `achievements[${index}] must be an object`);
    const id = toText(row.id).toLowerCase();
    assert(id, `achievements[${index}].id is required`);
    assert(!ids.has(id), `duplicate achievement id: ${id}`);
    ids.add(id);

    const title = toText(row.title);
    const category = toText(row.category).toLowerCase();
    const tier = toText(row.tier).toLowerCase();
    const glyph = toText(row.glyph).toLowerCase();
    const metricKey = toText(row.metricKey);
    const threshold = Number(row.threshold);
    const secret = Boolean(row.secret);
    const clueGrowlix = toText(row.clueGrowlix);
    const description = toText(row.description);
    const sortOrder = Number.isFinite(Number(row.sortOrder)) ? Math.floor(Number(row.sortOrder)) : (index + 1) * 10;
    const points = Number.isFinite(Number(row.points)) ? Math.max(0, Math.floor(Number(row.points))) : 0;

    assert(title, `${id}: title is required`);
    assert(category, `${id}: category is required`);
    assert(tier, `${id}: tier is required`);
    assert(glyph, `${id}: glyph is required`);
    assert(metricKey, `${id}: metricKey is required`);
    assert(Number.isFinite(threshold) && threshold >= 1, `${id}: threshold must be >= 1`);
    assert(description, `${id}: description is required`);

    if (secret) {
      assert(
        GROWLIX_MARKERS.some((marker) => clueGrowlix.includes(marker)),
        `${id}: secret clueGrowlix must include one of ${GROWLIX_MARKERS.join(', ')}`,
      );
    }

    return {
      id,
      title,
      category,
      tier,
      glyph,
      metricKey,
      threshold,
      secret,
      clueGrowlix,
      description,
      sortOrder,
      points,
    };
  });

  achievements.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  return {
    catalogVersion,
    updatedAt,
    sequenceGroup,
    achievements,
  };
}

async function main() {
  const raw = await fs.readFile(SOURCE, 'utf8');
  const parsed = JSON.parse(raw);
  const output = validateCatalog(parsed);
  await ensureDir(OUTPUT);
  await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`achievements:data wrote ${path.relative(ROOT, OUTPUT)}`);
}

main().catch((error) => {
  console.error(`build-achievements-data failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
