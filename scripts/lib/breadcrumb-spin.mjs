const MIN_TURNS = 2;
const MAX_TURNS = 3;
const MIN_DURATION_SECONDS = 1.0;
const MAX_DURATION_SECONDS = 1.3;

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 0) return 0;
  if (numeric >= 1) return 1;
  return numeric;
}

function asFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function pickSpinProfile(rng = Math.random) {
  const pick = typeof rng === 'function' ? rng : Math.random;
  const directionRoll = clamp01(pick());
  const turnsRoll = clamp01(pick());
  const durationRoll = clamp01(pick());

  const direction = directionRoll < 0.5 ? -1 : 1;
  const turns = MIN_TURNS + (MAX_TURNS - MIN_TURNS) * turnsRoll;
  const duration = MIN_DURATION_SECONDS + (MAX_DURATION_SECONDS - MIN_DURATION_SECONDS) * durationRoll;

  return { direction, turns, duration };
}

export function nextTargetDeg(currentDeg, direction, turns) {
  const current = asFinite(currentDeg, 0);
  const spinDirection = Number(direction) < 0 ? -1 : 1;
  const fullTurns = asFinite(turns, MIN_TURNS);
  return current + (spinDirection * fullTurns * 360);
}

export function normalizeDeg(deg) {
  const value = asFinite(deg, 0);
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function createSpinPlan(currentDeg, rng = Math.random) {
  const startDeg = asFinite(currentDeg, 0);
  const profile = pickSpinProfile(rng);
  return {
    ...profile,
    startDeg,
    targetDeg: nextTargetDeg(startDeg, profile.direction, profile.turns),
  };
}
