#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FAILURES = [];

function readText(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    FAILURES.push(`Missing required file: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function assertIncludes(relativePath, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) {
      FAILURES.push(`${relativePath} missing marker: ${marker}`);
    }
  }
}

function verifyMotionRuntimeSurface() {
  const sharedPath = 'scripts/src/shared/dx-motion.entry.mjs';
  const shared = readText(sharedPath);
  assertIncludes(sharedPath, shared, [
    'export function bindMagneticButtonMotion',
    'export function bindSemanticLinkMotion',
    'export function bindPressOnlyMotion',
    'data-dx-motion-include',
    'data-dx-motion-exclude',
    'data-dx-hover-variant',
    'semantic-link',
    'magnetic-button',
    'press-only',
  ]);
}

function verifyInstallerRuntime() {
  const installerPath = 'scripts/src/interactive.hover.site.entry.mjs';
  const installer = readText(installerPath);
  assertIncludes(installerPath, installer, [
    'window.__DX_INTERACTIVE_MOTION',
    "const SLOT_READY_EVENT = 'dx:slotready';",
    "const ROUTE_TRANSITION_OUT_START_EVENT = 'dx:route-transition-out:start';",
    'MutationObserver',
    'bindMagneticButtonMotion',
    'bindSemanticLinkMotion',
    'bindPressOnlyMotion',
    'stopAllInScope',
    'window.__dxInteractiveHover',
  ]);

  const builtPath = 'public/assets/js/interactive-hover.js';
  const built = readText(builtPath);
  assertIncludes(builtPath, built, [
    'dx:slotready',
    'dx:route-transition-out:start',
    '__DX_INTERACTIVE_MOTION',
  ]);
}

function verifyInjectionWiring() {
  const injectorPath = 'scripts/inject_header_slot_scripts.mjs';
  const injector = readText(injectorPath);
  assertIncludes(injectorPath, injector, [
    'INTERACTIVE_HOVER_SCRIPT_TAG',
    '/assets/js/interactive-hover.js',
  ]);

  const expectedTag = '<script defer src="/assets/js/interactive-hover.js"></script>';
  const docsChecks = [
    'docs/index.html',
    'docs/support/index.html',
    'docs/entry/messages/index.html',
  ];
  for (const docPath of docsChecks) {
    const doc = readText(docPath);
    if (!doc.includes(expectedTag)) {
      FAILURES.push(`${docPath} missing injected interactive hover script tag`);
    }
  }
}

function verifySheenMarkersStillPresent() {
  const controlsPath = 'docs/css/components/dx-controls.css';
  const controls = readText(controlsPath);
  assertIncludes(controlsPath, controls, [
    '.dx-button-element--primary::after',
    'animation: dx-button-glint 1.1s cubic-bezier(0.2, 0.7, 0.2, 1) both;',
    '@keyframes dx-button-glint',
  ]);

  const dexCssPath = 'docs/assets/css/dex.css';
  const dexCss = readText(dexCssPath);
  assertIncludes(dexCssPath, dexCss, [
    '--dx-fetch-sheen-duration',
    'animation: dx-fetch-sheen var(--dx-fetch-sheen-duration) var(--dx-fetch-sheen-ease) infinite;',
    'animation: dex-sidebar-primary-glint 1.1s cubic-bezier(0.2, 0.7, 0.2, 1) both;',
    '@keyframes dex-sidebar-primary-glint',
  ]);
}

function main() {
  verifyMotionRuntimeSurface();
  verifyInstallerRuntime();
  verifyInjectionWiring();
  verifySheenMarkersStillPresent();

  if (FAILURES.length > 0) {
    console.error(`verify:hover-motion failed with ${FAILURES.length} issue(s):`);
    for (const failure of FAILURES) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:hover-motion passed.');
}

main();
