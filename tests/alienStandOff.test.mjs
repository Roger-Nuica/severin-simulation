import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAND_OFF, standOffStep } from '../src/app/tornado/engine/aliens/standOff.js';

test('far off, it closes in', () => {
  const s = standOffStep(100, 0, 1);
  assert.ok(s.x > 0.9, JSON.stringify(s));
});

test('too close, it backs away', () => {
  const s = standOffStep(10, 0, 1);
  assert.ok(s.x < -0.5, JSON.stringify(s));
});

test('on the ring, it circles him and never stands still', () => {
  for (const d of [STAND_OFF.near, STAND_OFF.ring - 4, STAND_OFF.ring, STAND_OFF.ring + 4]) {
    const s = standOffStep(d, 0, 1);
    assert.ok(Math.abs(Math.hypot(s.x, s.z) - 1) < 1e-9);
    if (d === STAND_OFF.ring) assert.ok(Math.abs(s.z) > 0.99, JSON.stringify(s));
  }
});

test('walking it settles at about the ring and keeps moving', () => {
  let x = 0;
  let z = 0;
  const rx = 90;
  let moved = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const s = standOffStep(rx - x, 0 - z, 1);
    x += s.x * 6 / 60;
    z += s.z * 6 / 60;
    moved += 6 / 60;
  }
  const d = Math.hypot(rx - x, z);
  assert.ok(d > STAND_OFF.near - 1 && d < STAND_OFF.ring + 9, `${d}`);
  assert.ok(moved > 200);
});
