import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const SANITIZE_CONFIG_PATH = path.join(ROOT, 'sanitize.config.json');
const TARGETS_PATH = path.join(ROOT, 'artifacts', 'repo-targets.json');
const ROLES_PATH = path.join(ROOT, 'style.roles.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_PATH = path.join(ARTIFACT_DIR, 'style-states.json');

const DEFAULT_VIEWPORTS = [
  { name: 'mobile', w: 390, h: 844 },
  { name: 'tablet', w: 834, h: 1112 },
  { name: 'desktop', w: 1440, h: 900 },
];

const CATEGORY_SELECTORS = {
  links: ['a[href]'],
  inputs: ['input', 'textarea', 'select'],
};

const STYLE_FIELDS = [
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'outlineColor',
  'outlineWidth',
  'boxShadow',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'transform',
  'opacity',
];

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
      .dx-force-disabled { opacity: 0.5 !important; pointer-events: none !important; }
    `,
  });
  await page.evaluate(() => {
    const stop = (event) => {
      const target = event.target;
      const clickable = target && (target.closest('a[href]') || target.closest('button') || target.closest('[role="button"]'));
      if (clickable) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach((name) => {
      window.addEventListener(name, stop, true);
    });
  });
}

async function navigateWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  }
}

async function guardNavigation(element) {
  await element.evaluate((el) => {
    const state = {};
    if (el instanceof HTMLAnchorElement) {
      state.href = el.getAttribute('href');
      el.setAttribute('href', '#');
    }
    if (el instanceof HTMLButtonElement) {
      state.type = el.getAttribute('type');
      el.setAttribute('type', 'button');
    }
    if (el instanceof HTMLInputElement && el.type === 'submit') {
      state.inputType = el.getAttribute('type');
      el.setAttribute('type', 'button');
    }
    el.dataset.dxNavGuardState = JSON.stringify(state);
  });
}

async function restoreNavigation(element) {
  await element.evaluate((el) => {
    const stateText = el.dataset.dxNavGuardState;
    if (!stateText) return;
    const state = JSON.parse(stateText);
    if (state.href !== undefined) {
      if (state.href === null) el.removeAttribute('href');
      else el.setAttribute('href', state.href);
    }
    if (state.type !== undefined) {
      if (state.type === null) el.removeAttribute('type');
      else el.setAttribute('type', state.type);
    }
    if (state.inputType !== undefined) {
      if (state.inputType === null) el.removeAttribute('type');
      else el.setAttribute('type', state.inputType);
    }
    delete el.dataset.dxNavGuardState;
  });
}

async function findFirstVisible(page, selectors) {
  const handle = await page.evaluateHandle((candidateSelectors) => {
    const isVisible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return rect.width * rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    for (const selector of candidateSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (isVisible(node)) {
          node.dataset.dxSelectorUsed = selector;
          return node;
        }
      }
    }
    return null;
  }, selectors);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  const selectorUsed = await page.evaluate((el) => el.dataset.dxSelectorUsed || '', element);
  return { element, selectorUsed };
}

async function captureStyles(element) {
  return element.evaluate(
    (el, fields) => {
      const styles = getComputedStyle(el);
      const result = {};
      for (const field of fields) {
        result[field] = styles[field];
      }
      return {
        styles: result,
        meta: {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          firstClass: (el.classList && el.classList[0]) || '',
        },
      };
    },
    STYLE_FIELDS,
  );
}

function selectorHint(meta, category) {
  const tag = meta.tag || '';
  const id = meta.id ? `#${meta.id}` : '';
  const cls = meta.firstClass ? `.${meta.firstClass}` : '';
  return `${tag}${id}${cls} [category:${category}]`.trim();
}

function diff(base, target) {
  const delta = {};
  if (!base || !target) return delta;
  for (const key of Object.keys(base)) {
    if (target[key] !== base[key]) {
      delta[key] = target[key];
    }
  }
  return delta;
}

async function applyHoverAndCapture(page, element) {
  const box = await element.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await element.hover();
  }
  return captureStyles(element);
}

async function applyActiveAndCapture(page, element) {
  const box = await element.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
  } else {
    await element.hover();
    await page.mouse.down();
  }
  const captured = await captureStyles(element);
  await page.mouse.up();
  return captured;
}

async function captureDisabledState(element) {
  const disableable = await element.evaluate((el) => (
    el instanceof HTMLButtonElement
    || el instanceof HTMLInputElement
    || el instanceof HTMLSelectElement
    || el instanceof HTMLTextAreaElement
  ));
  const alreadyDisabled = await element.evaluate((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true');

  if (disableable && !alreadyDisabled) {
    return null;
  }
  if (disableable && alreadyDisabled) {
    return captureStyles(element);
  }

  await element.evaluate((el) => el.classList.add('dx-force-disabled'));
  const captured = await captureStyles(element);
  await element.evaluate((el) => el.classList.remove('dx-force-disabled'));
  return captured;
}

async function main() {
  const sanitizeConfig = loadJSON(SANITIZE_CONFIG_PATH, 'sanitize.config.json');
  const targets = loadJSON(TARGETS_PATH, 'artifacts/repo-targets.json');
  const roles = loadJSON(ROLES_PATH, 'style.roles.json');
  const buttonSelectors = Array.isArray(roles.buttons) && roles.buttons.length > 0
    ? roles.buttons
    : ['button', "[role='button']", 'a[href].buttonlike'];
  const categorySelectors = {
    buttons: buttonSelectors,
    ...CATEGORY_SELECTORS,
  };
  const routes = applyRouteFilters(normalizeRoutes(targets.routes), sanitizeConfig.pageLimit);
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

  const browser = await chromium.launch({ headless: true });
  const results = [];
  const categoryCounts = { buttons: 0, links: 0, inputs: 0 };
  const routeErrors = [];

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

            for (const [category, selectors] of Object.entries(categorySelectors)) {
              const found = await findFirstVisible(page, selectors);
              if (!found) continue;
              categoryCounts[category] += 1;

              const { element, selectorUsed } = found;
              await guardNavigation(element);
              try {
                const defaultCapture = await captureStyles(element);
                const hoverCapture = await applyHoverAndCapture(page, element);
                await element.evaluate((el) => el.focus());
                const focusCapture = await captureStyles(element);
                const activeCapture = await applyActiveAndCapture(page, element);
                const disabledCapture = await captureDisabledState(element);

                results.push({
                  page: route,
                  viewport: viewport.name,
                  category,
                  selectorUsed,
                  selectorHint: selectorHint(defaultCapture.meta, category),
                  stylesDefault: defaultCapture.styles,
                  stylesHover: hoverCapture.styles,
                  stylesFocus: focusCapture.styles,
                  stylesActive: activeCapture.styles,
                  stylesDisabled: disabledCapture ? disabledCapture.styles : null,
                  deltas: {
                    hover: diff(defaultCapture.styles, hoverCapture.styles),
                    focus: diff(defaultCapture.styles, focusCapture.styles),
                    active: diff(defaultCapture.styles, activeCapture.styles),
                    disabled: disabledCapture ? diff(defaultCapture.styles, disabledCapture.styles) : {},
                  },
                });
              } finally {
                await restoreNavigation(element);
              }
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

  results.sort((a, b) => {
    if (a.page !== b.page) return a.page.localeCompare(b.page);
    if (a.viewport !== b.viewport) return a.viewport.localeCompare(b.viewport);
    return a.category.localeCompare(b.category);
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  console.log('Style states saved to artifacts/style-states.json');
  console.log(`Pages visited (${routes.length}): ${routes.join(', ')}`);
  console.log(`Viewports (${viewports.length}): ${viewports.map((v) => v.name).join(', ')}`);
  console.log(`States captured: ${results.length}`);
  console.log(`Category hits: buttons=${categoryCounts.buttons}, links=${categoryCounts.links}, inputs=${categoryCounts.inputs}`);
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
