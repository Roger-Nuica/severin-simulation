import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStretches } from '../src/app/tornado/engine/environment/streetTraffic.js';

const o = { halfLength: 100, roadHalfWidth: 2.5, parkShort: 4, minStretch: 18 };

test('a car drives in from each end up to the first building on its street', () => {
  // One street at z = 0, a building on it at x 20 (10 wide), one well off it.
  const blocks = [{ x: 20, z: 1, hw: 5, hd: 5 }, { x: -60, z: 30, hw: 5, hd: 5 }];
  const s = openStretches([0], blocks, o);
  assert.deepEqual(s.map(({ dir, from, park }) => ({ dir, from, park })), [
    { dir: 1, from: -100, park: 11 },
    { dir: -1, from: 100, park: 29 }
  ]);
});

test('the nearest building wins, and a stretch too short is left out', () => {
  const blocks = [{ x: -85, z: 0, hw: 4, hd: 4 }, { x: 0, z: 0, hw: 4, hd: 4 }];
  const s = openStretches([0], blocks, o);
  // From the west the first building is at -89: 11 m of road, too short.
  assert.equal(s.filter((x) => x.dir === 1).length, 0);
  assert.equal(s.find((x) => x.dir === -1)?.park, 8);
});

test('an open street runs end to end', () => {
  const s = openStretches([5], [], o);
  assert.equal(s.length, 2);
  assert.equal(s[0].park, 96);
});
