import { z } from 'zod';
import {
  assertUniqueCallSequences,
  buildCycleCode,
  buildCycleLabel,
  normalizeCallLane,
  normalizeCallRef,
} from './call-lookup.mjs';

export const CALLS_REGISTRY_VERSION = 'calls-registry-v1';

const CALL_STATUS = ['active', 'past', 'draft'];

const isoDateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'Invalid ISO timestamp',
});

const callLinkSchema = z.object({
  label: z.string().trim().min(1).max(240),
  href: z.string().trim().min(1).max(1200),
});

const callSubcallSchema = z.object({
  id: z.string().trim().min(1).max(24).optional(),
  heading: z.string().trim().min(1).max(240),
  body: z.array(z.string().trim().min(1).max(1200)).max(16).optional(),
});

const callSchema = z.object({
  id: z.string().trim().min(1).max(120),
  status: z.enum(CALL_STATUS),
  lane: z.string().trim().min(1).max(40),
  year: z.number().int().min(1900).max(9999),
  sequence: z.number().int().min(1).max(9999),
  cycleCode: z.string().trim().min(1).max(120),
  cycleLabel: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().max(2400).optional(),
  deadlineIso: z.string().trim().max(80).optional(),
  deadlineLabel: z.string().trim().max(160).optional(),
  notificationLabel: z.string().trim().max(180).optional(),
  structure: z.string().trim().max(1800).optional(),
  body: z.array(z.string().trim().min(1).max(2400)).max(20).optional(),
  subcalls: z.array(callSubcallSchema).max(20).optional(),
  relatedLinks: z.array(callLinkSchema).max(20).optional(),
  relatedNote: z.string().trim().max(600).optional(),
  imageSrc: z.string().trim().max(1200).optional(),
  subcallsImageSrc: z.string().trim().max(1200).optional(),
  pastPrompt: z.string().trim().max(1200).optional(),
  pastOutcome: z.string().trim().max(1200).optional(),
  pastDateRange: z.string().trim().max(240).optional(),
  internalMeta: z.record(z.any()).optional(),
});

const callsRegistrySchema = z.object({
  version: z.literal(CALLS_REGISTRY_VERSION),
  updatedAt: isoDateString,
  sequenceGroup: z.literal('inDex'),
  activeCallId: z.string().trim().max(120).nullable().optional(),
  calls: z.array(callSchema),
});

function toText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHref(value) {
  const raw = toText(value);
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  return raw;
}

function normalizeBody(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const line = toText(value);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function normalizeSubcalls(values = []) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    const heading = toText(item?.heading);
    if (!heading) continue;
    const key = heading.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: toText(item?.id),
      heading,
      body: normalizeBody(item?.body),
    });
  }
  return out;
}

function normalizeLinks(values = []) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    const label = toText(item?.label);
    const href = normalizeHref(item?.href);
    if (!label || !href) continue;
    const key = `${label.toLowerCase()}|${href.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, href });
  }
  return out;
}

function normalizeCall(input = {}) {
  const id = toText(input.id);
  const status = toText(input.status).toLowerCase();
  const normalizedStatus = status === 'active' || status === 'past' || status === 'draft' ? status : 'draft';
  const ref = normalizeCallRef(input);
  const lane = normalizeCallLane(ref.lane || input.lane);
  const year = Number(ref.year || input.year || 0);
  const sequence = Number(ref.sequence || input.sequence || 0);
  const cycleCode = buildCycleCode({ lane, year, sequence }) || toText(input.cycleCode);
  const cycleLabel = buildCycleLabel({ lane, year, sequence }) || toText(input.cycleLabel);

  return {
    id,
    status: normalizedStatus,
    lane,
    year,
    sequence,
    cycleCode,
    cycleLabel,
    title: toText(input.title),
    summary: toText(input.summary),
    deadlineIso: toText(input.deadlineIso),
    deadlineLabel: toText(input.deadlineLabel),
    notificationLabel: toText(input.notificationLabel),
    structure: toText(input.structure),
    body: normalizeBody(input.body),
    subcalls: normalizeSubcalls(input.subcalls),
    relatedLinks: normalizeLinks(input.relatedLinks),
    relatedNote: toText(input.relatedNote),
    imageSrc: normalizeHref(input.imageSrc),
    subcallsImageSrc: normalizeHref(input.subcallsImageSrc),
    pastPrompt: toText(input.pastPrompt),
    pastOutcome: toText(input.pastOutcome),
    pastDateRange: toText(input.pastDateRange),
    internalMeta: input.internalMeta && typeof input.internalMeta === 'object' && !Array.isArray(input.internalMeta)
      ? input.internalMeta
      : {},
  };
}

function dedupeCalls(calls = []) {
  const ids = new Set();
  const out = [];
  for (const call of Array.isArray(calls) ? calls : []) {
    const id = toText(call?.id).toLowerCase();
    if (!id) throw new Error('Call id is required.');
    if (ids.has(id)) throw new Error(`Duplicate call id: ${call.id}`);
    ids.add(id);
    out.push(call);
  }
  return out;
}

function ensureActiveContract(calls = [], activeCallId) {
  const activeRows = calls.filter((call) => call.status === 'active');
  if (activeRows.length > 1) {
    throw new Error(`Calls registry supports one active call; found ${activeRows.length}.`);
  }

  const normalizedActiveId = toText(activeCallId);
  if (!normalizedActiveId) {
    if (activeRows.length === 0) return '';
    return activeRows[0].id;
  }

  const target = calls.find((call) => call.id === normalizedActiveId);
  if (!target) {
    throw new Error(`activeCallId not found: ${normalizedActiveId}`);
  }
  if (target.status !== 'active') {
    throw new Error(`activeCallId must reference an active call: ${normalizedActiveId}`);
  }
  return normalizedActiveId;
}

export function normalizeCallsRegistry(rawValue) {
  const parsed = callsRegistrySchema.parse(rawValue);
  const normalizedCalls = dedupeCalls(parsed.calls.map(normalizeCall));

  for (const call of normalizedCalls) {
    if (!call.lane) throw new Error(`Call lane invalid for ${call.id}`);
    if (!call.cycleCode) throw new Error(`Call cycleCode invalid for ${call.id}`);
    if (!call.cycleLabel) throw new Error(`Call cycleLabel invalid for ${call.id}`);
    if (!call.title) throw new Error(`Call title required for ${call.id}`);
  }

  assertUniqueCallSequences(normalizedCalls);
  const activeCallId = ensureActiveContract(normalizedCalls, parsed.activeCallId);

  return {
    version: CALLS_REGISTRY_VERSION,
    updatedAt: new Date(parsed.updatedAt).toISOString(),
    sequenceGroup: 'inDex',
    activeCallId,
    calls: normalizedCalls,
  };
}

export function validateCallsRegistry(rawValue) {
  return normalizeCallsRegistry(rawValue);
}

export const callsRegistryJsonSchema = callsRegistrySchema;
