import test from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';
import { IDLE_DOT, stepDot, dotAmount } from '../src/app/tornado/engine/health/dot.js';
import { createHealthState, applyDamage, stepRegen } from '../src/app/tornado/engine/health/state.js';

const I = HEALTH.dot.interval;

/** Runs a hazard for `seconds` in frames of `dt`; returns the tick times. */
const run = (contact, seconds, dt = 1 / 60, start = IDLE_DOT) => {
  let state = start;
  const times = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const r = stepDot(state, contact, dt, I);
    state = r.state;
    for (let k = 0; k < r.ticks; k++) times.push(t);
  }
  return { state, times };
};

test('the interval clears the 0.2 s hit window', () => {
  assert.ok(I > HEALTH.timers.hitInvulnerability);
});

test('the first tick lands on contact, then one every interval', () => {
  const { times } = run(true, 1.01);
  assert.equal(times.length, 5);
  assert.ok(times[0] < 0.02);
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - I) < 0.02);
});

test('no ticks and no accumulation out of contact', () => {
  const { state, times } = run(false, 5);
  assert.equal(times.length, 0);
  assert.deepEqual(state, IDLE_DOT);
});

test('leaving contact resets the accumulator; re-entering ticks at once', () => {
  const mid = run(true, 0.1).state;
  assert.ok(mid.acc > 0);
  assert.deepEqual(stepDot(mid, false, 0.016, I), { state: IDLE_DOT, ticks: 0 });
  assert.equal(stepDot(IDLE_DOT, true, 0.016, I).ticks, 1);
});

test('a long frame yields every due tick; zero dt yields none', () => {
  assert.equal(stepDot(IDLE_DOT, true, 0.6, I).ticks, 3);
  assert.equal(stepDot(IDLE_DOT, true, 0, I).ticks, 0);
});

test('T-Rex flames kill in about 3 s of continuous exposure, through the hit window', () => {
  const per = HEALTH.damage.trexFlame.amount;
  let hp = createHealthState(HEALTH);
  let dot = IDLE_DOT;
  let t = 0;
  const dt = 1 / 60;
  while (hp.value > 0 && t < 5) {
    const r = stepDot(dot, true, dt, I);
    dot = r.state;
    if (r.ticks) hp = applyDamage(hp, { source: 'trexFlame', amount: dotAmount(per, I, r.ticks), type: 'fire', position: null, targetId: '0', instantKill: false }, HEALTH);
    hp = stepRegen(hp, dt, HEALTH);
    t += dt;
  }
  assert.equal(hp.value, 0);
  assert.ok(t > 2.9 && t < 3.2, `died at ${t}`);
});

test('ordinary fire removes 10 a second', () => {
  const { times } = run(true, 3.0);
  assert.ok(Math.abs(times.length * dotAmount(HEALTH.damage.ordinaryFire.amount, I, 1) - 30) <= 2.5);
});
