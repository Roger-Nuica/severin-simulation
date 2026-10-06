import test from 'node:test';
import assert from 'node:assert/strict';
import { heldKey, HELD_PARTS } from '../src/app/tornado/engine/net/heldWeapon.js';
import { WEAPONS } from '../src/app/tornado/engine/net/protocol.js';

test('the held weapon follows the protocol wheel, Katana sixth (R-049)', () => {
  assert.deepEqual(WEAPONS.map((_, i) => heldKey(i, true, false)), ['rifle', 'minigun', 'railgun', 'fire', 'blackhole', 'katana']);
});

test('nothing is held while down, dead or seated', () => {
  assert.equal(heldKey(1, false, false), null);
  assert.equal(heldKey(1, true, true), null);
});

test('an index off the wheel holds nothing', () => {
  for (const bad of [-1, 6, 2.5, NaN, undefined]) assert.equal(heldKey(bad, true, false), null);
});

test('every wheel weapon but the Katana has a small part list', () => {
  for (const key of WEAPONS.filter((k) => k !== 'katana')) {
    const parts = HELD_PARTS[key];
    assert.ok(parts && parts.length >= 1 && parts.length <= 3, key);
    for (const p of parts) assert.equal(p.size.length, p.shape === 'box' ? 3 : 2);
  }
  assert.equal(HELD_PARTS.katana, undefined);
});
