#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const AUTH_PATH = path.join(ROOT, 'public', 'assets', 'dex-auth.js');
const HEADER_SLOT_PATH = path.join(ROOT, 'public', 'assets', 'js', 'header-slot.js');

const PROFILE_PROTECTED_ROUTES = [
  '/press',
  '/favorites',
  '/submit',
  '/messages',
  '/settings',
  '/achievements',
  '/entry/favorites',
  '/entry/submit',
  '/entry/messages',
  '/entry/messages/submission',
  '/entry/pressroom',
  '/entry/settings',
  '/entry/achievements',
];

const PROFILE_MESH_ROUTES = [
  '/submit',
  '/messages',
  '/entry/submit',
  '/entry/messages',
  '/entry/messages/submission',
  '/entry/pressroom',
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function extractRoutesFromObject(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return new Set();
  const objectStart = text.indexOf('{', markerIndex);
  const objectEnd = text.indexOf('};', objectStart);
  if (objectStart < 0 || objectEnd < 0) return new Set();
  const block = text.slice(objectStart, objectEnd);
  const matches = block.match(/"\/[^"]+"\s*:/g) || [];
  return new Set(matches.map((match) => match.split(':')[0].trim().slice(1, -1)));
}

function extractRoutesFromSet(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return new Set();
  const setStart = text.indexOf('[', markerIndex);
  const setEnd = text.indexOf(']);', setStart);
  if (setStart < 0 || setEnd < 0) return new Set();
  const block = text.slice(setStart, setEnd);
  const matches = block.match(/'\/[^']+'/g) || [];
  return new Set(matches.map((value) => value.slice(1, -1)));
}

function main() {
  const authText = readText(AUTH_PATH);
  const headerSlotText = readText(HEADER_SLOT_PATH);
  const failures = [];

  const authRoutes = extractRoutesFromObject(authText, 'var PROTECTED_PATHS =');
  const headerRoutes = extractRoutesFromSet(headerSlotText, 'const PROFILE_PROTECTED_ROUTES = new Set(');
  const headerMeshRoutes = extractRoutesFromSet(headerSlotText, 'const PROFILE_SHOW_MESH_ROUTES = new Set(');

  if (authRoutes.size === 0) {
    failures.push('Could not parse PROTECTED_PATHS from public/assets/dex-auth.js');
  }
  if (headerRoutes.size === 0) {
    failures.push('Could not parse PROFILE_PROTECTED_ROUTES from public/assets/js/header-slot.js');
  }
  if (headerMeshRoutes.size === 0) {
    failures.push('Could not parse PROFILE_SHOW_MESH_ROUTES from public/assets/js/header-slot.js');
  }

  for (const route of PROFILE_PROTECTED_ROUTES) {
    if (!authRoutes.has(route)) {
      failures.push(`dex-auth protected route set is missing ${route}`);
    }
    if (!headerRoutes.has(route)) {
      failures.push(`header-slot protected route set is missing ${route}`);
    }
  }

  for (const route of PROFILE_MESH_ROUTES) {
    if (!headerMeshRoutes.has(route)) {
      failures.push(`header-slot mesh route set is missing ${route}`);
    }
  }

  if (!authText.includes('resolve: function (timeoutMs)')) {
    failures.push('DEX_AUTH.resolve(timeoutMs) export is missing in dex-auth runtime.');
  }
  if (!authText.includes('requireAuth: function (options)')) {
    failures.push('DEX_AUTH.requireAuth(options) export is missing in dex-auth runtime.');
  }
  if (!authText.includes('dispatchWindowEvent("dex-auth:state"')) {
    failures.push('dex-auth:state event dispatch marker is missing in dex-auth runtime.');
  }
  if (!authText.includes('dispatchWindowEvent("dex-auth:guard"')) {
    failures.push('dex-auth:guard event dispatch marker is missing in dex-auth runtime.');
  }

  if (failures.length > 0) {
    console.error(`verify:protected-auth failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('verify:protected-auth passed.');
}

try {
  main();
} catch (error) {
  console.error(`verify:protected-auth error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
