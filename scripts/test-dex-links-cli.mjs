#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const CLI_PATH = path.join(ROOT, 'scripts', 'dex.mjs');

function runLinks(args = []) {
  return spawnSync(process.execPath, [CLI_PATH, 'links', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function mustPass(result, label) {
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed (status=${result.status})\n${detail}`);
  }
}

async function main() {
  const full = runLinks();
  mustPass(full, 'links default');
  const fullOut = String(full.stdout || '');
  assert(fullOut.includes('User submissions (/submit)'), 'default output should include submissions label');
  assert(fullOut.includes('https://docs.google.com/spreadsheets/d/1EE76xNhEh3yvDNI44gVPV2iz5dPFg0ebBi72LLH77l8/edit?gid=0#gid=0'), 'default output should include submissions sheet link');
  assert(fullOut.includes('https://dashboard.stripe.com/login'), 'default output should include stripe link');
  assert(fullOut.includes('https://github.com/dexdsl/dex-api'), 'default output should include api repo link');
  assert(fullOut.includes('https://dexdsl.github.io/status/'), 'default output should include status link');

  const admin = runLinks(['admin']);
  mustPass(admin, 'links admin');
  const adminOut = String(admin.stdout || '');
  assert(adminOut.includes('[Admin]'), 'admin output should include admin group heading');
  assert(adminOut.includes('https://manage.auth0.com/'), 'admin output should include auth0 link');
  assert(!adminOut.includes('https://docs.google.com/spreadsheets/d/1xQffVmchETLc-tQNFaJCo6t0UbMji-F4rEWtIBrZVio/edit?gid=0#gid=0'), 'admin output should not include polls sheet link');

  const sheetsJson = runLinks(['--group', 'sheets', '--json']);
  mustPass(sheetsJson, 'links sheets json');
  const payload = JSON.parse(String(sheetsJson.stdout || '{}'));
  assert(Array.isArray(payload.groups), 'json output should include groups array');
  assert.equal(payload.groups.length, 1, 'json group filter should return one group');
  assert.equal(payload.groups[0].id, 'sheets', 'json group should be sheets');

  console.log('test-dex-links-cli passed');
}

main().catch((error) => {
  console.error(`test-dex-links-cli failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
