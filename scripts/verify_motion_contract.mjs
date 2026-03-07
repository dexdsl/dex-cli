#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const FILES = {
  baseCss: path.join(ROOT, 'public', 'css', 'base.css'),
  dexCss: path.join(ROOT, 'public', 'assets', 'css', 'dex.css'),
  slotRuntime: path.join(ROOT, 'public', 'assets', 'js', 'header-slot.js'),
  helper: path.join(ROOT, 'scripts', 'src', 'shared', 'dx-motion.entry.mjs'),
};

const REQUIRED_TOKENS = [
  '--dx-motion-ease-standard',
  '--dx-motion-ease-emphasis',
  '--dx-motion-ease-exit',
  '--dx-motion-dur-xs',
  '--dx-motion-dur-sm',
  '--dx-motion-dur-md',
  '--dx-motion-dur-lg',
  '--dx-motion-distance-sm',
  '--dx-motion-distance-md',
  '--dx-motion-distance-lg',
  '--dx-motion-scale-hover',
  '--dx-motion-scale-press',
  '--dx-motion-opacity-enter',
];

const REQUIRED_ROUTE_EVENTS = [
  'dx:route-transition-out:start',
  'dx:route-transition-out:end',
  'dx:route-transition-in:start',
  'dx:route-transition-in:end',
];

const REQUIRED_HELPER_EXPORTS = [
  'export function prefersReducedMotion',
  'export function stopAllInScope',
  'export function routeTransitionOut',
  'export function routeTransitionIn',
  'export function bindDexButtonMotion',
  'export function bindPaginationMotion',
  'export function bindSidebarMotion',
  'export function revealStagger',
];

const LEGACY_FUNCTION_MARKERS = [
  'function bindHoverMotion',
  'function revealWithMotion',
];

const CORE_ENTRY_FILES = [
  'scripts/src/dexnotes.index.entry.mjs',
  'scripts/src/dexnotes.entry.entry.mjs',
  'scripts/src/call.editorial.entry.mjs',
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function verifyTokenParity(failures) {
  const baseCss = readText(FILES.baseCss);
  const dexCss = readText(FILES.dexCss);

  REQUIRED_TOKENS.forEach((token) => {
    if (!baseCss.includes(token)) {
      failures.push(`base.css missing motion token ${token}`);
    }
    if (!dexCss.includes(token)) {
      failures.push(`dex.css missing motion token ${token}`);
    }
  });
}

function verifyRouteEvents(failures) {
  const runtime = readText(FILES.slotRuntime);
  REQUIRED_ROUTE_EVENTS.forEach((eventName) => {
    if (!runtime.includes(eventName)) {
      failures.push(`header-slot runtime missing route transition event marker ${eventName}`);
    }
  });
}

function verifyHelperSurface(failures) {
  const helper = readText(FILES.helper);
  REQUIRED_HELPER_EXPORTS.forEach((needle) => {
    if (!helper.includes(needle)) {
      failures.push(`dx-motion helper missing export marker: ${needle}`);
    }
  });
}

function verifyLegacyDeduplication(failures) {
  CORE_ENTRY_FILES.forEach((relativePath) => {
    const absolutePath = path.join(ROOT, relativePath);
    const source = readText(absolutePath);
    LEGACY_FUNCTION_MARKERS.forEach((marker) => {
      if (source.includes(marker)) {
        failures.push(`${relativePath} still contains legacy local motion function marker: ${marker}`);
      }
    });
  });
}

function main() {
  const failures = [];

  verifyTokenParity(failures);
  verifyRouteEvents(failures);
  verifyHelperSurface(failures);
  verifyLegacyDeduplication(failures);

  if (failures.length > 0) {
    console.error(`verify:motion failed with ${failures.length} issue(s):`);
    failures.forEach((failure) => {
      console.error(`- ${failure}`);
    });
    process.exit(1);
  }

  console.log('verify:motion passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:motion error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
