import test from 'node:test';
import assert from 'node:assert/strict';
import { newAir, stepAir, jetHeld, eyeAt } from '../src/app/tornado/engine/net/flight.js';
import { JETPACK } from '../src/app/tornado/engine/hero/jetpack.js';

const fly = (st, jet, dt = 0.05, ground = 0, up = true) => stepAir(st, { jet, up }, dt, ground, JETPACK);
const run = (st, jet, seconds, ground = 0, up = true) => {
  let s = st;
  for (let t = 0; t < seconds; t += 0.05) s = fly(s, jet, 0.05, ground, up);
  return s;
};

test('on the ground without Space nothing happens', () => {
  assert.deepEqual(fly(newAir(), false), newAir());
});

test('Space lights the pack at once: off the ground on the first step, no double jump', () => {
  const s = fly(newAir(), true);
  assert.equal(s.air, true);
  assert.ok(s.alt > 0);
});

test('held, it climbs towards the climb speed; let go it sinks at the hover speed, and lands', () => {
  const up = run(newAir(), true, 2);
  assert.ok(up.alt > 10);
  assert.ok(Math.abs(up.vy - JETPACK.climbSpeed) < 0.5);
  const sinking = run(up, false, 1);
  assert.ok(Math.abs(sinking.vy + JETPACK.hoverSink) < 0.2);
  const landed = run(up, false, 30);
  assert.deepEqual(landed, newAir());
});

test('no fuel: it still climbs after a long burn', () => {
  const s = run(newAir(), true, 60);
  assert.equal(s.air, true);
  assert.ok(s.alt > 100);
});

test('it lands on a roof, not the street, and stands on it', () => {
  const s = run(run(newAir(), true, 1), false, 20, 12);
  assert.equal(s.alt, 12);
  assert.equal(s.air, false);
});

test('walking off a roof falls; a downed guest in the air falls under gravity, faster than the hover', () => {
  assert.equal(fly({ alt: 12, vy: 0, air: false }, false, 0.05, 0).air, true);
  const fell = run({ alt: 30, vy: 0, air: true }, false, 1, 0, false);
  assert.ok(fell.vy < -JETPACK.hoverSink * 3);
});

test('the input state is not mutated', () => {
  const st = Object.freeze(newAir());
  assert.doesNotThrow(() => fly(st, true));
});

test('jetHeld: a guest with no input yet never flies (null and undefined do not throw)', () => {
  assert.equal(jetHeld(null, true, 16), false);
  assert.equal(jetHeld(undefined, true, 16), false);
});

test('jetHeld: needs the Space bit and a guest who can move', () => {
  assert.equal(jetHeld({ abil: 16 }, true, 16), true);
  assert.equal(jetHeld({ abil: 1 | 8 }, true, 16), false);
  assert.equal(jetHeld({ abil: 16 | 1 }, true, 16), true);
  assert.equal(jetHeld({ abil: 16 }, false, 16), false);
});

test('eyeAt: eye height on the ground, plus the altitude in the air', () => {
  assert.equal(eyeAt(0, 1.4), 1.4);
  assert.ok(Math.abs(eyeAt(12.5, 1.4) - 13.9) < 1e-9);
});

test('eyeAt: a missing or negative altitude counts as the ground', () => {
  assert.equal(eyeAt(undefined, 1.4), 1.4);
  assert.equal(eyeAt(-3, 1.4), 1.4);
});
