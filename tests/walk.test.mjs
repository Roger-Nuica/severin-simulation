import test from 'node:test';
import assert from 'node:assert/strict';
import { stepRun, aimDirection, wrapAngle } from '../src/app/tornado/engine/hero/walk.js';
import { HERO } from '../src/app/tornado/engine/hero/config.js';

const keys = (o = {}) => ({ up: false, down: false, left: false, right: false, ...o });

test('on foot: A and D turn, W runs up to speed, nothing else moves the heading', () => {
  const st = { heading: 0, speed: 0 };
  stepRun(st, keys({ right: true }), 0.5);
  assert.ok(Math.abs(st.heading + HERO.turnRate * 0.5) < 1e-9, 'D turns right (heading falls)');
  assert.equal(st.speed, 0);
  for (let i = 0; i < 60; i++) stepRun(st, keys({ up: true }), 1 / 60);
  assert.equal(st.speed, HERO.runSpeed);
  for (let i = 0; i < 60; i++) stepRun(st, keys(), 1 / 60);
  assert.equal(st.speed, 0);
  for (let i = 0; i < 60; i++) stepRun(st, keys({ down: true }), 1 / 60);
  assert.equal(st.speed, -HERO.backSpeed);
});

test('aiming: D strafes to the screen right of the look, A to its left', () => {
  const out = { x: 0, z: 0 };
  for (const yaw of [0, 0.7, -2.1, 3]) {
    // A camera looking along (sin y, cos y) has its screen right at (-cos y, sin y).
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    aimDirection(yaw, 0, -1, out); // D: across = -1
    assert.ok(out.x * rx + out.z * rz > 0.99, `D at yaw ${yaw}`);
    aimDirection(yaw, 0, 1, out); // A
    assert.ok(out.x * rx + out.z * rz < -0.99, `A at yaw ${yaw}`);
    aimDirection(yaw, 1, 0, out); // W
    assert.ok(Math.abs(out.x - Math.sin(yaw)) < 1e-9 && Math.abs(out.z - Math.cos(yaw)) < 1e-9);
  }
});

test('wrapAngle keeps a much-turned look inside the protocol bound', () => {
  assert.ok(Math.abs(wrapAngle(13 * Math.PI + 0.25) - (-Math.PI + 0.25)) < 1e-9);
  for (const a of [-50, -7, 0, 7, 50]) assert.ok(Math.abs(wrapAngle(a)) <= Math.PI);
});
