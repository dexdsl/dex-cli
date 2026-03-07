#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_POLICY_PATH = path.join(ROOT, 'scripts', 'data', 'cloudflare-secret-rotation-policy.json');

function toText(value) {
  return String(value ?? '').trim();
}

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseIsoDate(value) {
  const raw = toText(value);
  if (!raw) return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function readPolicy(policyPath) {
  const absolute = path.resolve(policyPath || DEFAULT_POLICY_PATH);
  const source = await fs.readFile(absolute, 'utf8');
  const parsed = JSON.parse(source);
  const secrets = Array.isArray(parsed.requiredSecrets) ? parsed.requiredSecrets : [];
  if (!secrets.length) {
    throw new Error(`No requiredSecrets in ${absolute}`);
  }
  return {
    policyPath: absolute,
    workerName: toText(parsed.workerName || process.env.CF_WORKER_NAME || 'dex-api'),
    defaultMaxAgeDays: parseNumber(parsed.defaultMaxAgeDays, 90),
    requiredSecrets: secrets.map((entry) => ({
      name: toText(entry.name),
      rotatedAtEnv: toText(entry.rotatedAtEnv),
      maxAgeDays: parseNumber(entry.maxAgeDays, parseNumber(parsed.defaultMaxAgeDays, 90)),
    })),
  };
}

async function fetchWorkerSecretNames({ accountId, apiToken, workerName }) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/secrets`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Cloudflare secret lookup failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }
  const result = Array.isArray(payload?.result) ? payload.result : [];
  return new Set(
    result
      .map((entry) => toText(entry?.name))
      .filter(Boolean),
  );
}

async function main() {
  const policyArg = process.argv.find((arg) => arg.startsWith('--policy='));
  const policyPath = policyArg ? policyArg.slice('--policy='.length) : DEFAULT_POLICY_PATH;
  const policy = await readPolicy(policyPath);
  const nowMs = Date.now();

  const accountId = toText(process.env.CF_ACCOUNT_ID);
  const apiToken = toText(process.env.CF_API_TOKEN);

  if (!accountId) throw new Error('Missing CF_ACCOUNT_ID');
  if (!apiToken) throw new Error('Missing CF_API_TOKEN');
  if (!policy.workerName) throw new Error('Missing workerName in policy');

  const remoteNames = await fetchWorkerSecretNames({
    accountId,
    apiToken,
    workerName: policy.workerName,
  });

  const violations = [];
  const rows = [];
  for (const secret of policy.requiredSecrets) {
    if (!secret.name) {
      violations.push(`Policy entry missing secret name in ${policy.policyPath}`);
      continue;
    }
    if (!remoteNames.has(secret.name)) {
      violations.push(`Worker secret missing in Cloudflare: ${secret.name}`);
    }

    const rotatedAtRaw = toText(process.env[secret.rotatedAtEnv]);
    const rotatedAtMs = parseIsoDate(rotatedAtRaw);
    if (!secret.rotatedAtEnv) {
      violations.push(`Policy missing rotatedAtEnv for ${secret.name}`);
      continue;
    }
    if (!rotatedAtRaw || Number.isNaN(rotatedAtMs)) {
      violations.push(`Missing or invalid ${secret.rotatedAtEnv} for ${secret.name}`);
      continue;
    }

    const ageDays = (nowMs - rotatedAtMs) / (24 * 60 * 60 * 1000);
    const maxAgeDays = parseNumber(secret.maxAgeDays, policy.defaultMaxAgeDays);
    rows.push({
      name: secret.name,
      rotatedAtEnv: secret.rotatedAtEnv,
      rotatedAt: rotatedAtRaw,
      ageDays,
      maxAgeDays,
    });
    if (ageDays > maxAgeDays) {
      violations.push(
        `${secret.name} is stale (${ageDays.toFixed(1)} days > ${maxAgeDays} days, via ${secret.rotatedAtEnv})`,
      );
    }
  }

  console.log(`Cloudflare worker: ${policy.workerName}`);
  console.log(`Policy: ${path.relative(ROOT, policy.policyPath)}`);
  for (const row of rows) {
    console.log(
      `- ${row.name}: rotated ${row.rotatedAt} (${row.ageDays.toFixed(1)}d old, max ${row.maxAgeDays}d)`,
    );
  }

  if (violations.length > 0) {
    console.error('Rotation check failed:');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log('Rotation check passed.');
}

main().catch((error) => {
  console.error(`verify_cloudflare_secret_rotation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

