import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const WORKSPACE_CONFIG_VERSION = 'dex-workspaces-v1';
export const WORKSPACE_REPOS = ['site', 'api'];

function configHome() {
  const custom = String(process.env.DEX_CONFIG_DIR || '').trim();
  if (custom) return path.resolve(custom);
  if (process.platform === 'win32') {
    const appData = String(process.env.APPDATA || '').trim();
    if (appData) return appData;
    return path.join(os.homedir(), 'AppData', 'Roaming');
  }
  const xdg = String(process.env.XDG_CONFIG_HOME || '').trim();
  if (xdg) return xdg;
  return path.join(os.homedir(), '.config');
}

export function getWorkspaceConfigPath() {
  const custom = String(process.env.DEX_WORKSPACE_FILE || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(configHome(), 'dexdsl', 'workspaces.json');
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeRoot(value) {
  const raw = text(value);
  if (!raw) return '';
  return path.resolve(raw);
}

function normalizeRepoMap(repos = {}) {
  const out = {};
  for (const key of WORKSPACE_REPOS) {
    const root = normalizeRoot(repos?.[key]?.root || repos?.[key]);
    if (!root) continue;
    out[key] = { root };
  }
  return out;
}

export function normalizeWorkspaceConfig(raw = {}) {
  const repos = normalizeRepoMap(raw?.repos || {});
  const fallbackRepo = WORKSPACE_REPOS.find((key) => repos[key]?.root) || 'site';
  const defaultRepo = WORKSPACE_REPOS.includes(text(raw?.defaultRepo))
    ? text(raw.defaultRepo)
    : fallbackRepo;
  return {
    version: WORKSPACE_CONFIG_VERSION,
    updatedAt: text(raw?.updatedAt) || new Date().toISOString(),
    defaultRepo,
    repos,
  };
}

export function isSupportedRepoKey(value) {
  return WORKSPACE_REPOS.includes(text(value));
}

export function resolveRepoRoot(config = {}, repoKey = 'site') {
  const normalized = normalizeWorkspaceConfig(config);
  const preferred = isSupportedRepoKey(repoKey) ? repoKey : normalized.defaultRepo;
  const fallback = WORKSPACE_REPOS.find((key) => normalized.repos[key]?.root) || preferred;
  const chosen = normalized.repos[preferred]?.root ? preferred : fallback;
  return {
    repo: chosen,
    root: normalizeRoot(normalized.repos[chosen]?.root),
  };
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isGitRepoRoot(rootPath) {
  const root = normalizeRoot(rootPath);
  if (!root) return false;
  const dotGitPath = path.join(root, '.git');
  if (await pathExists(dotGitPath)) return true;
  const probe = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  });
  return probe.status === 0 && String(probe.stdout || '').trim() === 'true';
}

export async function validateRepoRoot(rootPath, { label = 'repo root' } = {}) {
  const root = normalizeRoot(rootPath);
  if (!root) {
    return { ok: false, root: '', issue: `${label} is required` };
  }
  if (!await pathExists(root)) {
    return { ok: false, root, issue: `${label} does not exist: ${root}` };
  }
  if (!await isGitRepoRoot(root)) {
    return { ok: false, root, issue: `${label} is not a git repository: ${root}` };
  }
  return { ok: true, root, issue: '' };
}

export async function validateWorkspaceConfig(config = {}, { requireRepos = WORKSPACE_REPOS } = {}) {
  const normalized = normalizeWorkspaceConfig(config);
  const issues = [];
  for (const repo of requireRepos) {
    const root = normalizeRoot(normalized.repos?.[repo]?.root);
    if (!root) {
      issues.push(`${repo} repo root is missing`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const checked = await validateRepoRoot(root, { label: `${repo} repo root` });
    if (!checked.ok) issues.push(checked.issue);
  }
  if (!isSupportedRepoKey(normalized.defaultRepo)) {
    issues.push(`defaultRepo must be one of ${WORKSPACE_REPOS.join(', ')}`);
  }
  return {
    ok: issues.length === 0,
    issues,
    config: normalized,
  };
}

export async function readWorkspaceConfig({ filePath } = {}) {
  const targetPath = filePath ? path.resolve(filePath) : getWorkspaceConfigPath();
  try {
    const source = await fs.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(source);
    const config = normalizeWorkspaceConfig(parsed);
    const validation = await validateWorkspaceConfig(config);
    return {
      filePath: targetPath,
      exists: true,
      config,
      ok: validation.ok,
      issues: validation.issues,
    };
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        filePath: targetPath,
        exists: false,
        config: normalizeWorkspaceConfig({}),
        ok: false,
        issues: ['workspace config not found'],
      };
    }
    throw error;
  }
}

export async function writeWorkspaceConfig(config = {}, { filePath } = {}) {
  const targetPath = filePath ? path.resolve(filePath) : getWorkspaceConfigPath();
  const normalized = normalizeWorkspaceConfig(config);
  normalized.updatedAt = new Date().toISOString();
  const validation = await validateWorkspaceConfig(normalized);
  if (!validation.ok) {
    throw new Error(`Invalid workspace config: ${validation.issues.join('; ')}`);
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return {
    filePath: targetPath,
    config: normalized,
  };
}

export function buildWorkspaceConfig({
  siteRoot,
  apiRoot,
  defaultRepo = 'site',
} = {}) {
  return normalizeWorkspaceConfig({
    repos: {
      site: { root: siteRoot },
      api: { root: apiRoot },
    },
    defaultRepo,
    updatedAt: new Date().toISOString(),
  });
}
