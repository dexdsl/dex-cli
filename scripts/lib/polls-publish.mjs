import { readPollsFile } from './polls-store.mjs';
import { emitPollLifecycleHooks, resolveEventsEnv } from './worker-hooks.mjs';

const DEFAULT_API_BY_ENV = {
  prod: 'https://dex-api.spring-fog-8edd.workers.dev',
  test: 'https://dex-api.spring-fog-8edd.workers.dev',
};

function normalizeEnv(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'prod' || raw === 'production') return 'prod';
  if (raw === 'test' || raw === 'sandbox' || raw === 'staging') return 'test';
  throw new Error(`Unsupported publish env: ${value}`);
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported API protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function resolveApiBase(envName) {
  const env = normalizeEnv(envName);
  const fromEnv = env === 'prod'
    ? process.env.DEX_POLLS_API_BASE_PROD || process.env.DEX_API_BASE_PROD || process.env.DEX_API_BASE_URL
    : process.env.DEX_POLLS_API_BASE_TEST || process.env.DEX_API_BASE_TEST || process.env.DEX_API_BASE_URL;
  const fallback = DEFAULT_API_BY_ENV[env];
  return normalizeBaseUrl(fromEnv || fallback);
}

function resolveAdminToken(envName) {
  const env = normalizeEnv(envName);
  const direct = env === 'prod'
    ? process.env.DEX_POLLS_ADMIN_TOKEN_PROD || process.env.DEX_POLLS_SYNC_ADMIN_TOKEN_PROD || process.env.POLL_SYNC_ADMIN_TOKEN_PROD
    : process.env.DEX_POLLS_ADMIN_TOKEN_TEST || process.env.DEX_POLLS_SYNC_ADMIN_TOKEN_TEST || process.env.POLL_SYNC_ADMIN_TOKEN_TEST;
  const shared = process.env.DEX_POLLS_ADMIN_TOKEN
    || process.env.DEX_POLLS_SYNC_ADMIN_TOKEN
    || process.env.POLL_SYNC_ADMIN_TOKEN
    || process.env.DEX_MAINTENANCE_TOKEN;
  const token = direct || shared;
  if (!token) {
    throw new Error(
      `Missing polls admin token for ${env}. Set DEX_POLLS_ADMIN_TOKEN_${env.toUpperCase()} (or DEX_POLLS_SYNC_ADMIN_TOKEN_${env.toUpperCase()}, or shared DEX_POLLS_ADMIN_TOKEN / DEX_POLLS_SYNC_ADMIN_TOKEN / DEX_MAINTENANCE_TOKEN).`,
    );
  }
  return String(token).trim();
}

export async function publishPolls({ env = 'test', filePath } = {}) {
  const { data } = await readPollsFile(filePath);
  const apiBase = resolveApiBase(env);
  const token = resolveAdminToken(env);
  const syncUrl = `${apiBase}/admin/polls/sync`;

  const response = await fetch(syncUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      version: data.version,
      updatedAt: data.updatedAt,
      polls: data.polls,
    }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Poll sync failed (${response.status}) at ${syncUrl}: ${typeof payload === 'object' ? JSON.stringify(payload) : String(payload)}`,
    );
  }

  let events = null;
  try {
    events = await emitPollLifecycleHooks({
      env: resolveEventsEnv(process.env.DEX_POLLS_EVENTS_ENV || env),
      polls: Array.isArray(data.polls) ? data.polls : [],
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    events = { attempted: 0, sent: 0, failed: 1, skipped: 0, error: reason };
  }

  return {
    env: normalizeEnv(env),
    apiBase,
    count: Array.isArray(data.polls) ? data.polls.length : 0,
    payload,
    events,
  };
}
