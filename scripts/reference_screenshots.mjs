#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadReferenceSettings, normalizeRoute, routeArtifactDir } from './lib/reference-config.mjs';

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, 'artifacts', 'reference', 'screenshots');
const MANIFEST_PATH = path.join(OUTPUT_ROOT, 'manifest.json');

async function navigateWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
  }
}

async function preparePage(page) {
  await page.evaluate(async () => {
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    await Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, 10_000))]);
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

async function main() {
  const { referenceBaseUrl, pages, viewports } = loadReferenceSettings();
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const manifest = {
    referenceBaseUrl,
    capturedAt: new Date().toISOString(),
    pages: [],
  };

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: {
          width: viewport.w,
          height: viewport.h,
        },
      });
      try {
        for (const route of pages) {
          const normalizedRoute = normalizeRoute(route);
          const url = new URL(normalizedRoute, referenceBaseUrl).toString();
          const page = await context.newPage();
          try {
            await navigateWithFallback(page, url);
            await preparePage(page);
            const routeDir = routeArtifactDir(normalizedRoute);
            const outputDir = path.join(OUTPUT_ROOT, routeDir);
            fs.mkdirSync(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, `${viewport.name}.png`);
            await page.screenshot({ path: outputPath, fullPage: true });
            manifest.pages.push({
              route: normalizedRoute,
              viewport: viewport.name,
              width: viewport.w,
              height: viewport.h,
              url,
              screenshot: path.relative(ROOT, outputPath).split(path.sep).join('/'),
            });
            console.log(`captured ${viewport.name} ${normalizedRoute}`);
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`reference screenshots saved to ${path.relative(ROOT, OUTPUT_ROOT)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
