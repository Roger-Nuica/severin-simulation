import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH, wrapAngle, stickFromDrag, heldFromStick, steerRun, pickAimTarget } from '../src/app/tornado/engine/hero/touchMath.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the stick: a dead zone, full travel at the rim, never past 1', () => {
  assert.deepEqual(stickFromDrag(3, 2), { x: 0, y: 0, mag: 0 }, 'a resting thumb is centred');
  const full = stickFromDrag(0, -TOUCH.stickRadius);
  assert.ok(close(full.mag, 1) && close(full.y, -1) && close(full.x, 0), 'up to the rim is full up');
  const past = stickFromDrag(300, 0);
  assert.ok(close(past.mag, 1) && close(past.x, 1), 'dragging past the rim stays at 1');
  const half = stickFromDrag(TOUCH.stickRadius * 0.5, 0);
  assert.ok(half.mag > 0 && half.mag < 0.5, 'half way is a walk, eased below half');
});

test('the stick as W A S D', () => {
  assert.deepEqual(heldFromStick(0, -1), { up: true, down: false, left: false, right: false });
  assert.deepEqual(heldFromStick(-0.7, 0.7), { up: false, down: true, left: true, right: false });
  assert.deepEqual(heldFromStick(0.2, -0.2), { up: false, down: false, left: false, right: false });
});

test('angles wrap into -π..π', () => {
  assert.ok(close(wrapAngle(Math.PI * 3), Math.PI) || close(wrapAngle(Math.PI * 3), -Math.PI));
  assert.ok(close(wrapAngle(-0.5 - Math.PI * 4), -0.5));
});

test('on foot the stick is relative to the camera, and Roger swings round smoothly', () => {
  // Camera looking along +z (yaw 0); Roger facing +z too.
  const ahead = steerRun(0, 0, 0, -1, 0.016);
  assert.ok(close(ahead.heading, 0) && close(ahead.speed, 1), 'up runs straight ahead');
  // Stick right: the screen's right is -x for a camera looking along +z (right of forward is (-fz, fx)).
  let h = 0;
  for (let i = 0; i < 120; i++) h = steerRun(h, 0, 1, 0, 1 / 60).heading;
  assert.ok(close(Math.sin(h), -1, 1e-3), 'held right, he ends up facing the screen right');
  const turning = steerRun(0, 0, 0, 1, 1 / 60);
  assert.ok(turning.speed <= 0.25 + 1e-9, 'a U-turn starts slow, not sliding backwards');
  assert.ok(Math.abs(turning.heading) <= TOUCH.steerRate / 60 + 1e-9, 'turning at most the steer rate');
  assert.deepEqual(steerRun(0.7, 0, 0, 0, 0.016), { heading: 0.7, speed: 0 }, 'no stick, no change');
});

test('aim assist picks the target nearest the crosshair inside the cone and range', () => {
  const eye = { x: 0, y: 2, z: 0 };
  const targets = [
    { x: 20, y: 2, z: 100 },  // ~11° off: outside a 0.16 rad cone
    { x: 5, y: 3, z: 100 },   // ~3° off
    { x: 0, y: 2, z: 400 },   // dead ahead but out of range
    { x: 0, y: 2, z: -50 }    // behind
  ];
  const pick = pickAimTarget(eye, 0, 0, targets);
  assert.equal(pick?.index, 1);
  assert.ok(pick.yaw > 0 && pick.pitch > 0);
  assert.equal(pickAimTarget(eye, Math.PI / 2, 0, targets), null, 'looking away: nothing to help with');
});
