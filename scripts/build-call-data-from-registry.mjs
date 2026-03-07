#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCallsRegistry } from './lib/calls-schema.mjs';
import { buildSubmitCallHref } from './lib/calls-url.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const REGISTRY_PATH = path.join(ROOT, 'data', 'calls.registry.json');
const COPY_PATH = path.join(ROOT, 'public', 'data', 'call.editorial.copy.json');
const OUTPUT_PATH = path.join(ROOT, 'public', 'data', 'call.data.json');

function toText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatDeadlineLabel(deadlineIso = '') {
  const raw = toText(deadlineIso);
  if (!raw) return '';
  const date = new Date(`${raw}T23:59:59Z`);
  if (!Number.isFinite(date.getTime())) return '';
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd} DEADLINE`;
}

function mapSubcalls(values = []) {
  return (Array.isArray(values) ? values : []).map((item) => ({
    heading_raw: toText(item?.heading),
    body_raw: Array.isArray(item?.body) ? item.body.map((line) => toText(line)).filter(Boolean) : [],
  })).filter((item) => item.heading_raw);
}

function mapRelatedLinks(values = []) {
  return (Array.isArray(values) ? values : []).map((item) => ({
    label_raw: toText(item?.label),
    href: toText(item?.href),
  })).filter((item) => item.label_raw && item.href);
}

function mapCallForRuntime(call, defaults = {}) {
  const cycleRaw = toText(call?.cycleLabel || call?.cycleCode);
  const lane = toText(call?.lane);
  const submitHref = buildSubmitCallHref({
    lane,
    cycle: cycleRaw,
    subcall: '',
    via: 'call-editorial',
  });

  return {
    id: toText(call?.id),
    lane,
    status: toText(call?.status),
    cycle_raw: cycleRaw,
    status_label_raw: toText(defaults.status_label_raw || 'ACTIVE CALL:'),
    title_raw: toText(call?.title),
    deadline_label_raw: toText(call?.deadlineLabel) || formatDeadlineLabel(call?.deadlineIso),
    notification_label_raw: toText(call?.notificationLabel),
    deadline_iso: toText(call?.deadlineIso),
    structure_raw: toText(call?.structure) || (Array.isArray(call?.subcalls) && call.subcalls.length > 0
      ? toText(defaults.active_structure_raw)
      : ''),
    summary_raw: toText(call?.summary),
    submit_cta: {
      label_raw: toText(defaults.submit_label_raw || 'SUBMIT'),
      href: submitHref,
    },
    image_src: toText(call?.imageSrc),
    related_heading_raw: toText(defaults.related_heading_raw || 'RELATED LINKS'),
    subcalls: mapSubcalls(call?.subcalls),
    related_links: mapRelatedLinks(call?.relatedLinks),
    related_note_raw: toText(call?.relatedNote),
    subcalls_image_src: toText(call?.subcallsImageSrc),
    body_raw: Array.isArray(call?.body) ? call.body.map((line) => toText(line)).filter(Boolean) : [],
    is_active: toText(call?.status) === 'active',
  };
}

function mapPastEntries(calls = []) {
  return calls.map((call) => ({
    cycle_raw: toText(call?.cycleLabel || call?.cycleCode),
    prompt_raw: toText(call?.pastPrompt || call?.summary || call?.title),
    outcome_raw: toText(call?.pastOutcome || call?.title),
    date_raw: toText(call?.pastDateRange || call?.year),
  })).filter((entry) => entry.cycle_raw);
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sortBySequenceDesc(calls = []) {
  return [...calls].sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0));
}

async function main() {
  const registryRaw = await loadJson(REGISTRY_PATH);
  const copy = await loadJson(COPY_PATH);
  const registry = normalizeCallsRegistry(registryRaw);
  const calls = sortBySequenceDesc(Array.isArray(registry.calls) ? registry.calls : []);

  const activeCall = calls.find((call) => call.id === registry.activeCallId && call.status === 'active')
    || calls.find((call) => call.status === 'active')
    || null;

  const latestMini = calls.find((call) => call.lane === 'mini-dex' && (!activeCall || call.id !== activeCall.id)) || null;

  const nonActiveCalls = calls.filter((call) => !activeCall || call.id !== activeCall.id)
    .filter((call) => call.status !== 'draft');

  const output = {
    source: 'calls-registry',
    generated_at: new Date().toISOString(),
    registry: {
      activeCallId: toText(registry.activeCallId),
      sequenceGroup: 'inDex',
      calls: calls.map((call) => ({
        id: call.id,
        lane: call.lane,
        status: call.status,
        year: call.year,
        sequence: call.sequence,
        cycleCode: call.cycleCode,
        cycleLabel: call.cycleLabel,
      })),
    },
    calls: calls,
    hero: copy.hero || {},
    lanes: Array.isArray(copy.lanes) ? copy.lanes : [],
    active_call: activeCall ? mapCallForRuntime(activeCall, copy.defaults || {}) : {},
    mini_call: latestMini ? mapCallForRuntime(latestMini, copy.defaults || {}) : {},
    requirements: copy.requirements || {},
    past_calls: {
      ...(copy.past_calls || {}),
      entries: mapPastEntries(nonActiveCalls),
    },
    newsletter: copy.newsletter || {},
  };

  await writeJson(OUTPUT_PATH, output);
  console.log(`call:data wrote ${path.relative(ROOT, OUTPUT_PATH)} from ${path.relative(ROOT, REGISTRY_PATH)}`);
}

main().catch((error) => {
  console.error(`build-call-data-from-registry failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
