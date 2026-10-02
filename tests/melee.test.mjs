import test from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';
import { createTouchState, touchAttempt } from '../src/app/tornado/engine/health/melee.js';

const alien = { source: 'alienTouch' };

test('a touch inside reach lands with the configured damage', () => {
  const r = touchAttempt(createTouchState(), 2, HEALTH, 10);
  assert.equal(r.damage, 50);
  assert.equal(r.state.lastTouchAt, 10);
  assert.equal(touchAttempt(createTouchState(), 1, HEALTH, 0, alien).damage, 34);
});

test('out of reach never touches and leaves the state unchanged', () => {
  const s = createTouchState();
  const r = touchAttempt(s, 2.01, HEALTH, 10);
  assert.equal(r.damage, 0);
  assert.equal(r.state, s);
});

test('the 3 s cooldown blocks a second touch, then releases', () => {
  const first = touchAttempt(createTouchState(), 1, HEALTH, 10);
  assert.equal(touchAttempt(first.state, 1, HEALTH, 12.9).damage, 0);
  assert.equal(touchAttempt(first.state, 1, HEALTH, 13).damage, 50);
});

test('two attackers keep independent cooldowns', () => {
  const a = touchAttempt(createTouchState(), 1, HEALTH, 10);
  const b = touchAttempt(createTouchState(), 1, HEALTH, 10.5);
  assert.equal(a.damage, 50);
  assert.equal(b.damage, 50);
  assert.equal(touchAttempt(a.state, 1, HEALTH, 11).damage, 0);
});

test('a knocked-down attacker never touches and keeps its cooldown', () => {
  const s = createTouchState();
  const r = touchAttempt(s, 0.5, HEALTH, 10, { staggered: true });
  assert.equal(r.damage, 0);
  assert.equal(r.state.lastTouchAt, null);
  assert.equal(touchAttempt(r.state, 0.5, HEALTH, 10.1).damage, 50);
});

test('the input state is never mutated', () => {
  const s = createTouchState();
  touchAttempt(s, 1, HEALTH, 10);
  assert.equal(s.lastTouchAt, null);
});

// ---- Telegraph (Subtask 9) -------------------------------------------------
import { meleeStep, telegraphArm, telegraphGlow } from '../src/app/tornado/engine/health/melee.js';

const M = HEALTH.melee;

test('inside 6 m an idle attacker winds up once and the cue fires once', () => {
  const a = meleeStep(createTouchState(), 6, HEALTH, 10);
  assert.equal(a.state.phase, 'windup');
  assert.equal(a.windupStarted, true);
  const b = meleeStep(a.state, 5, HEALTH, 10.3);
  assert.equal(b.windupStarted, false);
  assert.equal(b.state.phase, 'windup');
  assert.equal(meleeStep(createTouchState(), 6.01, HEALTH, 10).state.phase, 'idle');
});

test('the wind-up ends in a landed strike when Roger is within reach', () => {
  const a = meleeStep(createTouchState(), 6, HEALTH, 10);
  const r = meleeStep(a.state, 2, HEALTH, 10 + M.windUp + 0.01);
  assert.equal(r.struck, true);
  assert.equal(r.damage, 50);
  assert.equal(r.state.phase, 'strike');
});

test('leaving reach during the wind-up makes the strike miss, and it recovers inside the cooldown', () => {
  const a = meleeStep(createTouchState(), 6, HEALTH, 10);
  const miss = meleeStep(a.state, 3, HEALTH, 10 + M.windUp + 0.01);
  assert.equal(miss.struck, true);
  assert.equal(miss.damage, 0);
  const t0 = 10 + M.windUp + 0.01;
  const rec = meleeStep(miss.state, 3, HEALTH, t0 + M.strikeSeconds + 0.01);
  assert.equal(rec.state.phase, 'recover');
  const idle = meleeStep(rec.state, 3, HEALTH, t0 + M.strikeSeconds + M.recoverSeconds + 0.02);
  assert.equal(idle.state.phase, 'idle');
  assert.ok(M.strikeSeconds + M.recoverSeconds < M.cooldown);
  // Cooldown still holds: no new wind-up until 3 s after the strike.
  assert.equal(meleeStep(idle.state, 3, HEALTH, t0 + M.cooldown - 0.1).state.phase, 'idle');
  assert.equal(meleeStep(idle.state, 3, HEALTH, t0 + M.cooldown).state.phase, 'windup');
});

test('a knocked-down attacker never winds up and cancels a wind-up in progress', () => {
  assert.equal(meleeStep(createTouchState(), 3, HEALTH, 10, { staggered: true }).state.phase, 'idle');
  const a = meleeStep(createTouchState(), 3, HEALTH, 10);
  const down = meleeStep(a.state, 3, HEALTH, 10.2, { staggered: true });
  assert.equal(down.state.phase, 'idle');
  assert.equal(down.damage, 0);
});

test('pose helpers: raised through the wind-up, none when idle', () => {
  const a = meleeStep(createTouchState(), 3, HEALTH, 0);
  assert.equal(telegraphArm(createTouchState(), 0, HEALTH), null);
  assert.ok(telegraphArm(a.state, M.windUp, HEALTH) < -2);
  assert.equal(telegraphGlow(a.state, M.windUp / 2, HEALTH), 0.5);
  assert.equal(telegraphGlow(createTouchState(), 0, HEALTH), 0);
});
