import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocateNextInDexSequence,
  buildCycleCode,
  buildCycleLabel,
  normalizeCallLane,
  sortCallsBySequenceDesc,
} from './call-lookup.mjs';
import {
  CALLS_REGISTRY_VERSION,
  normalizeCallsRegistry,
} from './calls-schema.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_CALLS_REGISTRY_PATH = path.join(ROOT, 'data', 'calls.registry.json');
const PUBLIC_CALLS_REGISTRY_PATH = path.join(ROOT, 'public', 'data', 'calls.registry.json');
const DOCS_CALLS_REGISTRY_PATH = path.join(ROOT, 'docs', 'data', 'calls.registry.json');

function toText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toRegistryInput(data) {
  const input = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : {};
  return {
    version: CALLS_REGISTRY_VERSION,
    updatedAt: toText(input.updatedAt) || new Date().toISOString(),
    sequenceGroup: 'inDex',
    activeCallId: toText(input.activeCallId),
    calls: Array.isArray(input.calls) ? input.calls : [],
  };
}

function slugify(value) {
  return toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function getCallsRegistryPath(customPath) {
  return customPath ? path.resolve(customPath) : DEFAULT_CALLS_REGISTRY_PATH;
}

export function defaultCallsRegistryData() {
  return {
    version: CALLS_REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    sequenceGroup: 'inDex',
    activeCallId: '',
    calls: [],
  };
}

export async function readCallsRegistry(customPath) {
  const filePath = getCallsRegistryPath(customPath);
  const text = await fs.readFile(filePath, 'utf8');
  const raw = JSON.parse(text);
  return {
    filePath,
    data: normalizeCallsRegistry(raw),
  };
}

export async function writeCallsRegistry(data, customPath) {
  const filePath = getCallsRegistryPath(customPath);
  const normalized = normalizeCallsRegistry({
    ...(data || defaultCallsRegistryData()),
    version: CALLS_REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

  if (!customPath || path.resolve(customPath) === DEFAULT_CALLS_REGISTRY_PATH) {
    const mirrorTargets = [PUBLIC_CALLS_REGISTRY_PATH, DOCS_CALLS_REGISTRY_PATH];
    await Promise.all(
      mirrorTargets.map(async (targetPath) => {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      }),
    );
  }

  return {
    filePath,
    data: normalized,
  };
}

export function findCallById(data, callId) {
  const calls = Array.isArray(data?.calls) ? data.calls : [];
  const needle = toText(callId);
  return calls.find((call) => call.id === needle) || null;
}

export function setActiveCall(data, callId) {
  const normalized = normalizeCallsRegistry(toRegistryInput(data));
  const targetId = toText(callId);
  const target = normalized.calls.find((call) => call.id === targetId);
  if (!target) throw new Error(`call not found: ${targetId}`);

  const calls = normalized.calls.map((call) => {
    if (call.id === targetId) return { ...call, status: 'active' };
    if (call.status === 'active') return { ...call, status: 'past' };
    return call;
  });

  return normalizeCallsRegistry({
    ...normalized,
    activeCallId: targetId,
    calls,
  });
}

export function clearActiveCall(data) {
  const normalized = normalizeCallsRegistry(toRegistryInput(data));
  const calls = normalized.calls.map((call) => (call.status === 'active' ? { ...call, status: 'past' } : call));
  return normalizeCallsRegistry({
    ...normalized,
    activeCallId: '',
    calls,
  });
}

export function upsertCall(data, callInput) {
  const normalized = normalizeCallsRegistry(toRegistryInput(data));
  const nextCall = { ...(callInput || {}) };
  const id = toText(nextCall.id);
  if (!id) throw new Error('call id is required');

  const index = normalized.calls.findIndex((call) => call.id === id);
  let calls;
  if (index >= 0) {
    calls = [...normalized.calls];
    calls[index] = {
      ...calls[index],
      ...nextCall,
      id,
    };
  } else {
    calls = [...normalized.calls, { ...nextCall, id }];
  }

  const activeCallId = toText(normalized.activeCallId);
  return normalizeCallsRegistry({
    ...normalized,
    activeCallId,
    calls,
  });
}

export function createCallDraft(data, {
  lane,
  year,
  title,
  polls = [],
  status = 'draft',
  summary = '',
  deadlineIso = '',
  notificationLabel = '',
} = {}) {
  const normalized = normalizeCallsRegistry(toRegistryInput(data));
  const safeLane = normalizeCallLane(lane);
  if (!safeLane) throw new Error(`invalid lane: ${lane}`);
  const safeYear = Number(year);
  if (!Number.isFinite(safeYear) || safeYear < 1900 || safeYear > 9999) {
    throw new Error(`invalid year: ${year}`);
  }
  const sequence = allocateNextInDexSequence({
    calls: normalized.calls,
    polls,
  });

  const cycleCode = buildCycleCode({ lane: safeLane, year: safeYear, sequence });
  const cycleLabel = buildCycleLabel({ lane: safeLane, year: safeYear, sequence });

  const idBase = `${cycleCode}-${slugify(title || '')}`;
  const id = slugify(idBase) || `${safeLane}-${safeYear}-${sequence}`;

  return {
    id,
    status: status === 'active' || status === 'past' ? status : 'draft',
    lane: safeLane,
    year: safeYear,
    sequence,
    cycleCode,
    cycleLabel,
    title: toText(title) || cycleLabel,
    summary: toText(summary),
    deadlineIso: toText(deadlineIso),
    deadlineLabel: '',
    notificationLabel: toText(notificationLabel),
    structure: '',
    body: [],
    subcalls: [],
    relatedLinks: [],
    relatedNote: '',
    imageSrc: '',
    subcallsImageSrc: '',
    pastPrompt: '',
    pastOutcome: '',
    pastDateRange: '',
    internalMeta: {},
  };
}

export function listCalls(data, { status = 'all' } = {}) {
  const normalized = normalizeCallsRegistry(toRegistryInput(data));
  const calls = sortCallsBySequenceDesc(normalized.calls);
  if (status === 'active' || status === 'past' || status === 'draft') {
    return calls.filter((call) => call.status === status);
  }
  return calls;
}
