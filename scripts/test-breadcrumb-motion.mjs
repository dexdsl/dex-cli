import assert from 'node:assert/strict';
import { createSpinPlan, nextTargetDeg, normalizeDeg, pickSpinProfile } from './lib/breadcrumb-spin.mjs';

function makeDeterministicRng(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeSequenceRng(values) {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
}

{
  const rng = makeDeterministicRng(42);
  for (let i = 0; i < 1000; i += 1) {
    const profile = pickSpinProfile(rng);
    assert.ok(profile.direction === -1 || profile.direction === 1, 'direction must be -1 or 1');
    assert.ok(profile.turns >= 2 && profile.turns <= 3, 'turns must stay in [2, 3]');
    assert.ok(profile.duration >= 1.0 && profile.duration <= 1.3, 'duration must stay in [1.0, 1.3]');
  }
}

{
  const profile = pickSpinProfile(makeSequenceRng([0.3, 0.6, 0.5]));
  assert.equal(profile.direction, -1, 'direction roll under 0.5 should map to counter-clockwise');
  assert.equal(profile.turns, 2.6, 'turns should map linearly from rng to [2, 3]');
  assert.equal(profile.duration, 1.15, 'duration should map linearly from rng to [1.0, 1.3]');
}

{
  assert.equal(nextTargetDeg(120, 1, 2.25), 930, 'clockwise target should add turns from current angle');
  assert.equal(nextTargetDeg(120, -1, 2.25), -690, 'counter-clockwise target should subtract turns from current angle');
  assert.equal(normalizeDeg(1080), 0, 'normalizeDeg should wrap full rotations to 0');
  assert.equal(normalizeDeg(-30), 330, 'normalizeDeg should wrap negatives into [0, 360)');
}

{
  const first = createSpinPlan(0, makeSequenceRng([0.9, 0.2, 0.2]));
  const restart = createSpinPlan(173.5, makeSequenceRng([0.1, 0.8, 0.7]));
  const oldBase = nextTargetDeg(0, restart.direction, restart.turns);

  assert.equal(first.startDeg, 0, 'first spin should start from provided current angle');
  assert.equal(restart.startDeg, 173.5, 'restart spin should start from latest current angle');
  assert.notEqual(restart.targetDeg, oldBase, 'restart target must be computed from current in-flight angle');
}

console.log('test-breadcrumb-motion ok');
