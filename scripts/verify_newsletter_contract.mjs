#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const FAILURES = [];

async function readText(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), 'utf8');
}

function assertIncludes(label, source, markers) {
  markers.forEach((marker) => {
    if (!source.includes(marker)) {
      FAILURES.push(`${label} missing marker: ${marker}`);
    }
  });
}

function assertExcludes(label, source, markers) {
  markers.forEach((marker) => {
    if (source.includes(marker)) {
      FAILURES.push(`${label} contains forbidden marker: ${marker}`);
    }
  });
}

async function verifyCallRuntime() {
  const callRel = 'scripts/src/call.editorial.entry.mjs';
  const callSource = await readText(callRel);
  assertIncludes(callRel, callSource, [
    'mountMarketingNewsletter',
    'data-dx-marketing-newsletter-mount',
  ]);

  const sharedRel = 'scripts/src/shared/dx-marketing-newsletter.entry.mjs';
  const sharedSource = await readText(sharedRel);
  assertIncludes(sharedRel, sharedSource, [
    '/newsletter/subscribe',
    'x-dx-idempotency-key',
    'challengeToken',
    'honey',
    'submittedAt',
    'clientRequestId',
  ]);

  const cssRel = 'public/css/components/dx-marketing-newsletter.css';
  const cssSource = await readText(cssRel);
  assertIncludes(cssRel, cssSource, [
    '.dx-marketing-newsletter-form',
    '.dx-marketing-newsletter-feedback',
    '.dx-marketing-newsletter-honey-wrap',
  ]);

  const callPageRel = 'docs/call/index.html';
  const callPage = await readText(callPageRel);
  assertIncludes(callPageRel, callPage, [
    '/css/components/dx-marketing-newsletter.css',
    '/assets/dex-runtime-config.js',
    'challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    'data-dx-marketing-newsletter-mount="call-page"',
  ]);
}

async function verifyMarketingMountCoverage() {
  const homeRel = 'docs/index.html';
  const homeHtml = await readText(homeRel);
  assertIncludes(homeRel, homeHtml, [
    'data-dx-marketing-newsletter-mount="home-page-cta"',
    '/css/components/dx-marketing-newsletter.css',
    '/assets/js/dx-marketing-newsletter.js',
  ]);

  const aboutRel = 'docs/about/index.html';
  const aboutHtml = await readText(aboutRel);
  assertIncludes(aboutRel, aboutHtml, [
    '/css/components/dx-marketing-newsletter.css',
    '/assets/js/dx-marketing-newsletter.js',
  ]);
  const aboutRuntimeRel = 'scripts/src/about.editorial.entry.mjs';
  const aboutRuntime = await readText(aboutRuntimeRel);
  assertIncludes(aboutRuntimeRel, aboutRuntime, [
    'mountMarketingNewsletter',
    'data-dx-marketing-newsletter-mount',
    'about-support-page',
  ]);

  const catalogIndexRel = 'docs/catalog/index.html';
  const catalogIndexHtml = await readText(catalogIndexRel);
  assertIncludes(catalogIndexRel, catalogIndexHtml, [
    '/css/components/dx-marketing-newsletter.css',
  ]);

  const catalogHowRel = 'docs/catalog/how/index.html';
  const catalogHowHtml = await readText(catalogHowRel);
  assertIncludes(catalogHowRel, catalogHowHtml, [
    '/css/components/dx-marketing-newsletter.css',
  ]);

  const dexnotesRenderRel = 'scripts/render_dexnotes_pages.mjs';
  const dexnotesRenderSource = await readText(dexnotesRenderRel);
  assertIncludes(dexnotesRenderRel, dexnotesRenderSource, [
    '/css/components/dx-marketing-newsletter.css',
  ]);

  const dexnotesIndexRuntimeRel = 'scripts/src/dexnotes.index.entry.mjs';
  const dexnotesIndexRuntime = await readText(dexnotesIndexRuntimeRel);
  assertIncludes(dexnotesIndexRuntimeRel, dexnotesIndexRuntime, [
    'data-dx-marketing-newsletter-mount',
    'dexnotes-index-page',
  ]);

  const dexnotesEntryRuntimeRel = 'scripts/src/dexnotes.entry.entry.mjs';
  const dexnotesEntryRuntime = await readText(dexnotesEntryRuntimeRel);
  assertIncludes(dexnotesEntryRuntimeRel, dexnotesEntryRuntime, [
    'data-dx-marketing-newsletter-mount',
    'dexnotes-article-page',
  ]);

  const catalogIndexRuntimeRel = 'scripts/src/catalog.index.entry.mjs';
  const catalogIndexRuntime = await readText(catalogIndexRuntimeRel);
  assertIncludes(catalogIndexRuntimeRel, catalogIndexRuntime, [
    'data-dx-marketing-newsletter-mount',
    'catalog-index-page',
  ]);

  const catalogHowRuntimeRel = 'scripts/src/catalog.how.entry.mjs';
  const catalogHowRuntime = await readText(catalogHowRuntimeRel);
  assertIncludes(catalogHowRuntimeRel, catalogHowRuntime, [
    'data-dx-marketing-newsletter-mount',
    'catalog-how-page',
  ]);
}

async function verifyRoutePages() {
  const confirmRel = 'docs/newsletter/confirm/index.html';
  const confirmHtml = await readText(confirmRel);
  assertIncludes(confirmRel, confirmHtml, [
    'id="dx-newsletter-confirm"',
    '/newsletter/confirm',
    'data-dx-newsletter-state',
  ]);

  const unsubRel = 'docs/newsletter/unsubscribe/index.html';
  const unsubHtml = await readText(unsubRel);
  assertIncludes(unsubRel, unsubHtml, [
    'id="dx-newsletter-unsubscribe"',
    '/newsletter/unsubscribe',
    'data-dx-newsletter-state',
  ]);
}

async function verifyLegacyRemoval() {
  const marketingPages = [
    'docs/index.html',
    'docs/call/index.html',
    'docs/about/index.html',
    'docs/catalog/index.html',
    'docs/catalog/how/index.html',
    'docs/dexnotes/index.html',
    'docs/favorites/index.html',
  ];

  for (const rel of marketingPages) {
    const html = await readText(rel);
    assertExcludes(rel, html, [
      'chimpstatic.com',
      'id="mcjs"',
      "Y.use('legacysite-form-submit'",
    ]);
  }
}

async function verifyCliWiring() {
  const dexRel = 'scripts/dex.mjs';
  const dexSource = await readText(dexRel);
  assertIncludes(dexRel, dexSource, [
    'runNewsletterCommand',
    "topLevel.command === 'newsletter'",
    'newsletter:import',
  ]);

  const dashboardRel = 'scripts/ui/dashboard.mjs';
  const dashboardSource = await readText(dashboardRel);
  assertIncludes(dashboardRel, dashboardSource, [
    'NewsletterManager',
    "id: 'newsletter'",
  ]);
}

async function verifyBimiAssets() {
  const bimiReadmeRel = 'docs/.well-known/bimi/README.md';
  const bimiReadme = await readText(bimiReadmeRel);
  assertIncludes(bimiReadmeRel, bimiReadme, [
    'default._bimi.updates.dexdsl.com',
    'dex-logo.svg',
  ]);

  const bimiSvgRel = 'docs/.well-known/bimi/dex-logo.svg';
  const bimiSvg = await readText(bimiSvgRel);
  assertIncludes(bimiSvgRel, bimiSvg, [
    'baseProfile="tiny-ps"',
    '<title>Dex Digital Sample Library</title>',
  ]);
}

async function verifyTemplateStack() {
  const registryRel = 'scripts/lib/newsletter-templates.mjs';
  const registry = await readText(registryRel);
  assertIncludes(registryRel, registry, [
    'newsletterTemplate',
    "TEMPLATE_MAP.get('newsletter')",
  ]);

  const newsletterRel = 'scripts/newsletter/templates/newsletter.mjs';
  const newsletterSource = await readText(newsletterRel);
  assertIncludes(newsletterRel, newsletterSource, [
    "key: 'newsletter'",
    'Dex Weekly Digest',
  ]);

  const sharedRel = 'scripts/newsletter/templates/shared.mjs';
  const sharedSource = await readText(sharedRel);
  assertIncludes(sharedRel, sharedSource, [
    'Dex Digital Sample Library, Los Angeles, CA 90021',
  ]);
}

async function main() {
  await verifyCallRuntime();
  await verifyMarketingMountCoverage();
  await verifyRoutePages();
  await verifyLegacyRemoval();
  await verifyCliWiring();
  await verifyBimiAssets();
  await verifyTemplateStack();

  if (FAILURES.length) {
    console.error(`verify:newsletter failed with ${FAILURES.length} issue(s):`);
    FAILURES.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log('verify:newsletter passed.');
}

main().catch((error) => {
  console.error(`verify:newsletter error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
