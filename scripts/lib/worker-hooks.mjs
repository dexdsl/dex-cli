const DEFAULT_API_BY_ENV = {
  prod: 'https://dex-api.spring-fog-8edd.workers.dev',
  test: 'https://dex-api.spring-fog-8edd.workers.dev',
};

function nowIso() {
  return new Date().toISOString();
}

function toText(value) {
  return String(value ?? '').trim();
}

function normalizeEnv(value) {
  const raw = toText(value).toLowerCase();
  if (raw === 'prod' || raw === 'production') return 'prod';
  if (raw === 'test' || raw === 'staging' || raw === 'sandbox') return 'test';
  throw new Error(`Unsupported events env: ${value}`);
}

function normalizePath(value) {
  const raw = toText(value);
  if (!raw) return '/';
  if (/^https?:\/\//i.test(raw)) return '/';
  if (raw.startsWith('//')) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeApiBase(value) {
  const parsed = new URL(toText(value));
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported events API protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function parseBooleanEnv(value) {
  const raw = toText(value).toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function resolveEventsEnv(value = process.env.DEX_EVENTS_ENV || 'prod') {
  return normalizeEnv(value);
}

export function resolveEventsApiBase(env = resolveEventsEnv()) {
  const normalized = normalizeEnv(env);
  const fromEnv = normalized === 'prod'
    ? process.env.DEX_EVENT_HOOK_API_BASE_PROD
      || process.env.DEX_API_BASE_PROD
      || process.env.DEX_API_BASE_URL
    : process.env.DEX_EVENT_HOOK_API_BASE_TEST
      || process.env.DEX_API_BASE_TEST
      || process.env.DEX_API_BASE_URL;
  return normalizeApiBase(fromEnv || DEFAULT_API_BY_ENV[normalized]);
}

export function resolveEventIngestToken(env = resolveEventsEnv()) {
  const normalized = normalizeEnv(env);
  const direct = normalized === 'prod'
    ? process.env.DEX_EVENT_INGEST_TOKEN_PROD || process.env.EVENT_INGEST_TOKEN_PROD
    : process.env.DEX_EVENT_INGEST_TOKEN_TEST || process.env.EVENT_INGEST_TOKEN_TEST;
  const shared = process.env.DEX_EVENT_INGEST_TOKEN || process.env.EVENT_INGEST_TOKEN;
  const token = toText(direct || shared);
  return token || '';
}

export function hooksStrictModeEnabled() {
  return parseBooleanEnv(process.env.DEX_EVENT_HOOKS_STRICT);
}

async function jsonFromResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function postWorkerHook(
  hookPath,
  payload,
  {
    env = resolveEventsEnv(),
    timeoutMs = 9000,
    requiredToken = false,
    strict = hooksStrictModeEnabled(),
  } = {},
) {
  const normalizedEnv = normalizeEnv(env);
  const token = resolveEventIngestToken(normalizedEnv);
  if (!token) {
    if (requiredToken || strict) {
      throw new Error(
        `Missing EVENT_INGEST_TOKEN for ${normalizedEnv}. Set DEX_EVENT_INGEST_TOKEN_${normalizedEnv.toUpperCase()} or DEX_EVENT_INGEST_TOKEN.`,
      );
    }
    return {
      ok: false,
      skipped: true,
      reason: 'missing-token',
      env: normalizedEnv,
      path: normalizePath(hookPath),
    };
  }

  const apiBase = resolveEventsApiBase(normalizedEnv);
  const path = normalizePath(hookPath);
  const url = `${apiBase}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const body = await jsonFromResponse(response);
    if (!response.ok) {
      const detail = `Hook ${path} failed (${response.status}): ${JSON.stringify(body)}`;
      if (strict) throw new Error(detail);
      return {
        ok: false,
        skipped: false,
        status: response.status,
        env: normalizedEnv,
        path,
        body,
      };
    }
    return {
      ok: true,
      skipped: false,
      status: response.status,
      env: normalizedEnv,
      path,
      body,
    };
  } catch (error) {
    if (strict) throw error;
    return {
      ok: false,
      skipped: false,
      status: 0,
      env: normalizedEnv,
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseIso(value) {
  const parsed = Date.parse(toText(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function inferPollPhase(poll) {
  const status = toText(poll?.status).toLowerCase();
  if (status === 'closed') return 'closed';
  if (status !== 'open') return '';
  const closeAtMs = Date.parse(toText(poll?.closeAt));
  if (Number.isFinite(closeAtMs)) {
    const msUntilClose = closeAtMs - Date.now();
    if (msUntilClose <= 24 * 60 * 60 * 1000) return 'closing_soon';
  }
  return 'opened';
}

function pollHref(poll) {
  const slug = toText(poll?.slug);
  const id = toText(poll?.id);
  const token = slug || id;
  if (!token) return '/polls/';
  return `/polls/${encodeURIComponent(token)}/`;
}

export async function emitPollLifecycleHooks({ env = resolveEventsEnv(), polls = [], updatedAt } = {}) {
  const list = Array.isArray(polls) ? polls : [];
  const out = {
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    env: normalizeEnv(env),
    results: [],
  };
  for (const poll of list) {
    const pollId = toText(poll?.id);
    const phase = inferPollPhase(poll);
    if (!pollId || !phase) {
      out.skipped += 1;
      continue;
    }
    out.attempted += 1;
    const createdAt = parseIso(poll?.updatedAt || updatedAt || nowIso()) || nowIso();
    const result = await postWorkerHook('/hooks/polls/lifecycle', {
      id: `poll:${pollId}:${phase}:${createdAt.slice(0, 19)}`,
      broadcast: true,
      pollId,
      phase,
      question: toText(poll?.question) || 'Poll update available.',
      href: pollHref(poll),
      createdAt,
      metadata: {
        closeAt: parseIso(poll?.closeAt),
        source: 'polls-publish',
      },
    }, { env });
    out.results.push({ pollId, phase, result });
    if (result.ok) out.sent += 1;
    else if (result.skipped) out.skipped += 1;
    else out.failed += 1;
  }
  return out;
}

function normalizeIncidentState(value) {
  const state = toText(value).toLowerCase();
  if (state === 'resolved') return 'resolved';
  return 'started';
}

export async function emitStatusIncidentHook({ env = resolveEventsEnv(), incident, state } = {}) {
  const safeIncident = incident && typeof incident === 'object' ? incident : {};
  const incidentId = toText(safeIncident.id);
  if (!incidentId) {
    return { ok: false, skipped: true, reason: 'missing-incident-id' };
  }
  const normalizedState = normalizeIncidentState(state || safeIncident.state);
  const createdAt = parseIso(safeIncident.updatedAt || safeIncident.startedAt || nowIso()) || nowIso();
  return postWorkerHook('/hooks/status/incident', {
    id: `status:${incidentId}:${normalizedState}:${createdAt.slice(0, 19)}`,
    broadcast: true,
    incidentId,
    state: normalizedState,
    title: toText(safeIncident.title) || 'Status incident update',
    summary: toText(safeIncident.summary) || 'Status incident update recorded.',
    impact: toText(safeIncident.impact) || 'minor',
    href: normalizePath(safeIncident.link || '/support/'),
    components: Array.isArray(safeIncident.components) ? safeIncident.components : [],
    createdAt,
    metadata: {
      source: 'status-manager',
    },
  }, { env });
}

function normalizeTagValues(entry) {
  const tags = Array.isArray(entry?.tags_raw) ? entry.tags_raw : [];
  return tags
    .flatMap((tag) => {
      if (!tag || typeof tag !== 'object') return [];
      return [toText(tag.slug_raw).toLowerCase(), toText(tag.label_raw).toLowerCase()].filter(Boolean);
    });
}

function classifyAnnouncementKind(entry) {
  const category = toText(entry?.category_slug_raw || entry?.category_label_raw).toLowerCase();
  const tags = normalizeTagValues(entry);
  const joined = `${category} ${tags.join(' ')}`;
  if (/(release|changelog|release[-_\s]?notes?)/.test(joined)) return 'release';
  if (/(announcement|announce|news|update)/.test(joined)) return 'announcement';
  return '';
}

function parseLookbackDays(value, fallback = 14) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(3650, Math.floor(parsed)));
}

export async function emitAnnouncementPublishHooks({ env = resolveEventsEnv(), entries = [] } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const includeAll = parseBooleanEnv(process.env.DEX_ANNOUNCEMENT_HOOK_ALL);
  const lookbackDays = parseLookbackDays(process.env.DEX_ANNOUNCEMENT_HOOK_LOOKBACK_DAYS, 14);
  const windowStartMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const out = {
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    env: normalizeEnv(env),
    results: [],
  };

  for (const entry of list) {
    const slug = toText(entry?.slug);
    if (!slug) {
      out.skipped += 1;
      continue;
    }
    const kind = classifyAnnouncementKind(entry);
    if (!kind) {
      out.skipped += 1;
      continue;
    }
    const publishedAtIso = parseIso(entry?.published_at_iso || entry?.generated_at || nowIso()) || nowIso();
    const publishedAtMs = Date.parse(publishedAtIso);
    if (!includeAll && Number.isFinite(publishedAtMs) && publishedAtMs < windowStartMs) {
      out.skipped += 1;
      continue;
    }

    out.attempted += 1;
    const payload = {
      id: `dexnotes:${kind}:${slug}:${publishedAtIso.slice(0, 10)}`,
      broadcast: true,
      kind,
      slug,
      title: toText(entry?.title_raw) || 'Dex update',
      body: toText(entry?.excerpt_raw) || 'A new update was published.',
      href: normalizePath(entry?.route_path || `/dexnotes/${slug}/`),
      createdAt: publishedAtIso,
      metadata: {
        category: toText(entry?.category_slug_raw || entry?.category_label_raw),
        tags: normalizeTagValues(entry),
        source: 'dexnotes-build',
      },
    };
    const result = await postWorkerHook('/hooks/announcements/publish', payload, { env });
    out.results.push({ slug, kind, result });
    if (result.ok) out.sent += 1;
    else if (result.skipped) out.skipped += 1;
    else out.failed += 1;
  }
  return out;
}

export async function emitAchievementMilestoneHook({
  env = resolveEventsEnv(),
  auth0Sub,
  badgeId,
  badgeTitle,
  level,
  href = '/entry/achievements/',
  metadata = {},
} = {}) {
  const sub = toText(auth0Sub);
  if (!sub) {
    return { ok: false, skipped: true, reason: 'missing-auth0-sub' };
  }
  const createdAt = nowIso();
  return postWorkerHook('/hooks/achievements/milestone', {
    id: `achievement:${sub}:${toText(badgeId || badgeTitle || 'badge')}:${toText(level || 'base')}:${createdAt.slice(0, 10)}`,
    auth0Sub: sub,
    badgeId: toText(badgeId),
    badgeTitle: toText(badgeTitle) || 'Achievement milestone reached',
    level: toText(level) || 'base',
    href: normalizePath(href),
    createdAt,
    metadata: {
      source: 'achievements-job',
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
    },
  }, { env, requiredToken: true });
}
