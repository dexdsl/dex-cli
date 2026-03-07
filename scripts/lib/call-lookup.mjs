const LANE_IDS = ['in-dex-a', 'in-dex-b', 'in-dex-c', 'mini-dex'];

const LANE_TO_CODE = {
  'in-dex-a': 'A',
  'in-dex-b': 'B',
  'in-dex-c': 'C',
  'mini-dex': 'MINIDEX',
};

function toText(value) {
  return String(value || '').trim();
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

export function normalizeCallLane(value) {
  const lane = toText(value).toLowerCase();
  return LANE_IDS.includes(lane) ? lane : '';
}

export function laneCodeFromLane(lane) {
  const normalized = normalizeCallLane(lane);
  return normalized ? LANE_TO_CODE[normalized] : '';
}

export function laneFromCode(code) {
  const raw = toText(code).toUpperCase();
  if (raw === 'A') return 'in-dex-a';
  if (raw === 'B') return 'in-dex-b';
  if (raw === 'C') return 'in-dex-c';
  if (raw === 'MINIDEX' || raw === 'MINI-DEX') return 'mini-dex';
  return '';
}

export function buildCycleCode({ lane, year, sequence }) {
  const laneCode = laneCodeFromLane(lane);
  const safeYear = toInt(year, 0);
  const safeSequence = toInt(sequence, 0);
  if (!laneCode || safeYear < 1900 || safeYear > 9999 || safeSequence < 1) return '';
  return `${laneCode}${safeYear}.${safeSequence}`;
}

export function buildCycleLabel({ lane, year, sequence }) {
  const cycleCode = buildCycleCode({ lane, year, sequence });
  if (!cycleCode) return '';
  return `IN DEX ${cycleCode}`;
}

export function parseCycleCode(value) {
  const raw = toText(value).toUpperCase().replace(/^IN\s+DEX\s+/, '');
  const miniMatch = raw.match(/^MINI-?DEX(\d{4})\.(\d+)$/);
  if (miniMatch) {
    const year = toInt(miniMatch[1], 0);
    const sequence = toInt(miniMatch[2], 0);
    return {
      lane: 'mini-dex',
      laneCode: 'MINIDEX',
      year,
      sequence,
      cycleCode: `MINIDEX${year}.${sequence}`,
      cycleLabel: `IN DEX MINIDEX${year}.${sequence}`,
    };
  }

  const match = raw.match(/^([ABC])(\d{4})\.(\d+)$/);
  if (!match) return null;
  const lane = laneFromCode(match[1]);
  const year = toInt(match[2], 0);
  const sequence = toInt(match[3], 0);
  const laneCode = laneCodeFromLane(lane);
  if (!lane || !laneCode || year < 1900 || year > 9999 || sequence < 1) return null;
  return {
    lane,
    laneCode,
    year,
    sequence,
    cycleCode: `${laneCode}${year}.${sequence}`,
    cycleLabel: `IN DEX ${laneCode}${year}.${sequence}`,
  };
}

export function normalizeCallRef(input = {}) {
  const lane = normalizeCallLane(input.lane || laneFromCode(input.laneCode));
  const year = toInt(input.year, 0);
  const sequence = toInt(input.sequence, 0);

  let parsed = null;
  if (!lane && input.cycleCode) parsed = parseCycleCode(input.cycleCode);
  if (!lane && input.cycleLabel) parsed = parseCycleCode(input.cycleLabel);

  const finalLane = lane || parsed?.lane || '';
  const finalYear = year > 0 ? year : (parsed?.year || 0);
  const finalSequence = sequence > 0 ? sequence : (parsed?.sequence || 0);
  const laneCode = laneCodeFromLane(finalLane);

  const cycleCode = buildCycleCode({ lane: finalLane, year: finalYear, sequence: finalSequence });
  const cycleLabel = cycleCode ? `IN DEX ${cycleCode}` : '';

  return {
    lane: finalLane,
    laneCode,
    year: finalYear,
    sequence: finalSequence,
    cycleCode,
    cycleLabel,
  };
}

function sequencesFromCalls(calls = []) {
  const values = [];
  for (const call of Array.isArray(calls) ? calls : []) {
    const ref = normalizeCallRef(call || {});
    if (ref.sequence > 0) values.push(ref.sequence);
  }
  return values;
}

function sequencesFromPolls(polls = []) {
  const values = [];
  for (const poll of Array.isArray(polls) ? polls : []) {
    const ref = normalizeCallRef((poll && poll.callRef) || {});
    if (ref.sequence > 0) values.push(ref.sequence);
  }
  return values;
}

export function computeGlobalMaxInDexSequence({ calls = [], polls = [] } = {}) {
  const sequences = [...sequencesFromCalls(calls), ...sequencesFromPolls(polls)];
  if (!sequences.length) return 0;
  return Math.max(...sequences);
}

export function allocateNextInDexSequence({ calls = [], polls = [], min = 1 } = {}) {
  const maxSequence = computeGlobalMaxInDexSequence({ calls, polls });
  return Math.max(toInt(min, 1), maxSequence + 1);
}

export function assertUniqueCallSequences(calls = []) {
  const seen = new Map();
  for (const call of Array.isArray(calls) ? calls : []) {
    const ref = normalizeCallRef(call || {});
    if (!ref.sequence) continue;
    if (seen.has(ref.sequence)) {
      const prior = seen.get(ref.sequence);
      throw new Error(`Duplicate call sequence ${ref.sequence}: ${prior} and ${toText(call?.id) || 'unknown'}`);
    }
    seen.set(ref.sequence, toText(call?.id) || 'unknown');
  }
}

export function buildPollCallRef({ year, sequence }) {
  const safeYear = toInt(year, 0);
  const safeSequence = toInt(sequence, 0);
  const cycleCode = buildCycleCode({ lane: 'in-dex-c', year: safeYear, sequence: safeSequence });
  return {
    group: 'inDex',
    lane: 'in-dex-c',
    year: safeYear,
    sequence: safeSequence,
    cycleCode,
    cycleLabel: cycleCode ? `IN DEX ${cycleCode}` : '',
  };
}

export function sortCallsBySequenceDesc(calls = []) {
  return [...(Array.isArray(calls) ? calls : [])].sort((a, b) => {
    const left = normalizeCallRef(a || {}).sequence;
    const right = normalizeCallRef(b || {}).sequence;
    if (left !== right) return right - left;
    return toText(a?.id).localeCompare(toText(b?.id));
  });
}
