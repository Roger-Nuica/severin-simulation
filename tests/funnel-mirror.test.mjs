import test from 'node:test';
import assert from 'node:assert/strict';
import { newTargets, newShown, readTargets, stepShown, easeTo, crossedUp, resetShown, FUNNEL_SLOTS } from '../src/app/tornado/engine/net/funnelMirror.js';
import { twRow } from '../src/app/tornado/engine/net/fxOut.js';

const rows = (...rs) => new Map(rs.map((r) => [r[0], r]));

test('rows map to targets by id; a funnel without a tw row is full grown and upright', () => {
  const t = newTargets();
  readTargets(t, rows([0, 10, -20, 14], [2, 5, 6, 18]), [twRow(2, 0.5, 2.4, 0.8, 0.1, -0.2)]);
  assert.equal(t[0].present, true);
  assert.deepEqual([t[0].x, t[0].z, t[0].radius, t[0].birth, t[0].sizeMul, t[0].hasTw], [10, -20, 14, 1, 1, false]);
  assert.equal(t[1].present, false);
  assert.deepEqual([t[2].birth, t[2].sizeMul, t[2].fade, t[2].leanX, t[2].leanZ, t[2].hasTw], [0.5, 2.4, 0.8, 0.1, -0.2, true]);
});

test('a tw row without a tornado row, or with an id out of range, is ignored', () => {
  const t = newTargets();
  readTargets(t, rows([0, 1, 1, 14]), [twRow(1, 0.5, 1, 1, 0, 0), [99, 1, 1, 1, 0, 0]]);
  assert.equal(t[1].present, false);
  assert.equal(t[1].hasTw, false);
  assert.equal(t.length, FUNNEL_SLOTS);
});

test('targets reset in place each read: a funnel that is gone is not present', () => {
  const t = newTargets();
  readTargets(t, rows([0, 1, 1, 14], [1, 2, 2, 14]), null);
  readTargets(t, rows([0, 1, 1, 14]), null);
  assert.equal(t[1].present, false);
  readTargets(t, null, null);
  assert.equal(t[0].present, false);
});

test('a funnel that appears starts at no birth and ropes down towards the host', () => {
  const s = newShown(1)[0];
  const target = { present: true, hasTw: true, x: 3, z: 4, radius: 16, birth: 1, sizeMul: 2, fade: 1, leanX: 0.2, leanZ: 0 };
  stepShown(s, target, 0.016);
  assert.equal(s.on, true);
  assert.equal(s.sizeMul, 2);
  assert.ok(s.birth > 0 && s.birth < 0.2);
  assert.deepEqual([s.x, s.z, s.radius], [3, 4, 16]);
  for (let i = 0; i < 120; i++) stepShown(s, target, 0.016);
  assert.ok(s.birth > 0.99);
});

test('a funnel that goes away ropes out and is then off', () => {
  const s = newShown(1)[0];
  const target = { present: true, hasTw: true, x: 0, z: 0, radius: 14, birth: 1, sizeMul: 1, fade: 1, leanX: 0, leanZ: 0 };
  for (let i = 0; i < 200; i++) stepShown(s, target, 0.016);
  target.present = false;
  stepShown(s, target, 0.016);
  assert.equal(s.on, true);
  for (let i = 0; i < 200; i++) stepShown(s, target, 0.016);
  assert.equal(s.on, false);
  assert.equal(s.birth, 0);
});

test('easing never overshoots and a zero step holds', () => {
  assert.equal(easeTo(0.5, 1, 0), 0.5);
  assert.ok(easeTo(0, 1, 10) <= 1);
  assert.ok(easeTo(0, 1, 0.1) > 0);
});

test('the touchdown is the host birth crossing the line, never a funnel first seen grown', () => {
  assert.equal(crossedUp(0.3, 0.35, 0.32), true);
  assert.equal(crossedUp(-1, 1, 0.32), false);
  assert.equal(crossedUp(0.5, 0.6, 0.32), false);
  assert.equal(crossedUp(0.1, 0.2, 0.32), false);
});

test('resetShown puts every record back to not in play', () => {
  const sh = newShown(2);
  sh[0].on = true; sh[0].birth = 1; sh[1].sizeMul = 3;
  resetShown(sh);
  assert.deepEqual([sh[0].on, sh[0].birth, sh[1].sizeMul], [false, 0, 1]);
});
