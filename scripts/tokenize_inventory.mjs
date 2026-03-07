import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_RAW_PATH = path.join(ROOT, 'artifacts', 'style-inventory.raw.json');
const DEFAULT_DEDUP_PATH = path.join(ROOT, 'artifacts', 'style-inventory.dedup.json');
const DEFAULT_TOKENS_JSON_PATH = path.join(ROOT, 'tokens.candidates.json');
const DEFAULT_TOKENS_ROOT_CSS_PATH = path.join(ROOT, 'tokens.css');
const DEFAULT_TOKENS_CSS_PATH = path.join(ROOT, 'css', 'tokens.css');
const DEFAULT_TOKENS_PUBLIC_CSS_PATH = path.join(ROOT, 'public', 'css', 'tokens.css');
const DEFAULT_TOKENS_DOCS_CSS_PATH = path.join(ROOT, 'docs', 'css', 'tokens.css');

const COLOR_FIELDS = [
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'fill',
  'stroke',
];

const SPACE_FIELDS = [
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gap',
  'rowGap',
  'columnGap',
];

const RADIUS_FIELDS = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
];

const BORDER_WIDTH_FIELDS = [
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
];

const SHADOW_FIELDS = ['boxShadow'];

const TYPO_FIELDS = ['fontSize', 'lineHeight', 'letterSpacing', 'fontWeight', 'fontStyle', 'textTransform'];

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    outTokensJsonPath: DEFAULT_TOKENS_JSON_PATH,
    outCssPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--in' && next) {
      options.inputPath = path.resolve(ROOT, next);
      i += 1;
      continue;
    }
    if (arg.startsWith('--in=')) {
      options.inputPath = path.resolve(ROOT, arg.slice('--in='.length));
      continue;
    }
    if (arg === '--outTokensJson' && next) {
      options.outTokensJsonPath = path.resolve(ROOT, next);
      i += 1;
      continue;
    }
    if (arg.startsWith('--outTokensJson=')) {
      options.outTokensJsonPath = path.resolve(ROOT, arg.slice('--outTokensJson='.length));
      continue;
    }
    if (arg === '--outCss' && next) {
      options.outCssPath = path.resolve(ROOT, next);
      i += 1;
      continue;
    }
    if (arg.startsWith('--outCss=')) {
      options.outCssPath = path.resolve(ROOT, arg.slice('--outCss='.length));
      continue;
    }
  }

  return options;
}

function ensureOutputDirs({ outTokensJsonPath, cssPaths, dedupPath }) {
  fs.mkdirSync(path.dirname(outTokensJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(dedupPath), { recursive: true });
  for (const cssPath of cssPaths) {
    fs.mkdirSync(path.dirname(cssPath), { recursive: true });
  }
}

function deduplicate(raw) {
  const fieldMap = new Map();
  const typographyMap = new Map();

  for (const entry of raw) {
    const provenance = {
      page: entry.page,
      viewport: entry.viewport,
      role: entry.role,
      selectorHint: entry.selectorHint,
    };

    for (const [field, value] of Object.entries(entry.styles || {})) {
      if (!fieldMap.has(field)) {
        fieldMap.set(field, new Map());
      }
      const valueMap = fieldMap.get(field);
      const val = value ?? '';
      if (!valueMap.has(val)) {
        valueMap.set(val, { count: 0, examples: [] });
      }
      const meta = valueMap.get(val);
      meta.count += 1;
      if (meta.examples.length < 10) {
        meta.examples.push(provenance);
      }
    }

    const tuple = TYPO_FIELDS.map((field) => String(entry.styles?.[field] ?? ''));
    const tupleKey = tuple.join('||');
    if (!typographyMap.has(tupleKey)) {
      typographyMap.set(tupleKey, {
        count: 0,
        values: {
          fontSize: tuple[0],
          lineHeight: tuple[1],
          letterSpacing: tuple[2],
          fontWeight: tuple[3],
          fontStyle: tuple[4],
          textTransform: tuple[5],
        },
        examples: [],
      });
    }
    const tupleMeta = typographyMap.get(tupleKey);
    tupleMeta.count += 1;
    if (tupleMeta.examples.length < 10) {
      tupleMeta.examples.push(provenance);
    }
  }

  const fields = {};
  const sortedFieldNames = Array.from(fieldMap.keys()).sort();
  for (const field of sortedFieldNames) {
    const values = fieldMap.get(field);
    const sortedValues = Array.from(values.entries()).sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return a[0].localeCompare(b[0]);
    });
    const valueObj = {};
    for (const [val, meta] of sortedValues) {
      valueObj[val] = meta;
    }
    fields[field] = valueObj;
  }

  const typographyTuples = Array.from(typographyMap.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return a[0].localeCompare(b[0]);
    })
    .map(([key, meta]) => ({ key, ...meta }));

  const dedup = { fields, typographyTuples };
  return dedup;
}

function aggregateColors(dedup) {
  const map = new Map();
  for (const field of COLOR_FIELDS) {
    const values = dedup.fields[field];
    if (!values) continue;
    for (const [val, meta] of Object.entries(values)) {
      const existing = map.get(val) || { count: 0, examples: [] };
      existing.count += meta.count;
      if (existing.examples.length < 10) {
        existing.examples.push(...meta.examples.slice(0, 10 - existing.examples.length));
      }
      map.set(val, existing);
    }
  }
  return map;
}

function normalizePx(value) {
  if (typeof value !== 'string') return null;
  if (!value.trim().endsWith('px')) return null;
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return null;
  const normalized = Math.round(num * 2) / 2;
  return `${normalized}px`;
}

function aggregateNumeric(dedup, fields) {
  const map = new Map();
  for (const field of fields) {
    const values = dedup.fields[field];
    if (!values) continue;
    for (const [val, meta] of Object.entries(values)) {
      const normalized = normalizePx(val);
      if (!normalized) continue;
      const existing = map.get(normalized) || { count: 0, examples: [] };
      existing.count += meta.count;
      if (existing.examples.length < 10) {
        existing.examples.push(...meta.examples.slice(0, 10 - existing.examples.length));
      }
      map.set(normalized, existing);
    }
  }
  return map;
}

function aggregateShadows(dedup) {
  const map = new Map();
  for (const field of SHADOW_FIELDS) {
    const values = dedup.fields[field];
    if (!values) continue;
    for (const [val, meta] of Object.entries(values)) {
      const existing = map.get(val) || { count: 0, examples: [] };
      existing.count += meta.count;
      if (existing.examples.length < 10) {
        existing.examples.push(...meta.examples.slice(0, 10 - existing.examples.length));
      }
      map.set(val, existing);
    }
  }
  return map;
}

function aggregateTypography(raw) {
  const map = new Map();
  for (const entry of raw) {
    const styles = entry.styles || {};
    const keyParts = TYPO_FIELDS.map((k) => styles[k] || '');
    const tupleKey = keyParts.join('||');
    if (!map.has(tupleKey)) {
      map.set(tupleKey, {
        count: 0,
        values: {
          fontSize: styles.fontSize || '',
          lineHeight: styles.lineHeight || '',
          letterSpacing: styles.letterSpacing || '',
          fontWeight: styles.fontWeight || '',
          fontStyle: styles.fontStyle || '',
          textTransform: styles.textTransform || '',
        },
        examples: [],
      });
    }
    const meta = map.get(tupleKey);
    meta.count += 1;
    if (meta.examples.length < 10) {
      meta.examples.push({
        page: entry.page,
        viewport: entry.viewport,
        role: entry.role,
        selectorHint: entry.selectorHint,
      });
    }
  }
  return map;
}

function aggregateTypographyFromDedup(dedup) {
  const map = new Map();
  if (!Array.isArray(dedup?.typographyTuples)) return map;
  for (const tuple of dedup.typographyTuples) {
    const key = tuple.key || TYPO_FIELDS.map((field) => tuple?.values?.[field] || '').join('||');
    map.set(key, {
      count: Number(tuple.count || 0),
      values: {
        fontSize: tuple?.values?.fontSize || '',
        lineHeight: tuple?.values?.lineHeight || '',
        letterSpacing: tuple?.values?.letterSpacing || '',
        fontWeight: tuple?.values?.fontWeight || '',
        fontStyle: tuple?.values?.fontStyle || '',
        textTransform: tuple?.values?.textTransform || '',
      },
      examples: Array.isArray(tuple.examples) ? tuple.examples : [],
    });
  }
  return map;
}

function toSortedArray(map) {
  return Array.from(map.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return String(a[0]).localeCompare(String(b[0]));
    })
    .map(([value, meta], idx) => ({ value, ...meta, order: idx + 1 }));
}

function buildTokens({ colors, spaces, radii, borders, shadows, typography }) {
  const tokens = {
    colors: [],
    typography: [],
    spaces: [],
    radii: [],
    borders: [],
    shadows: [],
  };

  for (const entry of colors) {
    const name = `--color-${String(entry.order).padStart(3, '0')}`;
    tokens.colors.push({ name, value: entry.value, type: 'color', frequency: entry.count, examples: entry.examples });
  }

  let textIndex = 1;
  for (const entry of typography) {
    const baseName = `--text-${String(textIndex).padStart(3, '0')}`;
    const common = { type: 'text', frequency: entry.count, examples: entry.examples };
    tokens.typography.push({ name: `${baseName}-font-size`, value: entry.values.fontSize, ...common });
    tokens.typography.push({ name: `${baseName}-line-height`, value: entry.values.lineHeight, ...common });
    tokens.typography.push({ name: `${baseName}-letter-spacing`, value: entry.values.letterSpacing, ...common });
    tokens.typography.push({ name: `${baseName}-weight`, value: entry.values.fontWeight, ...common });
    tokens.typography.push({ name: `${baseName}-style`, value: entry.values.fontStyle, ...common });
    tokens.typography.push({ name: `${baseName}-transform`, value: entry.values.textTransform, ...common });
    textIndex += 1;
  }

  for (const entry of spaces) {
    const name = `--space-${String(entry.order).padStart(3, '0')}`;
    tokens.spaces.push({ name, value: entry.value, type: 'space', frequency: entry.count, examples: entry.examples });
  }

  for (const entry of radii) {
    const name = `--radius-${String(entry.order).padStart(3, '0')}`;
    tokens.radii.push({ name, value: entry.value, type: 'radius', frequency: entry.count, examples: entry.examples });
  }

  for (const entry of borders) {
    const name = `--border-${String(entry.order).padStart(3, '0')}`;
    tokens.borders.push({ name, value: entry.value, type: 'border', frequency: entry.count, examples: entry.examples });
  }

  for (const entry of shadows) {
    const name = `--shadow-${String(entry.order).padStart(3, '0')}`;
    tokens.shadows.push({ name, value: entry.value, type: 'shadow', frequency: entry.count, examples: entry.examples });
  }

  return tokens;
}

function writeTokensCSS(tokens, outputPaths) {
  const lines = [':root {'];

  for (const token of tokens.colors) {
    lines.push(`  ${token.name}: ${token.value};`);
  }

  const groupedText = {};
  for (const token of tokens.typography) {
    const [, group] = token.name.match(/^--text-(\d{3})/) || [];
    if (!group) continue;
    if (!groupedText[group]) groupedText[group] = [];
    groupedText[group].push(token);
  }
  const orderedTextGroups = Object.keys(groupedText).sort();
  for (const group of orderedTextGroups) {
    const parts = groupedText[group].sort((a, b) => a.name.localeCompare(b.name));
    for (const token of parts) {
      lines.push(`  ${token.name}: ${token.value};`);
    }
  }

  for (const token of tokens.spaces) {
    lines.push(`  ${token.name}: ${token.value};`);
  }

  for (const token of tokens.radii) {
    lines.push(`  ${token.name}: ${token.value};`);
  }

  for (const token of tokens.borders) {
    lines.push(`  ${token.name}: ${token.value};`);
  }

  for (const token of tokens.shadows) {
    lines.push(`  ${token.name}: ${token.value};`);
  }

  lines.push('}');
  const css = lines.join('\n');
  for (const outputPath of outputPaths) {
    fs.writeFileSync(outputPath, `${css}\n`);
  }
}

function summarize(tokens) {
  const topColors = tokens.colors.slice(0, 10).map((t) => `${t.name}=${t.value} (${t.frequency})`);
  const topSpaces = tokens.spaces.slice(0, 10).map((t) => `${t.name}=${t.value} (${t.frequency})`);

  console.log('Token candidates generated.');
  console.log(`Colors: ${tokens.colors.length}`);
  console.log(`Typography groups: ${tokens.typography.length / 6}`);
  console.log(`Spaces: ${tokens.spaces.length}`);
  console.log(`Radii: ${tokens.radii.length}`);
  console.log(`Borders: ${tokens.borders.length}`);
  console.log(`Shadows: ${tokens.shadows.length}`);
  console.log('Top colors:', topColors.join(', '));
  console.log('Top spaces:', topSpaces.join(', '));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const dedupPath = DEFAULT_DEDUP_PATH;
  const cssPaths = options.outCssPath
    ? [options.outCssPath]
    : [
      DEFAULT_TOKENS_ROOT_CSS_PATH,
      DEFAULT_TOKENS_CSS_PATH,
      DEFAULT_TOKENS_PUBLIC_CSS_PATH,
      DEFAULT_TOKENS_DOCS_CSS_PATH,
    ];
  ensureOutputDirs({
    outTokensJsonPath: options.outTokensJsonPath,
    cssPaths,
    dedupPath,
  });

  let raw = [];
  let dedup;

  if (options.inputPath) {
    if (!fs.existsSync(options.inputPath)) {
      throw new Error(`Missing input file: ${options.inputPath}`);
    }
    const input = readJSON(options.inputPath);
    if (Array.isArray(input)) {
      raw = input;
      dedup = deduplicate(raw);
      fs.writeFileSync(dedupPath, `${JSON.stringify(dedup, null, 2)}\n`);
    } else if (input && typeof input === 'object' && input.fields) {
      dedup = input;
      if (Array.isArray(input.raw)) raw = input.raw;
    } else {
      throw new Error('--in must point to either raw inventory array JSON or deduplicated JSON with a "fields" object.');
    }
  } else {
    if (!fs.existsSync(DEFAULT_RAW_PATH)) {
      throw new Error('Missing artifacts/style-inventory.raw.json. Run phase2:inventory first or pass --in.');
    }
    raw = readJSON(DEFAULT_RAW_PATH);
    dedup = deduplicate(raw);
    fs.writeFileSync(dedupPath, `${JSON.stringify(dedup, null, 2)}\n`);
  }

  const colorMap = aggregateColors(dedup);
  const spaceMap = aggregateNumeric(dedup, SPACE_FIELDS);
  const radiusMap = aggregateNumeric(dedup, RADIUS_FIELDS);
  const borderMap = aggregateNumeric(dedup, BORDER_WIDTH_FIELDS);
  const shadowMap = aggregateShadows(dedup);
  const typographyMap = raw.length > 0
    ? aggregateTypography(raw)
    : aggregateTypographyFromDedup(dedup);

  const colors = toSortedArray(colorMap);
  const spaces = toSortedArray(spaceMap);
  const radii = toSortedArray(radiusMap);
  const borders = toSortedArray(borderMap);
  const shadows = toSortedArray(shadowMap);
  const typography = toSortedArray(typographyMap);

  const tokens = buildTokens({ colors, spaces, radii, borders, shadows, typography });
  fs.writeFileSync(options.outTokensJsonPath, `${JSON.stringify(tokens, null, 2)}\n`);
  writeTokensCSS(tokens, cssPaths);
  summarize(tokens);
}

main();
