import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSILE, stepMissile } from '../src/app/tornado/engine/aliens/missiles.js';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';

/** Flies a missile at a moving target; returns the seconds it took, or Infinity. */
function chase(move) {
  const m = { x: 0, y: 34, z: 0, dx: 1, dy: -0.35, dz: 0, speed: MISSILE.speed0, age: 0 };
  const n = Math.hypot(m.dx, m.dy);
  m.dx /= n; m.dy /= n;
  const dt = 1 / 60;
  for (let t = 0; t < MISSILE.life; t += dt) {
    const p = move(t);
    stepMissile(m, p, dt);
    if (Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z) < MISSILE.hitRadius) return t;
  }
  return Infinity;
}

test('it is faster than Roger runs', () => {
  assert.ok(MISSILE.speed1 > 9 * 2);
});

test('running straight away from it does not lose it', () => {
  const t = chase((t) => ({ x: -50 - 9 * t, y: 1.1, z: 0 }));
  assert.ok(t < MISSILE.life, `${t}`);
});

test('running in circles round it does not lose it either', () => {
  const t = chase((t) => ({ x: 40 + Math.cos(t * 0.6) * 15, y: 1.1, z: Math.sin(t * 0.6) * 15 }));
  assert.ok(t < MISSILE.life, `${t}`);
});

test('it turns no faster than MISSILE.turn', () => {
  const m = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, speed: 10, age: 0 };
  stepMissile(m, { x: -10, y: 0, z: 0.001 }, 0.1);
  const turned = Math.acos(m.dx);
  assert.ok(turned <= MISSILE.turn * 0.1 + 1e-6, `${turned}`);
});

test('it hurts Roger (and Invincible still holds)', () => {
  const d = HEALTH.damage.alienMissile;
  assert.ok(d.amount > 0 && d.amount < 100);
  assert.ok(!d.instantKill);
});
