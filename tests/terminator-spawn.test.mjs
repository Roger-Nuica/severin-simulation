import test from 'node:test';
import assert from 'node:assert/strict';
import { squadSpawnPoints } from '../src/app/tornado/engine/terminator/spawn.js';

const seeded = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test('five Terminators, each in a different place round the centre', () => {
  const pts = squadSpawnPoints(10, -20, 5, 60, 127, seeded(3));
  assert.equal(pts.length, 5);
  for (const p of pts) {
    const d = Math.hypot(p.x - 10, p.z + 20);
    assert.ok(d > 60 * 0.8 && d < 60 * 1.2, `about 60 m out (${d.toFixed(1)})`);
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) > 25, 'no two together');
    }
  }
});

test('never outside the town', () => {
  for (let s = 1; s < 30; s++) {
    for (const p of squadSpawnPoints(120, 120, 5, 60, 127, seeded(s))) {
      assert.ok(Math.abs(p.x) <= 127 && Math.abs(p.z) <= 127);
    }
  }
});
