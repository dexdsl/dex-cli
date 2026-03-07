#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadReferenceSettings, normalizeRoute } from './lib/reference-config.mjs';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'reference');
const RAW_PATH = path.join(OUTPUT_DIR, 'style-inventory.raw.json');
const DEDUP_PATH = path.join(OUTPUT_DIR, 'style-inventory.dedup.json');

const STYLE_FIELDS = [
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
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'fontVariantLigatures',
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
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxShadow',
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'maxWidth',
  'minWidth',
  'alignItems',
  'justifyContent',
  'alignSelf',
  'justifySelf',
  'gridTemplateColumns',
  'gridTemplateRows',
  'flexDirection',
  'flexWrap',
  'textAlign',
  'opacity',
  'zIndex',
];

const TYPO_FIELDS = ['fontSize', 'lineHeight', 'letterSpacing', 'fontWeight', 'fontStyle', 'textTransform'];

function selectorHint(elementMeta, role) {
  const tag = elementMeta.tag || '';
  const id = elementMeta.id ? `#${elementMeta.id}` : '';
  const cls = elementMeta.firstClass ? `.${elementMeta.firstClass}` : '';
  return `${tag}${id}${cls} [role:${role}]`.trim();
}

function roundHalf(value) {
  return Math.round(Number(value) * 2) / 2;
}

async function navigateWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
  }
}

async function preparePage(page) {
  await page.evaluate(async () => {
    const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: auto !important;
        scroll-behavior: auto !important;
      }
    `,
  });
}

async function collectRoleSamples(page, route, viewportName, roleName, selectors) {
  const combined = selectors.join(',');
  const handles = await page.$$(combined);
  const selected = handles.slice(0, 60);
  const records = [];

  for (const handle of selected) {
    const data = await handle.evaluate(
      (el, payload) => {
        const rect = el.getBoundingClientRect();
        const styles = getComputedStyle(el);
        const output = {};
        for (const field of payload.fields) {
          output[field] = styles[field];
        }
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          firstClass: (el.classList && el.classList[0]) || '',
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          styles: output,
        };
      },
      { fields: STYLE_FIELDS },
    );

    records.push({
      page: route,
      viewport: viewportName,
      role: roleName,
      selectorHint: selectorHint(data, roleName),
      rect: {
        x: roundHalf(data.rect.x),
        y: roundHalf(data.rect.y),
        width: roundHalf(data.rect.width),
        height: roundHalf(data.rect.height),
      },
      styles: data.styles,
    });
  }

  return records;
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
    for (const [value, meta] of sortedValues) {
      valueObj[value] = meta;
    }
    fields[field] = valueObj;
  }

  const typographyTuples = Array.from(typographyMap.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return a[0].localeCompare(b[0]);
    })
    .map(([key, meta]) => ({ key, ...meta }));

  return { fields, typographyTuples };
}

function topFieldCount(raw, fieldName) {
  const counts = new Map();
  for (const entry of raw) {
    const value = entry.styles?.[fieldName];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([value, count]) => `${value} (${count})`)
    .join(', ');
}

async function main() {
  const { referenceBaseUrl, pages, viewports, roleSelectors } = loadReferenceSettings();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const inventory = [];
  const roleCounts = {};
  const routeErrors = [];
  const browser = await chromium.launch({ headless: true });

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.w, height: viewport.h },
      });
      try {
        for (const route of pages) {
          const normalizedRoute = normalizeRoute(route);
          const page = await context.newPage();
          const url = new URL(normalizedRoute, referenceBaseUrl).toString();
          try {
            await navigateWithFallback(page, url);
            await preparePage(page);
            for (const [roleName, selectors] of Object.entries(roleSelectors)) {
              if (!Array.isArray(selectors) || selectors.length === 0) continue;
              const records = await collectRoleSamples(page, normalizedRoute, viewport.name, roleName, selectors);
              inventory.push(...records);
              roleCounts[roleName] = (roleCounts[roleName] || 0) + records.length;
            }
          } catch (error) {
            routeErrors.push({
              route: normalizedRoute,
              viewport: viewport.name,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
          await page.close();
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  inventory.sort((a, b) => {
    if (a.page !== b.page) return a.page.localeCompare(b.page);
    if (a.viewport !== b.viewport) return a.viewport.localeCompare(b.viewport);
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return a.selectorHint.localeCompare(b.selectorHint);
  });

  const dedup = deduplicate(inventory);
  fs.writeFileSync(RAW_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  fs.writeFileSync(DEDUP_PATH, `${JSON.stringify(dedup, null, 2)}\n`, 'utf8');

  console.log('reference style inventory saved');
  console.log(`raw: ${path.relative(ROOT, RAW_PATH)}`);
  console.log(`dedup: ${path.relative(ROOT, DEDUP_PATH)}`);
  console.log(`pages visited (${pages.length}): ${pages.join(', ')}`);
  console.log(`viewports (${viewports.length}): ${viewports.map((v) => v.name).join(', ')}`);
  console.log('samples per role:');
  for (const roleName of Object.keys(roleSelectors).sort((a, b) => a.localeCompare(b))) {
    console.log(`  ${roleName}: ${roleCounts[roleName] || 0}`);
  }
  console.log(`top text color: ${topFieldCount(inventory, 'color')}`);
  console.log(`top background color: ${topFieldCount(inventory, 'backgroundColor')}`);
  if (routeErrors.length > 0) {
    console.log(`route errors: ${routeErrors.length}`);
    for (const routeError of routeErrors.slice(0, 30)) {
      console.log(`  ${routeError.viewport} ${routeError.route}: ${routeError.reason}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
