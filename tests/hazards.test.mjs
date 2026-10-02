import test from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';
import { IDLE_DOT, stepDot } from '../src/app/tornado/engine/health/dot.js';
import { IDLE_ONCE, onceDue, onceNext } from '../src/app/tornado/engine/health/hazards.js';

const L = HEALTH.damage.lava.interval;

/** Runs lava contact for `seconds`; returns the tick times. */
const lava = (seconds, dt = 1 / 60) => {
  let state = IDLE_DOT;
  const times = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const r = stepDot(state, true, dt, L);
    state = r.state;
    for (let k = 0; k < r.ticks; k++) times.push(t);
  }
  return times;
};

test('lava hits on first contact then every 1.5 s', () => {
  const times = lava(4.6);
  assert.equal(times.length, 4);
  assert.ok(times[0] < 0.02);
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - 1.5) < 0.02);
});

test('lava interval clears the hit window and amount is 50', () => {
  assert.ok(L > HEALTH.timers.hitInvulnerability);
  assert.equal(HEALTH.damage.lava.amount, 50);
});

test('stepping off lava resets, so re-contact hits at once', () => {
  let r = stepDot(IDLE_DOT, true, 0.1, L);
  r = stepDot(r.state, false, 0.1, L);
  assert.equal(r.state, IDLE_DOT);
  assert.equal(stepDot(r.state, true, 0.1, L).ticks, 1);
});

test('flood hits once per event while the crest touches', () => {
  let s = IDLE_ONCE;
  let hits = 0;
  for (let i = 0; i < 100; i++) {
    const due = onceDue(s, true, true);
    if (due) hits++;
    s = onceNext(s, true, due);
  }
  assert.equal(hits, 1);
  assert.equal(HEALTH.damage.flood.amount, 50);
});

test('flood latch holds if the hit did not land, then retries', () => {
  let s = IDLE_ONCE;
  assert.ok(onceDue(s, true, true));
  s = onceNext(s, true, false);
  assert.ok(onceDue(s, true, true));
});

test('a new flood event can hit again once the last one ended', () => {
  let s = onceNext(IDLE_ONCE, true, true);
  assert.equal(onceDue(s, true, true), false);
  s = onceNext(s, false, false);
  assert.equal(s, IDLE_ONCE);
  assert.ok(onceDue(s, true, true));
});

test('no hit without contact or while the flood is idle', () => {
  assert.equal(onceDue(IDLE_ONCE, false, true), false);
  assert.equal(onceDue(IDLE_ONCE, true, false), false);
});
