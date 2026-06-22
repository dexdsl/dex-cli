#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildDexCommandArgs,
  getDexCommand,
  registryPayload,
  validateDexRunRequest,
} from './lib/dex-command-registry.mjs';
import {
  readWorkspaceConfig,
  resolveRepoRoot,
  WORKSPACE_REPOS,
} from './lib/dex-workspace-config.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEX_ENTRY = path.join(SCRIPT_DIR, 'dex.mjs');

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseRepo(argv = []) {
  const idx = argv.indexOf('--repo');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return 'site';
}

async function readJsonArg(raw) {
  if (raw && raw !== '-') return JSON.parse(raw);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function workspacePayload(repo = 'site') {
  try {
    const configState = await readWorkspaceConfig();
    const selected = resolveRepoRoot(configState.config, repo);
    return {
      ok: configState.ok,
      activeRepo: selected.repo || repo,
      activeRoot: selected.root || '',
      configPath: configState.filePath || '',
      configExists: configState.exists,
      issues: configState.issues || [],
      repos: configState.config?.repos || {},
      defaultRepo: configState.config?.defaultRepo || 'site',
      supportedRepos: WORKSPACE_REPOS,
    };
  } catch (error) {
    return {
      ok: false,
      activeRepo: repo,
      activeRoot: '',
      configPath: '',
      configExists: false,
      issues: [error?.message || String(error)],
      repos: {},
      defaultRepo: 'site',
      supportedRepos: WORKSPACE_REPOS,
    };
  }
}

function splitLines(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line) onLine(line);
    }
  };
}

async function runDex(request = {}) {
  const validation = validateDexRunRequest(request);
  const command = validation.command || getDexCommand(request.commandId);
  const runId = request.runId || `run-${Date.now()}`;
  if (!validation.ok) {
    emit({
      runId,
      type: validation.confirmationRequired ? 'confirmation-required' : 'error',
      commandId: request.commandId || '',
      error: validation.error,
      confirmationRequired: !!validation.confirmationRequired,
    });
    process.exit(2);
  }

  const repo = request.repo || 'site';
  const args = buildDexCommandArgs(request.commandId, request.values || {}, { dryRun: !!request.dryRun });
  const routedArgs = ['--repo', repo, ...args];
  emit({
    runId,
    type: 'start',
    commandId: request.commandId,
    label: command.label,
    danger: command.danger,
    args: routedArgs,
    cwd: APP_ROOT,
    dryRun: !!request.dryRun,
  });

  const child = spawn(process.execPath, [DEX_ENTRY, ...routedArgs], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      DEX_NO_ANIM: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', splitLines((line) => {
    emit({ runId, type: 'stdout', commandId: request.commandId, text: line });
  }));
  child.stderr.on('data', splitLines((line) => {
    emit({ runId, type: 'stderr', commandId: request.commandId, text: line });
  }));
  child.on('error', (error) => {
    emit({ runId, type: 'error', commandId: request.commandId, error: error?.message || String(error) });
  });
  child.on('close', (code, signal) => {
    emit({
      runId,
      type: code === 0 ? 'result' : 'error',
      commandId: request.commandId,
      exitCode: code,
      signal,
      ok: code === 0,
      error: code === 0 ? '' : `Command exited with code ${code}`,
    });
    process.exit(code ?? 1);
  });
}

async function main() {
  const [mode = 'help', ...rest] = process.argv.slice(2);
  if (mode === 'registry') {
    console.log(JSON.stringify(registryPayload(), null, 2));
    return;
  }
  if (mode === 'workspace') {
    console.log(JSON.stringify(await workspacePayload(parseRepo(rest)), null, 2));
    return;
  }
  if (mode === 'run') {
    const request = await readJsonArg(rest[0]);
    await runDex(request);
    return;
  }
  if (mode === 'root') {
    const packageJsonPath = path.join(APP_ROOT, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    console.log(JSON.stringify({ root: APP_ROOT, version: packageJson.version || 'dev' }, null, 2));
    return;
  }
  console.log('Usage: node scripts/dex-gui-bridge.mjs <registry|workspace|run|root>');
}

main().catch((error) => {
  emit({ type: 'error', error: error?.stack || error?.message || String(error) });
  process.exit(1);
});
