import { z } from 'zod';

const POLL_STATUS = ['open', 'closed', 'draft'];
const POLL_VISIBILITY = ['public', 'members'];

const isoDateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'Invalid ISO timestamp',
});

const callRefSchema = z.object({
  group: z.literal('inDex'),
  lane: z.literal('in-dex-c'),
  year: z.number().int().min(1900).max(9999),
  sequence: z.number().int().min(1).max(9999),
  cycleCode: z.string().trim().min(1).max(64),
  cycleLabel: z.string().trim().min(1).max(120),
});

const pollSchema = z.object({
  id: z.string().trim().min(1).max(128),
  slug: z.string().trim().min(1).max(160).optional(),
  status: z.enum(POLL_STATUS),
  question: z.string().trim().min(6).max(600),
  options: z.array(z.string().trim().min(1).max(240)).min(2).max(12),
  createdAt: isoDateString,
  closeAt: isoDateString,
  manualClose: z.boolean(),
  visibility: z.enum(POLL_VISIBILITY),
  callRef: callRefSchema,
});

const pollsFileSchema = z.object({
  version: z.number().int().min(1),
  updatedAt: isoDateString,
  polls: z.array(pollSchema),
});

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizePoll(input) {
  const createdAtMs = Date.parse(input.createdAt);
  const closeAtMs = Date.parse(input.closeAt);
  const options = dedupeStrings(input.options);
  if (closeAtMs < createdAtMs) {
    throw new Error(`Poll ${input.id} has closeAt earlier than createdAt.`);
  }
  if (options.length < 2) {
    throw new Error(`Poll ${input.id} must include at least two unique options.`);
  }

  const callRef = input.callRef && typeof input.callRef === 'object' ? input.callRef : {};
  const callRefYear = Number(callRef.year || 0);
  const callRefSequence = Number(callRef.sequence || 0);
  const callCycleCode = String(callRef.cycleCode || '').trim().toUpperCase();
  const expectedCode = `C${callRefYear}.${callRefSequence}`;
  const expectedLabel = `IN DEX ${expectedCode}`;
  if (callCycleCode !== expectedCode) {
    throw new Error(`Poll ${input.id} callRef.cycleCode must equal ${expectedCode}.`);
  }
  const callCycleLabel = String(callRef.cycleLabel || '').trim().toUpperCase();
  if (callCycleLabel !== expectedLabel) {
    throw new Error(`Poll ${input.id} callRef.cycleLabel must equal ${expectedLabel}.`);
  }

  return {
    id: normalizeText(input.id),
    slug: input.slug ? normalizeText(input.slug) : undefined,
    status: input.status,
    visibility: input.visibility,
    question: normalizeText(input.question),
    options,
    createdAt: new Date(createdAtMs).toISOString(),
    closeAt: new Date(closeAtMs).toISOString(),
    manualClose: Boolean(input.manualClose),
    callRef: {
      group: 'inDex',
      lane: 'in-dex-c',
      year: callRefYear,
      sequence: callRefSequence,
      cycleCode: expectedCode,
      cycleLabel: expectedLabel,
    },
  };
}

function sortPolls(polls = []) {
  return [...polls].sort((a, b) => {
    const createdDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });
}

export function normalizePollsFile(rawValue) {
  const parsed = pollsFileSchema.parse(rawValue);
  const ids = new Set();
  const slugs = new Set();
  const polls = sortPolls(parsed.polls.map(normalizePoll));

  for (const poll of polls) {
    const idKey = poll.id.toLowerCase();
    if (ids.has(idKey)) throw new Error(`Duplicate poll id: ${poll.id}`);
    ids.add(idKey);

    if (poll.slug) {
      const slugKey = poll.slug.toLowerCase();
      if (slugs.has(slugKey)) throw new Error(`Duplicate poll slug: ${poll.slug}`);
      slugs.add(slugKey);
    }
  }

  return {
    version: parsed.version,
    updatedAt: parsed.updatedAt,
    polls,
  };
}

export function validatePollsFile(rawValue) {
  return normalizePollsFile(rawValue);
}

export const pollsStatusValues = POLL_STATUS;
export const pollsVisibilityValues = POLL_VISIBILITY;
export const pollsFileJsonSchema = pollsFileSchema;
