import crypto from 'node:crypto';

const DEFAULT_API_BY_ENV = {
  prod: 'https://dex-api.spring-fog-8edd.workers.dev',
  test: 'https://dex-api.spring-fog-8edd.workers.dev',
};

function toText(value) {
  return String(value ?? '').trim();
}

export function normalizePollsEnv(value) {
  const raw = toText(value).toLowerCase();
  if (!raw || raw === 'test' || raw === 'sandbox' || raw === 'staging') return 'test';
  if (raw === 'prod' || raw === 'production') return 'prod';
  throw new Error(`Unsupported polls env: ${value}`);
}

export function normalizeApiBase(value) {
  const parsed = new URL(toText(value));
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported API protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function resolvePollsApiBase(envName = 'test') {
  const env = normalizePollsEnv(envName);
  const fromEnv = env === 'prod'
    ? process.env.DEX_POLLS_API_BASE_PROD || process.env.DEX_API_BASE_PROD || process.env.DEX_API_BASE_URL
    : process.env.DEX_POLLS_API_BASE_TEST || process.env.DEX_API_BASE_TEST || process.env.DEX_API_BASE_URL;
  return normalizeApiBase(fromEnv || DEFAULT_API_BY_ENV[env]);
}

export function resolvePollsAdminToken(envName = 'test') {
  const env = normalizePollsEnv(envName);
  const direct = env === 'prod'
    ? process.env.DEX_POLLS_ADMIN_TOKEN_PROD || process.env.DEX_POLLS_SYNC_ADMIN_TOKEN_PROD || process.env.POLL_SYNC_ADMIN_TOKEN_PROD
    : process.env.DEX_POLLS_ADMIN_TOKEN_TEST || process.env.DEX_POLLS_SYNC_ADMIN_TOKEN_TEST || process.env.POLL_SYNC_ADMIN_TOKEN_TEST;
  const shared = process.env.DEX_POLLS_ADMIN_TOKEN
    || process.env.DEX_POLLS_SYNC_ADMIN_TOKEN
    || process.env.POLL_SYNC_ADMIN_TOKEN
    || process.env.DEX_MAINTENANCE_TOKEN;
  const token = toText(direct || shared);
  if (!token) {
    throw new Error(
      `Missing polls admin token for ${env}. Set DEX_POLLS_ADMIN_TOKEN_${env.toUpperCase()} (or DEX_POLLS_SYNC_ADMIN_TOKEN_${env.toUpperCase()}, or shared DEX_POLLS_ADMIN_TOKEN / DEX_POLLS_SYNC_ADMIN_TOKEN / DEX_MAINTENANCE_TOKEN).`,
    );
  }
  return token;
}

function parseResponseText(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function serializeQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null) continue;
    const value = toText(rawValue);
    if (!value) continue;
    params.set(key, value);
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}

async function requestPollsApi(pathname, {
  env = 'test',
  method = 'GET',
  query = null,
  body = null,
  admin = false,
  idempotencyKey = '',
} = {}) {
  const resolvedEnv = normalizePollsEnv(env);
  const apiBase = resolvePollsApiBase(resolvedEnv);
  const requestId = crypto.randomUUID();
  const headers = {
    accept: 'application/json',
    'x-dx-request-id': requestId,
  };
  if (body != null) headers['content-type'] = 'application/json';
  if (admin) headers.authorization = `Bearer ${resolvePollsAdminToken(resolvedEnv)}`;
  if (idempotencyKey) headers['x-dx-idempotency-key'] = toText(idempotencyKey);

  const response = await fetch(`${apiBase}${pathname}${serializeQuery(query || {})}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = parseResponseText(text);
  if (!response.ok) {
    const detail = payload && typeof payload === 'object'
      ? JSON.stringify(payload)
      : String(payload || text || '');
    throw new Error(`${method} ${pathname} failed (${response.status}): ${detail}`);
  }
  return {
    env: resolvedEnv,
    apiBase,
    requestId,
    payload,
  };
}

function normalizeWindow(value, fallback = '30d') {
  const normalized = toText(value || fallback).toLowerCase();
  return ['7d', '30d', '90d', 'all'].includes(normalized) ? normalized : fallback;
}

function normalizePublicBucket(value, fallback = 'day') {
  const normalized = toText(value || fallback).toLowerCase();
  return ['day', 'week'].includes(normalized) ? normalized : fallback;
}

function normalizeAdminBucket(value, fallback = 'day') {
  const normalized = toText(value || fallback).toLowerCase();
  return ['hour', 'day', 'week'].includes(normalized) ? normalized : fallback;
}

export async function getAdminPollOverview({ env = 'test', window = '30d' } = {}) {
  return requestPollsApi('/admin/polls/overview', {
    env,
    admin: true,
    query: { window: normalizeWindow(window) },
  });
}

export async function getAdminPollLive({ pollId, env = 'test' } = {}) {
  const id = toText(pollId);
  if (!id) throw new Error('pollId is required');
  return requestPollsApi(`/admin/polls/${encodeURIComponent(id)}/live`, {
    env,
    admin: true,
  });
}

export async function getAdminPollTrend({ pollId, env = 'test', window = '90d', bucket = 'day' } = {}) {
  const id = toText(pollId);
  if (!id) throw new Error('pollId is required');
  return requestPollsApi(`/admin/polls/${encodeURIComponent(id)}/trends`, {
    env,
    admin: true,
    query: {
      window: normalizeWindow(window, '90d'),
      bucket: normalizeAdminBucket(bucket, 'day'),
    },
  });
}

export async function getAdminPollSnapshots({ pollId, env = 'test' } = {}) {
  const id = toText(pollId);
  if (!id) throw new Error('pollId is required');
  return requestPollsApi(`/admin/polls/${encodeURIComponent(id)}/snapshots`, {
    env,
    admin: true,
  });
}

export async function publishAdminPollSnapshot({
  pollId,
  env = 'test',
  summaryMarkdown,
  headline = '',
  publish = true,
  trendWindow = '90d',
  idempotencyKey = '',
} = {}) {
  const id = toText(pollId);
  if (!id) throw new Error('pollId is required');
  const summary = toText(summaryMarkdown);
  if (!summary) throw new Error('summaryMarkdown is required');
  return requestPollsApi(`/admin/polls/${encodeURIComponent(id)}/snapshots`, {
    env,
    method: 'POST',
    admin: true,
    idempotencyKey: toText(idempotencyKey) || crypto.randomUUID(),
    body: {
      summaryMarkdown: summary,
      headline: toText(headline),
      publish: publish !== false,
      trendWindow: normalizeWindow(trendWindow, '90d'),
    },
  });
}

export async function promoteAdminPollSnapshot({ pollId, version, env = 'test' } = {}) {
  const id = toText(pollId);
  if (!id) throw new Error('pollId is required');
  const normalizedVersion = Math.max(1, Math.trunc(Number(version) || 0));
  if (!normalizedVersion) throw new Error('version is required');
  return requestPollsApi(`/admin/polls/${encodeURIComponent(id)}/snapshots/${normalizedVersion}/promote`, {
    env,
    method: 'POST',
    admin: true,
    idempotencyKey: crypto.randomUUID(),
  });
}

export async function listPublishedPolls({ env = 'prod', page = 1, pageSize = 20 } = {}) {
  return requestPollsApi('/polls/published', {
    env,
    query: {
      page: Math.max(1, Math.trunc(Number(page) || 1)),
      pageSize: Math.max(1, Math.min(100, Math.trunc(Number(pageSize) || 20))),
    },
  });
}

export async function getPublicPollTrend({ pollId, env = 'prod', window = '90d', bucket = 'day' } = {}) {
  const id = toText(pollId);
  if (!id) throw new Error('pollId is required');
  return requestPollsApi(`/polls/${encodeURIComponent(id)}/trend`, {
    env,
    query: {
      window: normalizeWindow(window, '90d'),
      bucket: normalizePublicBucket(bucket, 'day'),
    },
  });
}

export async function getPublicPollResults({ pollId, env = 'prod' } = {}) {
  const id = toText(pollId);
  if (!id) throw new Error('pollId is required');
  return requestPollsApi(`/polls/${encodeURIComponent(id)}/results`, {
    env,
  });
}
