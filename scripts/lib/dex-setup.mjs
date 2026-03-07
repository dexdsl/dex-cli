import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import {
  buildWorkspaceConfig,
  isGitRepoRoot,
  readWorkspaceConfig,
  validateRepoRoot,
  writeWorkspaceConfig,
  WORKSPACE_REPOS,
} from './dex-workspace-config.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const REPO_META = {
  site: {
    label: 'dexdsl.github.io',
    envVar: 'DEX_SITE_REPO_URL',
    fallbackUrl: '',
    fallbackDirName: 'dexdsl.github.io',
  },
  api: {
    label: 'dex-api',
    envVar: 'DEX_API_REPO_URL',
    fallbackUrl: '',
    fallbackDirName: 'dex-api',
  },
};

function toText(value) {
  return String(value == null ? '' : value).trim();
}

function createSetupError(message, code = 'DEX_SETUP_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function spawnResult(command, args = [], options = {}) {
  return spawnSync(command, args, {
    stdio: options.stdio || 'pipe',
    encoding: options.encoding || 'utf8',
    cwd: options.cwd,
  });
}

function isGhAvailable() {
  const probe = spawnResult('gh', ['--version']);
  return probe.status === 0;
}

function isGhAuthenticated() {
  const probe = spawnResult('gh', ['auth', 'status']);
  return probe.status === 0;
}

function deriveDefaultSiteRepoUrl() {
  const env = toText(process.env.DEX_SITE_REPO_URL);
  if (env) return env;
  const remote = spawnResult('git', ['-C', SCRIPT_ROOT, 'config', '--get', 'remote.origin.url']);
  const value = toText(remote.stdout);
  return value || '';
}

function deriveDefaultApiRepoUrl(siteRepoUrl = '') {
  const env = toText(process.env.DEX_API_REPO_URL);
  if (env) return env;
  const site = toText(siteRepoUrl);
  if (site.includes('dexdsl.github.io')) return site.replace('dexdsl.github.io', 'dex-api');
  return '';
}

function inferDirNameFromRepoUrl(url, fallback) {
  const source = toText(url);
  if (!source) return fallback;
  const withoutGit = source.replace(/\.git$/i, '');
  const tail = withoutGit.split('/').pop() || '';
  const clean = tail.replace(/[^A-Za-z0-9._-]/g, '').trim();
  return clean || fallback;
}

function resolveDefaultRoot({ currentConfig, repoKey }) {
  const configured = toText(currentConfig?.repos?.[repoKey]?.root);
  if (configured) return path.resolve(configured);
  const cwd = path.resolve(process.cwd());
  const basename = path.basename(cwd).toLowerCase();
  const expected = toText(REPO_META[repoKey]?.fallbackDirName).toLowerCase();
  if (basename === expected) return cwd;
  return path.join(os.homedir(), REPO_META[repoKey]?.fallbackDirName || repoKey);
}

async function promptExistingPath(repoKey, initialPath) {
  const meta = REPO_META[repoKey] || { label: repoKey };
  const answer = await prompts({
    type: 'text',
    name: 'rootPath',
    message: `${meta.label} local repo path:`,
    initial: initialPath,
    validate: async (value) => {
      const checked = await validateRepoRoot(value, { label: `${meta.label} repo path` });
      return checked.ok || checked.issue;
    },
  });
  const rootPath = toText(answer.rootPath);
  if (!rootPath) throw new Error(`Cancelled ${meta.label} path setup`);
  return path.resolve(rootPath);
}

async function ensureGhAuthInteractive() {
  if (!isGhAvailable()) {
    return {
      ok: false,
      issue: 'GitHub CLI (gh) is not installed. Install gh or choose existing local path.',
    };
  }
  if (isGhAuthenticated()) return { ok: true, issue: '' };
  const authPrompt = await prompts({
    type: 'confirm',
    name: 'login',
    message: 'GitHub CLI is not authenticated. Run gh auth login now?',
    initial: true,
  });
  if (!authPrompt.login) {
    return { ok: false, issue: 'GitHub authentication is required for guided clone.' };
  }
  const login = spawnResult('gh', ['auth', 'login'], { stdio: 'inherit' });
  if (login.status !== 0) {
    return { ok: false, issue: 'gh auth login failed. Please retry or choose existing local path.' };
  }
  if (!isGhAuthenticated()) {
    return { ok: false, issue: 'gh auth status still unauthenticated after login.' };
  }
  return { ok: true, issue: '' };
}

async function promptClonePath(repoKey, { defaultUrl, defaultRoot }) {
  const meta = REPO_META[repoKey] || { label: repoKey, fallbackDirName: repoKey };
  const auth = await ensureGhAuthInteractive();
  if (!auth.ok) throw new Error(auth.issue);

  const response = await prompts([
    {
      type: 'text',
      name: 'repoUrl',
      message: `${meta.label} repo URL:`,
      initial: defaultUrl,
      validate: (value) => (toText(value) ? true : 'Repo URL is required'),
    },
    {
      type: 'text',
      name: 'parentDir',
      message: `${meta.label} clone parent directory:`,
      initial: path.dirname(defaultRoot),
      validate: (value) => (toText(value) ? true : 'Parent directory is required'),
    },
    {
      type: 'text',
      name: 'dirName',
      message: `${meta.label} folder name:`,
      initial: inferDirNameFromRepoUrl(defaultUrl, meta.fallbackDirName || repoKey),
      validate: (value) => (toText(value) ? true : 'Folder name is required'),
    },
  ]);

  const repoUrl = toText(response.repoUrl);
  const parentDir = path.resolve(toText(response.parentDir));
  const dirName = toText(response.dirName);
  if (!repoUrl || !parentDir || !dirName) throw new Error(`Cancelled ${meta.label} clone setup`);

  const targetRoot = path.resolve(parentDir, dirName);
  const clone = spawnResult('gh', ['repo', 'clone', repoUrl, targetRoot], { stdio: 'inherit' });
  if (clone.status !== 0) {
    throw new Error(`gh repo clone failed for ${repoUrl}`);
  }

  const checked = await validateRepoRoot(targetRoot, { label: `${meta.label} clone` });
  if (!checked.ok) throw new Error(checked.issue);
  return {
    root: checked.root,
    repoUrl,
  };
}

async function configureRepoInteractive(repoKey, currentConfig, defaults = {}) {
  const meta = REPO_META[repoKey] || { label: repoKey };
  const existingRoot = resolveDefaultRoot({ currentConfig, repoKey });
  const defaultUrl = toText(defaults.repoUrl || '');

  const mode = await prompts({
    type: 'select',
    name: 'mode',
    message: `Configure ${meta.label}:`,
    choices: [
      { title: 'Use existing local repo path', value: 'path' },
      { title: 'Clone repository (guided)', value: 'clone' },
    ],
    initial: 0,
  });

  if (!mode.mode) throw new Error(`Cancelled ${meta.label} setup`);
  if (mode.mode === 'path') {
    const root = await promptExistingPath(repoKey, existingRoot);
    return { root, repoUrl: defaultUrl };
  }
  return promptClonePath(repoKey, { defaultUrl, defaultRoot: existingRoot });
}

export async function runDexSetup({
  reset = false,
  requestedRepo = 'site',
  filePath,
} = {}) {
  const existing = await readWorkspaceConfig({ filePath });
  const currentConfig = reset ? {} : (existing.config || {});
  const resetExisting = Boolean(reset && existing.exists);

  const intro = await prompts({
    type: 'confirm',
    name: 'continueSetup',
    message: resetExisting
      ? 'Reset and reconfigure dex workspace roots now?'
      : 'Configure dex workspace roots for dexdsl.github.io and dex-api?',
    initial: true,
  });
  if (!intro.continueSetup) {
    throw createSetupError('Workspace setup cancelled.', 'DEX_SETUP_CANCELLED');
  }

  const defaultSiteRepoUrl = deriveDefaultSiteRepoUrl();
  const defaultApiRepoUrl = deriveDefaultApiRepoUrl(defaultSiteRepoUrl);

  const site = await configureRepoInteractive('site', currentConfig, {
    repoUrl: defaultSiteRepoUrl,
  });
  const api = await configureRepoInteractive('api', currentConfig, {
    repoUrl: defaultApiRepoUrl,
  });

  const defaultRepoPrompt = await prompts({
    type: 'select',
    name: 'defaultRepo',
    message: 'Default repo root for dex commands:',
    choices: [
      { title: 'site (dexdsl.github.io)', value: 'site' },
      { title: 'api (dex-api)', value: 'api' },
    ],
    initial: requestedRepo === 'api' ? 1 : 0,
  });

  const defaultRepo = WORKSPACE_REPOS.includes(toText(defaultRepoPrompt.defaultRepo))
    ? toText(defaultRepoPrompt.defaultRepo)
    : 'site';

  const config = buildWorkspaceConfig({
    siteRoot: site.root,
    apiRoot: api.root,
    defaultRepo,
  });

  const written = await writeWorkspaceConfig(config, { filePath });
  return {
    filePath: written.filePath,
    config: written.config,
    requestedRepo: WORKSPACE_REPOS.includes(toText(requestedRepo)) ? requestedRepo : defaultRepo,
  };
}

export async function ensureWorkspaceConfig({
  requestedRepo = 'site',
  filePath,
  interactive = process.stdout.isTTY && process.stdin.isTTY,
  autoSetup = true,
} = {}) {
  let loaded = await readWorkspaceConfig({ filePath });
  if (loaded.ok) {
    return {
      ok: true,
      filePath: loaded.filePath,
      config: loaded.config,
      ranSetup: false,
      reason: '',
    };
  }

  if (!interactive || !autoSetup) {
    return {
      ok: false,
      filePath: loaded.filePath,
      config: loaded.config,
      ranSetup: false,
      reason: `Workspace config missing/invalid. Run: dex setup (${loaded.issues.join('; ')})`,
    };
  }

  let setup;
  try {
    setup = await runDexSetup({
      requestedRepo,
      filePath,
      reset: false,
    });
  } catch (error) {
    const message = toText(error?.message) || 'Workspace setup failed.';
    const cancelled = toText(error?.code) === 'DEX_SETUP_CANCELLED'
      || /cancelled/i.test(message);
    return {
      ok: false,
      filePath: loaded.filePath,
      config: loaded.config,
      ranSetup: false,
      reason: cancelled
        ? 'Workspace setup cancelled. Run `dex setup` when ready.'
        : `Workspace setup failed. Run: dex setup (${message})`,
    };
  }

  loaded = await readWorkspaceConfig({ filePath: setup.filePath });
  if (!loaded.ok) {
    return {
      ok: false,
      filePath: loaded.filePath,
      config: loaded.config,
      ranSetup: true,
      reason: `Workspace config remains invalid after setup: ${loaded.issues.join('; ')}`,
    };
  }

  return {
    ok: true,
    filePath: loaded.filePath,
    config: loaded.config,
    ranSetup: true,
    reason: '',
  };
}

export async function quickValidateWorkspaceRoots(config = {}) {
  const siteRoot = toText(config?.repos?.site?.root);
  const apiRoot = toText(config?.repos?.api?.root);
  return {
    site: await isGitRepoRoot(siteRoot),
    api: await isGitRepoRoot(apiRoot),
  };
}
