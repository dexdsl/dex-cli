import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const ROLES_PATH = path.join(ROOT, 'style.roles.json');
const SANITIZE_CONFIG_PATH = path.join(ROOT, 'sanitize.config.json');
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_PATH = path.join(ARTIFACT_DIR, 'style-inventory.raw.json');

const DEFAULT_VIEWPORTS = [
  { name: 'mobile', w: 390, h: 844 },
  { name: 'tablet', w: 834, h: 1112 },
  { name: 'desktop', w: 1440, h: 900 },
];

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

const SHADOW_FIELDS = ['boxShadow'];
const TYPO_FIELDS = ['fontSize', 'lineHeight', 'letterSpacing', 'fontWeight', 'fontStyle', 'textTransform'];

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  return Array.from(new Set(routes.map((entry) => String(entry).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function applyRouteFilters(routes, pageLimitConfig) {
  let filtered = [...routes];
  const pageFilter = process.env.PAGE_FILTER ? String(process.env.PAGE_FILTER) : '';
  if (pageFilter) {
    filtered = filtered.filter((route) => route.includes(pageFilter));
  }

  let pageLimit = Number.NaN;
  if (process.env.PAGE_LIMIT) {
    pageLimit = Number(process.env.PAGE_LIMIT);
  } else if (pageLimitConfig !== null && pageLimitConfig !== undefined && pageLimitConfig !== '') {
    pageLimit = Number(pageLimitConfig);
  }

  if (Number.isFinite(pageLimit) && pageLimit > 0) {
    filtered = filtered.slice(0, Math.floor(pageLimit));
  }

  return filtered;
}

async function waitForServer(baseURL, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(baseURL, { method: 'HEAD' });
      if (res.ok || res.status === 404) return true;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
  };
  return map[ext] || 'application/octet-stream';
}

function resolveSafe(baseDir, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const cleanPath = decoded.replace(/\/+/g, '/');
  const resolved = path.resolve(baseDir, `.${cleanPath}`);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase)) return null;
  return resolved;
}

function resolveRouteFile(baseDir, pathname) {
  const safePath = resolveSafe(baseDir, pathname);
  if (!safePath) return null;

  const candidates = [];
  const hasExtension = path.extname(safePath) !== '';
  const isDirectoryHint = pathname.endsWith('/');

  if (isDirectoryHint) {
    candidates.push(path.join(safePath, 'index.html'));
  } else {
    candidates.push(safePath);
    if (!hasExtension) {
      candidates.push(`${safePath}.html`);
      candidates.push(path.join(safePath, 'index.html'));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function startStaticServer(baseDir, port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url || '/', `http://${host || 'localhost'}:${port}`);
      const filePath = resolveRouteFile(baseDir, requestUrl.pathname);
      if (!filePath) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      res.setHeader('Content-Type', contentType(filePath));
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        res.statusCode = 500;
        res.end('Server error');
      });
      stream.pipe(res);
    });
    server.on('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

async function preparePage(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    // Some routes keep long-lived requests open; continue with a bounded wait.
  }
  await page.evaluate(async () => {
    const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  });
  await page.addStyleTag({
    content: `
      * { animation: none !important; transition: none !important; caret-color: auto !important; scroll-behavior: auto !important; }
    `,
  });
}

async function navigateWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  }
}

function selectorHint(elementMeta, role) {
  const tag = elementMeta.tag || '';
  const id = elementMeta.id ? `#${elementMeta.id}` : '';
  const cls = elementMeta.firstClass ? `.${elementMeta.firstClass}` : '';
  return `${tag}${id}${cls} [role:${role}]`.trim();
}

function roundHalf(value) {
  return Math.round(Number(value) * 2) / 2;
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

function normalizePx(value) {
  if (typeof value !== 'string') return null;
  if (!value.trim().endsWith('px')) return null;
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return null;
  return `${Math.round(numeric * 2) / 2}px`;
}

function aggregateValues(records, fields, normalizer = (value) => value) {
  const counts = new Map();
  for (const record of records) {
    for (const field of fields) {
      const raw = record.styles[field];
      const normalized = normalizer(raw);
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return counts;
}

function topEntries(countMap, limit = 10) {
  return Array.from(countMap.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function uniqueTypographyCount(records) {
  const tuples = new Set();
  for (const record of records) {
    const key = TYPO_FIELDS.map((field) => String(record.styles[field] ?? '')).join('||');
    tuples.add(key);
  }
  return tuples.size;
}

async function main() {
  const sanitizeConfig = loadJSON(SANITIZE_CONFIG_PATH, 'sanitize.config.json');
  const targets = loadJSON(TARGETS_PATH, 'artifacts/repo-targets.json');
  const roles = loadJSON(ROLES_PATH, 'style.roles.json');

  const allRoutes = normalizeRoutes(targets.routes);
  const routes = applyRouteFilters(allRoutes, sanitizeConfig.pageLimit);
  if (routes.length === 0) {
    throw new Error('No routes selected. Run repo:discover and verify PAGE_FILTER/PAGE_LIMIT.');
  }
  const viewports = Array.isArray(sanitizeConfig.viewports) && sanitizeConfig.viewports.length > 0
    ? sanitizeConfig.viewports
    : DEFAULT_VIEWPORTS;
  const baseURL = sanitizeConfig.baseURL || process.env.PHASE2_BASE_URL || 'http://localhost:8080';

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const base = new URL(baseURL);
  const port = Number(base.port) || (base.protocol === 'https:' ? 443 : 80);
  const host = base.hostname === 'localhost' ? '127.0.0.1' : (base.hostname || '127.0.0.1');

  let serverInstance = null;
  const live = await waitForServer(baseURL);
  if (!live) {
    try {
      serverInstance = await startStaticServer(path.join(ROOT, 'docs'), port, host);
    } catch (error) {
      throw new Error(`Could not start local server on ${host}:${port}: ${error.message}`);
    }
  }

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
        for (const route of routes) {
          const page = await context.newPage();
          const url = new URL(route, baseURL).toString();
          try {
            await navigateWithFallback(page, url);
            await preparePage(page);
            for (const [roleName, selectors] of Object.entries(roles)) {
              const records = await collectRoleSamples(page, route, viewport.name, roleName, selectors);
              inventory.push(...records);
              roleCounts[roleName] = (roleCounts[roleName] || 0) + records.length;
            }
          } catch (error) {
            routeErrors.push({
              route,
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
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
  }

  inventory.sort((a, b) => {
    if (a.page !== b.page) return a.page.localeCompare(b.page);
    if (a.viewport !== b.viewport) return a.viewport.localeCompare(b.viewport);
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return a.selectorHint.localeCompare(b.selectorHint);
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(inventory, null, 2));

  const colorCounts = aggregateValues(inventory, COLOR_FIELDS);
  const spaceCounts = aggregateValues(inventory, SPACE_FIELDS, normalizePx);
  const radiusCounts = aggregateValues(inventory, RADIUS_FIELDS, normalizePx);
  const shadowCounts = aggregateValues(inventory, SHADOW_FIELDS);

  console.log('Style inventory saved to artifacts/style-inventory.raw.json');
  console.log(`Pages visited (${routes.length}): ${routes.join(', ')}`);
  console.log(`Viewports (${viewports.length}): ${viewports.map((v) => v.name).join(', ')}`);
  console.log('Samples per role:');
  for (const roleName of Object.keys(roles).sort((a, b) => a.localeCompare(b))) {
    console.log(`  ${roleName}: ${roleCounts[roleName] || 0}`);
  }
  console.log(`Unique colors: ${colorCounts.size}`);
  console.log(`Unique spaces: ${spaceCounts.size}`);
  console.log(`Unique radii: ${radiusCounts.size}`);
  console.log(`Unique text tuples: ${uniqueTypographyCount(inventory)}`);
  console.log(`Unique shadows: ${shadowCounts.size}`);
  console.log(`Top colors: ${topEntries(colorCounts).map(([value, count]) => `${value} (${count})`).join(', ')}`);
  console.log(`Top spaces: ${topEntries(spaceCounts).map(([value, count]) => `${value} (${count})`).join(', ')}`);
  if (routeErrors.length > 0) {
    console.log(`Route errors: ${routeErrors.length}`);
    for (const routeError of routeErrors.slice(0, 30)) {
      console.log(`  ${routeError.viewport} ${routeError.route}: ${routeError.reason}`);
    }
    if (routeErrors.length > 30) {
      console.log(`  ... ${routeErrors.length - 30} more`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
