import {
  allocateNextInDexSequence,
  buildPollCallRef,
  normalizeCallLane,
  normalizeCallRef,
} from './call-lookup.mjs';
import {
  clearActiveCall,
  createCallDraft,
  findCallById,
  listCalls,
  readCallsRegistry,
  setActiveCall,
  upsertCall,
  writeCallsRegistry,
} from './calls-store.mjs';
import {
  readPollsFile,
  getPollsFilePath,
  writePollsFile,
} from './polls-store.mjs';
import fs from 'node:fs/promises';

function toText(value) {
  return String(value || '').trim();
}

function parseArgs(rest = []) {
  const [subcommand = '', ...rawArgs] = rest;
  const flags = new Map();
  const values = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.split('=', 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index += 1;
        continue;
      }
      flags.set(name, 'true');
      continue;
    }
    values.push(arg);
  }
  return { subcommand: toText(subcommand).toLowerCase(), flags, values };
}

function printRows(calls = []) {
  console.log('status   lane      cycle              title');
  console.log('---------------------------------------------------------------');
  for (const call of calls) {
    const status = toText(call.status).padEnd(7);
    const lane = toText(call.lane).padEnd(9);
    const cycle = toText(call.cycleLabel || call.cycleCode).padEnd(18);
    console.log(`${status} ${lane} ${cycle} ${toText(call.title)}`);
  }
}

function printUsage() {
  console.log('Usage: dex call <list|view|add|set-active|clear-active|sync-poll-lookups> [args]');
  console.log('  dex call list [--active|--past|--draft|--all] [--file data/calls.registry.json]');
  console.log('  dex call view <id> [--file data/calls.registry.json]');
  console.log('  dex call add --lane <in-dex-a|in-dex-b|in-dex-c|mini-dex> --year <yyyy> --title "..." [--status draft|past|active]');
  console.log('  dex call set-active <id>');
  console.log('  dex call clear-active');
  console.log('  dex call sync-poll-lookups [--polls-file data/polls.json] [--year 2026]');
}

function deriveListStatus(flags) {
  if (flags.has('--active')) return 'active';
  if (flags.has('--past')) return 'past';
  if (flags.has('--draft')) return 'draft';
  return 'all';
}

function resolvePollYear(poll, fallbackYear) {
  const closeAt = Date.parse(toText(poll?.closeAt));
  if (Number.isFinite(closeAt)) return new Date(closeAt).getUTCFullYear();
  const createdAt = Date.parse(toText(poll?.createdAt));
  if (Number.isFinite(createdAt)) return new Date(createdAt).getUTCFullYear();
  return fallbackYear;
}

function pollHasCallRef(poll) {
  const ref = normalizeCallRef(poll?.callRef || {});
  return ref.lane === 'in-dex-c' && ref.sequence > 0 && ref.year > 0;
}

export async function runCallCommand(rest = []) {
  const { subcommand, flags, values } = parseArgs(rest);
  if (!subcommand) {
    printUsage();
    return;
  }

  const registryPath = flags.get('--file');

  if (subcommand === 'list') {
    const { data } = await readCallsRegistry(registryPath);
    const status = deriveListStatus(flags);
    const calls = listCalls(data, { status });
    printRows(calls);
    console.log(`\nactiveCallId=${toText(data.activeCallId) || '(none)'}`);
    return;
  }

  if (subcommand === 'view') {
    const callId = values[0] || flags.get('--id');
    if (!toText(callId)) throw new Error('call:view requires call id');
    const { data } = await readCallsRegistry(registryPath);
    const call = findCallById(data, callId);
    if (!call) throw new Error(`call:view not found: ${callId}`);
    console.log(JSON.stringify(call, null, 2));
    return;
  }

  if (subcommand === 'add') {
    const lane = toText(flags.get('--lane'));
    const yearRaw = Number(flags.get('--year'));
    const title = toText(flags.get('--title'));
    const status = toText(flags.get('--status') || 'draft').toLowerCase();
    if (!lane || !normalizeCallLane(lane)) throw new Error('call:add requires --lane <in-dex-a|in-dex-b|in-dex-c|mini-dex>');
    if (!Number.isFinite(yearRaw)) throw new Error('call:add requires --year <yyyy>');
    if (!title) throw new Error('call:add requires --title "..."');

    const { data } = await readCallsRegistry(registryPath);
    const { data: pollsData } = await readPollsFile(flags.get('--polls-file'));
    const draft = createCallDraft(data, {
      lane,
      year: yearRaw,
      title,
      status,
      polls: pollsData.polls,
      summary: toText(flags.get('--summary')),
      deadlineIso: toText(flags.get('--deadline')),
      notificationLabel: toText(flags.get('--notify')),
    });

    let next = upsertCall(data, draft);
    if (draft.status === 'active') {
      next = setActiveCall(next, draft.id);
    }

    await writeCallsRegistry(next, registryPath);
    console.log(`call:add wrote ${draft.id} (${draft.cycleLabel})`);
    return;
  }

  if (subcommand === 'set-active') {
    const callId = values[0] || flags.get('--id');
    if (!toText(callId)) throw new Error('call:set-active requires call id');
    const { data } = await readCallsRegistry(registryPath);
    const next = setActiveCall(data, callId);
    await writeCallsRegistry(next, registryPath);
    console.log(`call:set-active wrote ${toText(callId)}`);
    return;
  }

  if (subcommand === 'clear-active') {
    const { data } = await readCallsRegistry(registryPath);
    const next = clearActiveCall(data);
    await writeCallsRegistry(next, registryPath);
    console.log('call:clear-active wrote activeCallId=(none)');
    return;
  }

  if (subcommand === 'sync-poll-lookups') {
    const { data: callsData } = await readCallsRegistry(registryPath);
    const pollsFilePath = flags.get('--polls-file');
    const resolvedPollsPath = getPollsFilePath(pollsFilePath);
    const rawPollsText = await fs.readFile(resolvedPollsPath, 'utf8');
    const rawPolls = JSON.parse(rawPollsText);
    const pollsData = {
      ...rawPolls,
      polls: Array.isArray(rawPolls?.polls) ? rawPolls.polls : [],
    };

    const fallbackYear = Number(flags.get('--year')) || new Date().getUTCFullYear();
    let nextSequence = allocateNextInDexSequence({
      calls: callsData.calls,
      polls: pollsData.polls,
    });

    const sorted = [...pollsData.polls].sort((left, right) => {
      const leftMs = Date.parse(toText(left?.createdAt));
      const rightMs = Date.parse(toText(right?.createdAt));
      if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
        return leftMs - rightMs;
      }
      return toText(left?.id).localeCompare(toText(right?.id));
    });

    let changed = 0;
    const byId = new Map();
    for (const poll of sorted) {
      if (pollHasCallRef(poll)) {
        byId.set(poll.id, poll);
        continue;
      }
      const year = resolvePollYear(poll, fallbackYear);
      const callRef = buildPollCallRef({ year, sequence: nextSequence });
      nextSequence += 1;
      changed += 1;
      byId.set(poll.id, {
        ...poll,
        callRef,
      });
    }

    if (changed === 0) {
      console.log('call:sync-poll-lookups no changes needed');
      return;
    }

    const nextPolls = {
      ...pollsData,
      polls: pollsData.polls.map((poll) => byId.get(poll.id) || poll),
    };

    await writePollsFile(nextPolls, pollsFilePath);
    console.log(`call:sync-poll-lookups updated ${changed} poll(s)`);
    return;
  }

  throw new Error(`Unknown call command: ${subcommand}`);
}

export function printCallUsage() {
  printUsage();
}
