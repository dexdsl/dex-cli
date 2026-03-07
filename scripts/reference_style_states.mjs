#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadReferenceSettings, normalizeRoute } from './lib/reference-config.mjs';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'reference');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'style-states.json');

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
  const { referenceBaseUrl, pages, viewports, roleSelectors } = loadReferenceSettings();
  const buttonSelectors = Array.isArray(roleSelectors.buttons) && roleSelectors.buttons.length > 0
    ? roleSelectors.buttons
    : ['button', "[role='button']", 'a[href].buttonlike'];
  const categorySelectors = {
    buttons: buttonSelectors,
    ...CATEGORY_SELECTORS,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
        for (const route of pages) {
          const normalizedRoute = normalizeRoute(route);
          const page = await context.newPage();
          const url = new URL(normalizedRoute, referenceBaseUrl).toString();
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
                  page: normalizedRoute,
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

  results.sort((a, b) => {
    if (a.page !== b.page) return a.page.localeCompare(b.page);
    if (a.viewport !== b.viewport) return a.viewport.localeCompare(b.viewport);
    return a.category.localeCompare(b.category);
  });

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`reference style states saved to ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(`pages visited (${pages.length}): ${pages.join(', ')}`);
  console.log(`viewports (${viewports.length}): ${viewports.map((v) => v.name).join(', ')}`);
  console.log(`states captured: ${results.length}`);
  console.log(`category hits: buttons=${categoryCounts.buttons}, links=${categoryCounts.links}, inputs=${categoryCounts.inputs}`);
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
