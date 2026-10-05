import test from 'node:test';
import assert from 'node:assert/strict';
import { stepMove } from '../src/app/tornado/engine/net/movement.js';

/** Hero values at the time of extraction (HERO.runSpeed 9, aimWalkSpeed 4, backSpeed 3.5, bound 288). */
const SPEEDS = { run: 9, aim: 4, back: 3.5 };
const BOUND = 288;
const open = () => true;

/**
 * The previous host `moveGuest`, copied verbatim (mutating, THREE clamp as min/max),
 * kept here as the golden reference.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const legacyMoveGuest = (p, input, dt, standable) => {
  const speed = (input.aim ? SPEEDS.aim : SPEEDS.run) * (input.mz < 0 ? SPEEDS.back / SPEEDS.run : 1);
  const mag = Math.hypot(input.mx, input.mz);
  if (mag < 1e-3) return;
  const k = Math.min(1, 1 / mag);
  const fx = Math.sin(input.yaw), fz = Math.cos(input.yaw);
  const rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);
  const dx = (fx * input.mz + rx * input.mx) * k * speed * dt;
  const dz = (fz * input.mz + rz * input.mx) * k * speed * dt;
  const nx = clamp(p.x + dx, -BOUND, BOUND);
  if (standable(nx, p.z)) p.x = nx;
  const nz = clamp(p.z + dz, -BOUND, BOUND);
  if (standable(p.x, nz)) p.z = nz;
};

/** Deterministic pseudo-random sequence (mulberry32). */
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('stepMove reproduces the previous moveGuest bit for bit over random inputs and walls', () => {
  const r = rng(42);
  const walls = (x, z) => !(x > 20 && x < 30 && z > -50 && z < 50) && !(z > 100 && z < 105);
  for (const standable of [open, walls]) {
    let a = { x: 0, z: 0 };
    let b = { x: 0, z: 0 };
    for (let i = 0; i < 5000; i++) {
      const input = {
        mx: Math.round(r() * 2 - 1), mz: Math.round(r() * 2 - 1) * (r() < 0.3 ? 0.5 : 1),
        yaw: (r() - 0.5) * 12, aim: r() < 0.3
      };
      const dt = 0.005 + r() * 0.05;
      legacyMoveGuest(a, input, dt, standable);
      b = stepMove(b, input, dt, standable, BOUND, SPEEDS);
      assert.deepEqual(b, a, 'step ' + i);
    }
  }
});

test('a diagonal is no faster than a straight move, and backwards and aiming are slower', () => {
  const dist = (input) => { const p = stepMove({ x: 0, z: 0 }, { yaw: 0, aim: false, ...input }, 1, open, BOUND, SPEEDS); return Math.hypot(p.x, p.z); };
  assert.ok(Math.abs(dist({ mx: 1, mz: 1 }) - 9) < 1e-9);
  assert.ok(Math.abs(dist({ mx: 0, mz: -1 }) - 3.5) < 1e-9);
  assert.ok(Math.abs(dist({ mx: 0, mz: 1, aim: true }) - 4) < 1e-9);
});

test('no input leaves the position unchanged and does not mutate the argument', () => {
  const pos = Object.freeze({ x: 3, z: 4 });
  assert.deepEqual(stepMove(pos, { mx: 0, mz: 0, yaw: 1, aim: false }, 0.1, open, BOUND, SPEEDS), { x: 3, z: 4 });
});

test('walls slide axis by axis and the map edge clamps', () => {
  const noX = (x) => x < 1;
  const slid = stepMove({ x: 0, z: 0 }, { mx: 0, mz: 1, yaw: Math.PI / 4, aim: false }, 0.5, noX, BOUND, SPEEDS);
  assert.equal(slid.x, 0, 'blocked on x');
  assert.ok(slid.z > 0, 'still moves on z');
  const edge = stepMove({ x: 287.9, z: 0 }, { mx: 0, mz: 1, yaw: Math.PI / 2, aim: false }, 1, open, BOUND, SPEEDS);
  assert.equal(edge.x, BOUND);
});
