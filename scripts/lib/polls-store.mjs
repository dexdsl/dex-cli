import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePollsFile } from './polls-schema.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_POLLS_PATH = path.join(ROOT, 'data', 'polls.json');

export function getPollsFilePath(customPath) {
  return customPath ? path.resolve(customPath) : DEFAULT_POLLS_PATH;
}

export async function readPollsFile(customPath) {
  const filePath = getPollsFilePath(customPath);
  const text = await fs.readFile(filePath, 'utf8');
  const raw = JSON.parse(text);
  const normalized = normalizePollsFile(raw);
  return {
    filePath,
    data: normalized,
  };
}

export async function writePollsFile(data, customPath) {
  const filePath = getPollsFilePath(customPath);
  const normalized = normalizePollsFile(data);
  const next = {
    ...normalized,
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    filePath,
    data: next,
  };
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'poll';
}

function ensureUnique(base, existingSet) {
  if (!existingSet.has(base)) return base;
  let index = 2;
  while (existingSet.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function resolvePollCallSequence(data = {}) {
  let max = 0;
  for (const poll of Array.isArray(data.polls) ? data.polls : []) {
    const value = Number(poll?.callRef?.sequence || 0);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max + 1;
}

function createDefaultPollCallRef(sequence, year = new Date().getUTCFullYear()) {
  const safeSequence = Math.max(1, Math.trunc(Number(sequence) || 1));
  const safeYear = Math.max(1900, Math.min(9999, Math.trunc(Number(year) || new Date().getUTCFullYear())));
  const cycleCode = `C${safeYear}.${safeSequence}`;
  return {
    group: 'inDex',
    lane: 'in-dex-c',
    year: safeYear,
    sequence: safeSequence,
    cycleCode,
    cycleLabel: `IN DEX ${cycleCode}`,
  };
}

export function createPollDraft(existingData, input = {}) {
  const data = normalizePollsFile(existingData);
  const now = new Date();
  const close = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
  const existingIds = new Set(data.polls.map((poll) => poll.id.toLowerCase()));
  const existingSlugs = new Set(data.polls.map((poll) => String(poll.slug || '').toLowerCase()).filter(Boolean));

  const baseId = slugify(input.id || input.question || `poll-${now.toISOString().slice(0, 10)}`);
  const id = ensureUnique(baseId, existingIds);

  const baseSlug = slugify(input.slug || input.question || id);
  const slug = ensureUnique(baseSlug, existingSlugs);
  const nextSequence = resolvePollCallSequence(data);
  const suppliedCallRef = input.callRef && typeof input.callRef === 'object' ? input.callRef : null;
  const callRef = suppliedCallRef || createDefaultPollCallRef(nextSequence, now.getUTCFullYear());

  return {
    id,
    slug,
    status: input.status || 'draft',
    visibility: input.visibility || 'public',
    question: String(input.question || 'New poll question').trim(),
    options: Array.isArray(input.options) && input.options.length >= 2
      ? input.options.map((value) => String(value || '').trim()).filter(Boolean)
      : ['Option 1', 'Option 2'],
    createdAt: now.toISOString(),
    closeAt: close.toISOString(),
    manualClose: Boolean(input.manualClose),
    callRef,
  };
}

export function upsertPoll(existingData, nextPollInput) {
  const data = normalizePollsFile(existingData);
  const pollId = String(nextPollInput?.id || '').trim();
  if (!pollId) throw new Error('Poll id is required for upsert.');

  const current = data.polls.find((poll) => poll.id === pollId) || null;
  const callRef = nextPollInput?.callRef && typeof nextPollInput.callRef === 'object'
    ? nextPollInput.callRef
    : (current?.callRef || createDefaultPollCallRef(resolvePollCallSequence(data)));

  const normalizedCandidate = normalizePollsFile({
    version: data.version,
    updatedAt: data.updatedAt,
    polls: [{ ...nextPollInput, callRef }],
  }).polls[0];

  const index = data.polls.findIndex((poll) => poll.id === pollId);
  if (index >= 0) {
    data.polls[index] = normalizedCandidate;
  } else {
    data.polls.push(normalizedCandidate);
  }

  return normalizePollsFile(data);
}

export function removePoll(existingData, pollId) {
  const data = normalizePollsFile(existingData);
  const normalizedId = String(pollId || '').trim();
  const nextPolls = data.polls.filter((poll) => poll.id !== normalizedId);
  if (nextPolls.length === data.polls.length) {
    throw new Error(`Poll not found: ${normalizedId}`);
  }
  return normalizePollsFile({ ...data, polls: nextPolls });
}

export function setPollStatus(existingData, pollId, status) {
  const data = normalizePollsFile(existingData);
  const target = data.polls.find((poll) => poll.id === String(pollId || '').trim());
  if (!target) throw new Error(`Poll not found: ${pollId}`);
  target.status = status;
  if (status === 'closed') {
    target.manualClose = true;
  } else if (status === 'open') {
    target.manualClose = false;
  }
  return normalizePollsFile(data);
}
