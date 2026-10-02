import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';
import { createHealthState, applyDamage, stepRegen, glowLevel } from '../src/app/tornado/engine/health/state.js';

const ev = (o = {}) => ({ source: 'alienRay', amount: 20, type: 'ray', position: null, targetId: '0', instantKill: false, ...o });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

/** Runs stepRegen in small steps up to `seconds` of player time. */
const run = (state, seconds, dt = 0.05) => {
  let s = state;
  for (let t = 0; t < seconds - 1e-9; t += dt) s = stepRegen(s, Math.min(dt, seconds - t), HEALTH);
  return s;
};

const hurt = (amount) => applyDamage(createHealthState(HEALTH), ev({ amount }), HEALTH);

test('a new state is full and applyDamage returns a new object', () => {
  const s = createHealthState(HEALTH);
  const h = applyDamage(s, ev(), HEALTH);
  assert.equal(s.value, 100);
  assert.equal(h.value, 80);
  assert.equal(h.lastSource, 'alienRay');
});

test('glow is zero until 4 s, then rises to full at 7 s', () => {
  let s = run(hurt(20), 3.9);
  assert.equal(glowLevel(s, HEALTH), 0);
  s = run(hurt(20), 4);
  assert.equal(glowLevel(s, HEALTH), 0);
  s = run(hurt(20), 5.5);
  near(glowLevel(s, HEALTH), 0.5);
  s = run(hurt(20), 7);
  near(glowLevel(s, HEALTH), 1);
});

test('no healing before 7 s; refill starts at 7 s', () => {
  const s = run(hurt(50), 6.95);
  assert.equal(s.value, 50);
  assert.equal(s.refilling, false);
  const r = run(hurt(50), 7.5);
  assert.equal(r.refilling, true);
  near(r.value, 50 + 25 * 0.5);
});

test('refill is a constant rate: near-empty is full about 11 s after the hit', () => {
  const s0 = hurt(99);
  const at = (t) => run(s0, t).value;
  assert.ok(at(10.9) < 100);
  near(at(11), 100, 1e-6);
  const done = run(s0, 11.05);
  assert.equal(done.value, 100);
  assert.equal(done.refilling, false);
  assert.equal(glowLevel(done, HEALTH), 0);
});

test('a large dt crossing the delay only counts the time past 7 s', () => {
  const s = stepRegen(hurt(50), 8, HEALTH);
  near(s.value, 75);
});

test('any damage cancels glow and refill', () => {
  const refilling = run(hurt(50), 8);
  assert.equal(refilling.refilling, true);
  const again = applyDamage(refilling, ev({ amount: 10 }), HEALTH);
  assert.equal(again.refilling, false);
  assert.equal(again.sinceLastDamage, 0);
  assert.equal(glowLevel(again, HEALTH), 0);
  const glowing = run(hurt(20), 5.5);
  const hit = applyDamage(glowing, ev({ amount: 10 }), HEALTH);
  assert.equal(glowLevel(hit, HEALTH), 0);
});

test('0.2 s invulnerability ignores non-instant hits only', () => {
  const s = hurt(20);
  assert.equal(applyDamage(s, ev({ amount: 30 }), HEALTH), s);
  const later = stepRegen(s, 0.1, HEALTH);
  assert.equal(applyDamage(later, ev({ amount: 30 }), HEALTH), later);
  const open = stepRegen(s, 0.2, HEALTH);
  assert.equal(applyDamage(open, ev({ amount: 30 }), HEALTH).value, 50);
});

test('instant kill bypasses the hit window and regeneration', () => {
  const s = hurt(20);
  assert.equal(applyDamage(s, ev({ amount: 100, instantKill: true, source: 'yeti' }), HEALTH).value, 0);
  assert.equal(applyDamage(s, ev({ amount: 101 }), HEALTH).value, 0);
  const k = applyDamage(run(hurt(50), 8), ev({ amount: 100, instantKill: true }), HEALTH);
  assert.equal(k.value, 0);
  assert.equal(k.refilling, false);
  assert.equal(k.sinceLastDamage, 0);
});

test('DoT ticks reset the timer from the last tick', () => {
  let s = applyDamage(createHealthState(HEALTH), ev({ source: 'lava', amount: 50 }), HEALTH);
  s = run(s, 1.5);
  assert.equal(s.value, 50);
  s = applyDamage(s, ev({ source: 'lava', amount: 50 }), HEALTH);
  assert.equal(s.value, 0);
  assert.equal(s.sinceLastDamage, 0);
  let d = applyDamage(createHealthState(HEALTH), ev({ amount: 10 }), HEALTH);
  d = run(d, 6);
  d = applyDamage(d, ev({ amount: 10 }), HEALTH);
  d = run(d, 3);
  near(d.sinceLastDamage, 3);
  assert.equal(d.refilling, false);
});

test('dt of 0 (or negative) never regenerates or advances', () => {
  const s = run(hurt(50), 9);
  assert.equal(stepRegen(s, 0, HEALTH), s);
  assert.equal(stepRegen(s, -1, HEALTH), s);
});

test('daze and zero-damage events do not reset the timer', () => {
  const s = run(hurt(50), 5);
  for (const source of ['tornado', 'debris', 'ice']) {
    assert.equal(applyDamage(s, ev({ source, amount: 0, type: 'daze' }), HEALTH), s);
  }
  near(s.sinceLastDamage, 5);
});

// Subtask 13: daze and freeze never touch health or the regeneration timer.
const DAZE_SOURCES = ['tornado', 'debris', 'ice'];

test('tornado, debris and ice carry zero damage in the table', () => {
  for (const key of DAZE_SOURCES) {
    assert.equal(HEALTH.damage[key].amount, 0, `${key} must be daze/freeze only`);
    assert.notEqual(HEALTH.damage[key].kill, true, `${key} must never kill`);
  }
});

test('zero-damage daze, freeze, tornado, debris and ice events change nothing', () => {
  const regen = run(hurt(40), 5);
  const before = { ...regen };
  const glow = glowLevel(regen, HEALTH);
  for (const key of ['daze', 'freeze', ...DAZE_SOURCES]) {
    const amount = HEALTH.damage[key] ? HEALTH.damage[key].amount : 0;
    const after = applyDamage(regen, ev({ source: key, amount, type: key }), HEALTH);
    assert.equal(after, regen, `${key} must return the same state object`);
    assert.deepEqual(after, before);
    assert.equal(after.sinceLastDamage, before.sinceLastDamage);
    assert.equal(glowLevel(after, HEALTH), glow);
  }
});

test('daze and freeze source files never call damagePlayer', () => {
  const root = new URL('../src/app/tornado/engine/', import.meta.url);
  const files = ['hero/movement.js', 'hero/car.js', 'effects/freeze.js', 'blizzard.js', 'debrisImpacts.js'];
  for (const f of files) {
    const src = readFileSync(new URL(f, root), 'utf8');
    assert.ok(!/damagePlayer|systems\.health/.test(src), `${f} must not reach the health system`);
  }
  // The Yeti may only call it for its one-shot blow (R-038).
  const yeti = readFileSync(new URL('yeti.js', root), 'utf8');
  assert.equal((yeti.match(/damagePlayer\(/g) || []).length, 1, 'yeti.js: only the blow may damage');
  assert.match(yeti, /damagePlayer\(\{\s*source: 'yeti', instantKill: true/);
});

test('refillStarted is true only on the step where refilling turns on', async () => {
  const { refillStarted, isLowHealth } = await import('../src/app/tornado/engine/health/state.js');
  const { beatPeriod } = await import('../src/app/tornado/engine/sound/healthAudio.js');
  const hit = hurt(60);
  assert.equal(refillStarted(hit, stepRegen(hit, 3, HEALTH)), false);
  const waiting = run(hit, 6.9);
  const started = stepRegen(waiting, 0.3, HEALTH);
  assert.equal(refillStarted(waiting, started), true);
  assert.equal(refillStarted(started, stepRegen(started, 0.1, HEALTH)), false);
  assert.equal(isLowHealth(hurt(70), HEALTH), true);
  assert.equal(isLowHealth(hurt(69), HEALTH), false);
  assert.equal(isLowHealth(hurt(100), HEALTH), false);
  assert.ok(beatPeriod(0.05, HEALTH.lowThreshold) < beatPeriod(0.3, HEALTH.lowThreshold));
});

// ---- co-op: per-player state (Subtask 20) ----
test('isHittable: only an up player past the revive shield can be hurt', async () => {
  const { isHittable } = await import('../src/app/tornado/engine/health/state.js');
  assert.equal(isHittable({ state: 'up', shield: 0 }), true);
  assert.equal(isHittable({ state: 'up', shield: 1.5 }), false);
  assert.equal(isHittable({ state: 'down', shield: 0 }), false);
  assert.equal(isHittable({ state: 'dead', shield: 0 }), false);
  assert.equal(isHittable(null), false);
  assert.equal(isHittable(undefined), false);
});

test('revivedState returns full health with timers cleared', async () => {
  const { revivedState } = await import('../src/app/tornado/engine/health/state.js');
  const s = revivedState(HEALTH);
  assert.equal(s.value, HEALTH.max);
  assert.equal(s.sinceLastDamage, 0);
  assert.equal(s.refilling, false);
  assert.equal(s.invuln, 0);
});

test('a guest and Roger keep separate health in their own states', () => {
  const roger = applyDamage(createHealthState(HEALTH), ev({ amount: 34 }), HEALTH);
  const guest = applyDamage(createHealthState(HEALTH), ev({ amount: 50, targetId: '1' }), HEALTH);
  assert.equal(roger.value, 66);
  assert.equal(guest.value, 50);
});
