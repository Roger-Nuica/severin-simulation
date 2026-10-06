import test from 'node:test';
import assert from 'node:assert/strict';
import { viewKeyAt, shownKey, swayOf, viewOffset } from '../src/app/tornado/engine/net/viewModel.js';
import { WEAPONS } from '../src/app/tornado/engine/net/protocol.js';

test('the viewmodel key follows the protocol wheel order (R-049)', () => {
  assert.deepEqual(WEAPONS.map((_, i) => viewKeyAt(i)), ['rifle', 'minigun', 'railgun', 'fire', 'blackhole', 'katana']);
});

test('an index off the wheel shows nothing', () => {
  for (const bad of [-1, 6, 1.5, NaN, undefined]) assert.equal(viewKeyAt(bad), null);
});

test('the model shows only while aim is held and Roger is up', () => {
  assert.equal(shownKey(true, true, 1), 'minigun');
  assert.equal(shownKey(false, true, 1), null);
  assert.equal(shownKey(true, false, 1), null);
  assert.equal(shownKey(true, true, 99), null);
});

test('sway is still when not walking and stays within -1..1', () => {
  assert.equal(swayOf(false, 3.7), 0);
  for (let t = 0; t < 5; t += 0.1) assert.ok(Math.abs(swayOf(true, t)) <= 1);
});

test('the offset is the host rifle placement at rest and moves with the sway', () => {
  const o = viewOffset({ x: 0, y: 0, z: 0 }, 0);
  assert.deepEqual(o, { x: 0.3, y: -0.3, z: -0.32 });
  const s = viewOffset({ x: 0, y: 0, z: 0 }, -1);
  assert.ok(Math.abs(s.x - 0.288) < 1e-9 && Math.abs(s.y - -0.288) < 1e-9);
});
