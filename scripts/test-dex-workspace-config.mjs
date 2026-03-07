#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildWorkspaceConfig,
  normalizeWorkspaceConfig,
  readWorkspaceConfig,
  resolveRepoRoot,
  validateRepoRoot,
  validateWorkspaceConfig,
  writeWorkspaceConfig,
} from './lib/dex-workspace-config.mjs';

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-workspace-test-'));
  const workspacePath = path.join(tempRoot, 'workspaces.json');
  const siteRoot = path.join(tempRoot, 'dexdsl.github.io');
  const apiRoot = path.join(tempRoot, 'dex-api');
  await fs.mkdir(path.join(siteRoot, '.git'), { recursive: true });
  await fs.mkdir(path.join(apiRoot, '.git'), { recursive: true });

  const config = buildWorkspaceConfig({
    siteRoot,
    apiRoot,
    defaultRepo: 'site',
  });

  const validate = await validateWorkspaceConfig(config);
  assert.equal(validate.ok, true, `workspace config should validate: ${validate.issues.join('; ')}`);

  const written = await writeWorkspaceConfig(config, { filePath: workspacePath });
  assert.equal(written.filePath, workspacePath);

  const loaded = await readWorkspaceConfig({ filePath: workspacePath });
  assert.equal(loaded.exists, true);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.config.repos.site.root, path.resolve(siteRoot));
  assert.equal(loaded.config.repos.api.root, path.resolve(apiRoot));

  const resolvedSite = resolveRepoRoot(loaded.config, 'site');
  assert.equal(resolvedSite.repo, 'site');
  assert.equal(resolvedSite.root, path.resolve(siteRoot));

  const resolvedApi = resolveRepoRoot(loaded.config, 'api');
  assert.equal(resolvedApi.repo, 'api');
  assert.equal(resolvedApi.root, path.resolve(apiRoot));

  const checkedSite = await validateRepoRoot(siteRoot, { label: 'site' });
  assert.equal(checkedSite.ok, true);

  const missingRoot = await validateRepoRoot(path.join(tempRoot, 'missing'), { label: 'missing' });
  assert.equal(missingRoot.ok, false);

  const invalidConfig = normalizeWorkspaceConfig({
    repos: { site: { root: siteRoot } },
    defaultRepo: 'site',
  });
  const invalidValidation = await validateWorkspaceConfig(invalidConfig);
  assert.equal(invalidValidation.ok, false);
  assert(invalidValidation.issues.some((issue) => issue.includes('api repo root is missing')));

  console.log('test-dex-workspace-config passed');
}

main().catch((error) => {
  console.error(`test-dex-workspace-config failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
