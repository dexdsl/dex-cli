import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const STATUS_LIVE_PATH = path.join(ROOT, 'docs', 'data', 'status.live.json');
const STATUS_FALLBACK_PATH = path.join(ROOT, 'docs', 'data', 'status.fallback.json');
const INCIDENTS_ROOT = path.join(ROOT, 'docs', 'status', 'incidents');

const STATUS_STATES = ['operational', 'degraded', 'outage', 'maintenance', 'unknown'];
const INCIDENT_STATES = ['investigating', 'identified', 'monitoring', 'resolved'];
const INCIDENT_IMPACTS = ['none', 'minor', 'major', 'critical'];
const DEFAULT_LIVE_MESSAGE = 'No incidents reported yet. Historical uptime windows are initializing.';
const DEFAULT_FALLBACK_MESSAGE = 'Live status feed is unavailable. Showing fallback launch snapshot.';

export const statusFilePaths = {
  live: STATUS_LIVE_PATH,
  fallback: STATUS_FALLBACK_PATH,
  incidentsRoot: INCIDENTS_ROOT,
};
export const incidentStateValues = INCIDENT_STATES;
export const incidentImpactValues = INCIDENT_IMPACTS;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value, maxLength = 240, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return text || fallback;
}

function normalizePath(value, fallback = '/support/') {
  const raw = normalizeText(value, 400, '');
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStatusState(value) {
  const state = normalizeText(value, 32, 'unknown').toLowerCase();
  return STATUS_STATES.includes(state) ? state : 'unknown';
}

function normalizeIncidentState(value) {
  const state = normalizeText(value, 32, 'investigating').toLowerCase();
  return INCIDENT_STATES.includes(state) ? state : 'investigating';
}

function normalizeIncidentImpact(value) {
  const impact = normalizeText(value, 32, 'minor').toLowerCase();
  return INCIDENT_IMPACTS.includes(impact) ? impact : 'minor';
}

function normalizeIso(value, fallback) {
  const input = normalizeText(value, 80, '');
  if (!input) return fallback;
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function historyFromRaw(rawHistory, state) {
  if (Array.isArray(rawHistory)) {
    const normalized = rawHistory
      .map((entry) => {
        if (typeof entry === 'string') return normalizeStatusState(entry);
        if (entry && typeof entry === 'object') return normalizeStatusState(entry.state);
        return '';
      })
      .filter(Boolean)
      .slice(-120);
    if (normalized.length > 0) return normalized;
  }
  return Array.from({ length: 42 }, () => normalizeStatusState(state));
}

function normalizeComponent(rawComponent, index, generatedAt) {
  const value = rawComponent && typeof rawComponent === 'object' ? rawComponent : {};
  const uptime = value.uptime && typeof value.uptime === 'object' ? value.uptime : {};
  const state = normalizeStatusState(value.state);
  return {
    id: normalizeText(value.id, 64, `component-${index + 1}`),
    name: normalizeText(value.name, 120, `Component ${index + 1}`),
    state,
    uptime: {
      h24: toFiniteNumber(uptime.h24),
      d7: toFiniteNumber(uptime.d7),
      d30: toFiniteNumber(uptime.d30),
    },
    latencyMs: toFiniteNumber(value.latencyMs),
    updatedAt: normalizeIso(value.updatedAt, generatedAt),
    history: historyFromRaw(value.history, state),
  };
}

function normalizeIncident(rawIncident, index, generatedAt) {
  const value = rawIncident && typeof rawIncident === 'object' ? rawIncident : {};
  const id = normalizeText(value.id, 120, `incident-${index + 1}`);
  const state = normalizeIncidentState(value.state);
  const startedAt = normalizeIso(value.startedAt, generatedAt);
  const updatedAt = normalizeIso(value.updatedAt, generatedAt);
  const resolvedAt = state === 'resolved'
    ? normalizeIso(value.resolvedAt, updatedAt)
    : normalizeIso(value.resolvedAt, '');

  return {
    id,
    title: normalizeText(value.title, 180, `Incident ${index + 1}`),
    state,
    impact: normalizeIncidentImpact(value.impact),
    startedAt,
    updatedAt,
    resolvedAt,
    components: Array.isArray(value.components)
      ? value.components.map((entry) => normalizeText(entry, 64, '')).filter(Boolean)
      : [],
    summary: normalizeText(value.summary, 900, 'No summary provided.'),
    link: normalizePath(value.link, '/support/'),
  };
}

function sortIncidents(incidents) {
  return [...incidents].sort((a, b) => {
    const aMs = Date.parse(a.startedAt || a.updatedAt || 0) || 0;
    const bMs = Date.parse(b.startedAt || b.updatedAt || 0) || 0;
    if (aMs !== bMs) return bMs - aMs;
    return a.id.localeCompare(b.id);
  });
}

function normalizeStatusDocument(rawValue, fallbackMessage) {
  const root = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const generatedAt = normalizeIso(root.generatedAt, nowIso());
  const overall = root.overall && typeof root.overall === 'object' ? root.overall : {};
  const componentsRaw = Array.isArray(root.components) ? root.components : [];
  const incidentsRaw = Array.isArray(root.incidents) ? root.incidents : [];

  return {
    generatedAt,
    overall: {
      state: normalizeStatusState(overall.state),
      message: normalizeText(overall.message, 320, fallbackMessage),
    },
    components: componentsRaw.map((component, index) => normalizeComponent(component, index, generatedAt)),
    incidents: sortIncidents(incidentsRaw.map((incident, index) => normalizeIncident(incident, index, generatedAt))),
  };
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'incident';
}

function readJsonFile(filePath) {
  return fs.readFile(filePath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
}

function withIncidentAwareOverall(statusDoc, noIncidentMessage) {
  const next = {
    ...statusDoc,
    incidents: sortIncidents(Array.isArray(statusDoc.incidents) ? statusDoc.incidents : []),
  };

  const active = next.incidents.filter((incident) => normalizeIncidentState(incident.state) !== 'resolved');
  if (active.length === 0) {
    next.overall = {
      state: 'operational',
      message: noIncidentMessage,
    };
    return next;
  }

  const criticalOrMajor = active.some((incident) => {
    const impact = normalizeIncidentImpact(incident.impact);
    return impact === 'critical' || impact === 'major';
  });
  next.overall = {
    state: criticalOrMajor ? 'outage' : 'degraded',
    message: `${active.length} active incident${active.length === 1 ? '' : 's'}. Latest: ${active[0].title}.`,
  };
  return next;
}

function ensureUniqueIncidentId(baseId, existingIds) {
  if (!existingIds.has(baseId)) return baseId;
  let counter = 2;
  while (existingIds.has(`${baseId}-${counter}`)) {
    counter += 1;
  }
  return `${baseId}-${counter}`;
}

function incidentHrefFromId(incidentId) {
  return `/status/incidents/${slugify(incidentId)}/`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function readStatusBundle() {
  const [rawLive, rawFallback] = await Promise.all([
    readJsonFile(STATUS_LIVE_PATH),
    readJsonFile(STATUS_FALLBACK_PATH),
  ]);

  const live = normalizeStatusDocument(rawLive, DEFAULT_LIVE_MESSAGE);
  const fallback = normalizeStatusDocument(rawFallback, DEFAULT_FALLBACK_MESSAGE);

  return {
    livePath: STATUS_LIVE_PATH,
    fallbackPath: STATUS_FALLBACK_PATH,
    incidentsRoot: INCIDENTS_ROOT,
    live: withIncidentAwareOverall(live, DEFAULT_LIVE_MESSAGE),
    fallback: withIncidentAwareOverall(fallback, DEFAULT_FALLBACK_MESSAGE),
  };
}

export async function writeStatusBundle(bundle) {
  const live = withIncidentAwareOverall(
    normalizeStatusDocument(bundle?.live, DEFAULT_LIVE_MESSAGE),
    DEFAULT_LIVE_MESSAGE,
  );
  const fallback = withIncidentAwareOverall(
    normalizeStatusDocument(bundle?.fallback, DEFAULT_FALLBACK_MESSAGE),
    DEFAULT_FALLBACK_MESSAGE,
  );

  await fs.mkdir(path.dirname(STATUS_LIVE_PATH), { recursive: true });
  await fs.writeFile(STATUS_LIVE_PATH, `${JSON.stringify(live, null, 2)}\n`, 'utf8');
  await fs.mkdir(path.dirname(STATUS_FALLBACK_PATH), { recursive: true });
  await fs.writeFile(STATUS_FALLBACK_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');

  return {
    livePath: STATUS_LIVE_PATH,
    fallbackPath: STATUS_FALLBACK_PATH,
    incidentsRoot: INCIDENTS_ROOT,
    live,
    fallback,
  };
}

export function createIncidentRecord(input, statusDoc) {
  const draft = input && typeof input === 'object' ? input : {};
  const title = normalizeText(draft.title, 180, '');
  if (!title) {
    throw new Error('Incident title is required.');
  }

  const now = nowIso();
  const existingIds = new Set((statusDoc?.incidents || []).map((incident) => String(incident.id).toLowerCase()));
  const requestedId = normalizeText(draft.id, 120, '');
  const fallbackId = `inc-${now.slice(0, 10).replace(/-/g, '')}-${slugify(title)}`;
  const baseId = (requestedId || fallbackId).toLowerCase();
  const id = ensureUniqueIncidentId(baseId, existingIds);
  const state = normalizeIncidentState(draft.state || 'investigating');
  const impact = normalizeIncidentImpact(draft.impact || 'minor');
  const components = String(draft.components || '')
    .split(/,|\||\n/)
    .map((entry) => normalizeText(entry, 64, ''))
    .filter(Boolean);
  const link = normalizePath(draft.link, incidentHrefFromId(id));

  return normalizeIncident({
    id,
    title,
    state,
    impact,
    startedAt: now,
    updatedAt: now,
    resolvedAt: state === 'resolved' ? now : '',
    components,
    summary: normalizeText(draft.summary, 900, 'Investigation started.'),
    link,
  }, 0, now);
}

export function insertIncident(statusDoc, incident) {
  const generatedAt = nowIso();
  const baseDoc = normalizeStatusDocument(statusDoc, DEFAULT_LIVE_MESSAGE);
  const normalizedIncident = normalizeIncident(incident, 0, generatedAt);
  const remaining = baseDoc.incidents.filter((entry) => String(entry.id).toLowerCase() !== String(normalizedIncident.id).toLowerCase());
  const nextIncidents = sortIncidents([normalizedIncident, ...remaining]);
  return {
    ...baseDoc,
    generatedAt,
    incidents: nextIncidents,
  };
}

export function resolveIncident(statusDoc, incidentId) {
  const normalizedId = normalizeText(incidentId, 120, '').toLowerCase();
  if (!normalizedId) {
    return { status: normalizeStatusDocument(statusDoc, DEFAULT_LIVE_MESSAGE), changed: false };
  }

  const generatedAt = nowIso();
  const baseDoc = normalizeStatusDocument(statusDoc, DEFAULT_LIVE_MESSAGE);
  let changed = false;
  const nextIncidents = baseDoc.incidents.map((incident, index) => {
    if (String(incident.id).toLowerCase() !== normalizedId) {
      return incident;
    }
    if (incident.state === 'resolved') return incident;
    changed = true;
    return normalizeIncident({
      ...incident,
      state: 'resolved',
      resolvedAt: generatedAt,
      updatedAt: generatedAt,
    }, index, generatedAt);
  });

  return {
    status: {
      ...baseDoc,
      generatedAt,
      incidents: sortIncidents(nextIncidents),
    },
    changed,
  };
}

export async function writeIncidentPage(incident) {
  const normalized = normalizeIncident(incident, 0, nowIso());
  const slug = slugify(normalized.id);
  const dirPath = path.join(INCIDENTS_ROOT, slug);
  const filePath = path.join(dirPath, 'index.html');
  const href = `/status/incidents/${slug}/`;

  const html = `<!doctype html>
<html lang=\"en-US\">
  <head>
    <meta charset=\"utf-8\" />
    <meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge,chrome=1\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\" />
    <title>${escapeHtml(normalized.title)} &mdash; dex status</title>
    <meta name=\"robots\" content=\"index, follow\" />
    <link rel=\"canonical\" href=\"${href}\" />
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #0b1018; color: #edf2fa; }
      main { max-width: 920px; margin: 0 auto; padding: 1rem; }
      .card { border: 1px solid rgba(255,255,255,0.17); border-radius: 14px; background: rgba(11,17,29,0.86); padding: 1rem; }
      .muted { color: rgba(201,210,224,0.86); }
      .pill { display: inline-flex; border: 1px solid rgba(255,255,255,0.2); border-radius: 999px; padding: 0.2rem 0.62rem; text-transform: uppercase; font-size: 0.76rem; letter-spacing: 0.05em; }
      a { color: #8ec6ff; text-decoration: none; }
      .grid { display: grid; gap: 0.4rem; margin-top: 0.85rem; }
    </style>
  </head>
  <body>
    <main>
      <section class=\"card\">
        <p class=\"muted\">dex status incident</p>
        <h1>${escapeHtml(normalized.title)}</h1>
        <p><span class=\"pill\">${escapeHtml(normalized.state)}</span></p>
        <p class=\"muted\">Impact: ${escapeHtml(normalized.impact)} · Started: ${escapeHtml(normalized.startedAt)} · Updated: ${escapeHtml(normalized.updatedAt)}</p>
        <p>${escapeHtml(normalized.summary)}</p>
        <div class=\"grid\">
          <div><strong>Incident ID:</strong> ${escapeHtml(normalized.id)}</div>
          <div><strong>Components:</strong> ${escapeHtml(normalized.components.length ? normalized.components.join(', ') : 'unspecified')}</div>
          <div><strong>Resolved At:</strong> ${escapeHtml(normalized.resolvedAt || 'Not resolved')}</div>
        </div>
        <p style=\"margin-top: 1rem;\"><a href=\"/support/\">Back to support status</a></p>
      </section>
    </main>
  </body>
</html>
`;

  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(filePath, html, 'utf8');

  return {
    filePath,
    href,
    incident: {
      ...normalized,
      link: href,
    },
  };
}
