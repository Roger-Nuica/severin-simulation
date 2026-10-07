import test from 'node:test';
import assert from 'node:assert/strict';
import { boltFxTo, empFxTo, boltFromRow, empFromRow, POWER_SCALE, EMP_VARIANTS } from '../src/app/tornado/engine/net/skyFx.js';
import { FX_KINDS, sanitizeFx } from '../src/app/tornado/engine/net/protocol.js';
import { createFxRing, packExtra } from '../src/app/tornado/engine/net/fxOut.js';
import { playedKind, PLAYED, CUE_GAP, cueDue } from '../src/app/tornado/engine/net/mirrorRules.js';

test('bolt and emp are appended after the older kinds, in order', () => {
  assert.deepEqual(FX_KINDS.slice(0, 8), ['bullet', 'rail', 'plasma', 'mega', 'fire', 'holeShot', 'cut', 'blast']);
  assert.equal(FX_KINDS[8], 'bolt');
  assert.equal(FX_KINDS[9], 'emp');
});

test('the mirror plays bolt and emp, with a rate cap each', () => {
  assert.equal(playedKind(FX_KINDS.indexOf('bolt')), 'bolt');
  assert.equal(playedKind(FX_KINDS.indexOf('emp')), 'emp');
  assert.ok(PLAYED.includes('bolt') && PLAYED.includes('emp'));
  assert.ok(CUE_GAP.bolt > 0 && CUE_GAP.emp > 0);
  assert.equal(cueDue(10, 10.05, CUE_GAP.bolt), false);
  assert.equal(cueDue(10, 10.2, CUE_GAP.bolt), true);
});

test('a bolt survives the ring, the validator and the reader', () => {
  const ring = createFxRing();
  const to = boltFxTo({ x: 0, y: 0, z: 0 }, 0.734);
  assert.equal(to.x, 0.734 * POWER_SCALE);
  assert.ok(ring.push('bolt', 0, -42.34, 12.5, 88.8, to.x, to.y, to.z, 0, 0));
  const rows = sanitizeFx(ring.drain(8));
  assert.equal(rows.length, 1);
  const b = boltFromRow(rows[0]);
  assert.deepEqual([b.x, b.y, b.z], [-42.3, 12.5, 88.8]);
  assert.ok(Math.abs(b.power - 0.73) < 0.011);
});

test('bolt power is clamped and bad numbers are refused', () => {
  assert.equal(boltFxTo({ x: 0, y: 0, z: 0 }, 5).x, 100);
  assert.equal(boltFxTo({ x: 0, y: 0, z: 0 }, -1).x, 0);
  assert.equal(boltFxTo({ x: 0, y: 0, z: 0 }, NaN).x, 0);
  assert.equal(boltFromRow([1, 8, 0, 0, -3, 0, 250, 0, 0, 0]).power, 1);
  assert.equal(boltFromRow([1, 8, 0, 0, -3, 0, 250, 0, 0, 0]).y, 0);
  assert.equal(boltFromRow([1, 8, 0, NaN, 0, 0, 50, 0, 0, 0]), null);
  assert.equal(boltFromRow(null), null);
});

test('an emp keeps its centre, radius and variant', () => {
  const ring = createFxRing();
  for (const v of EMP_VARIANTS) {
    const to = empFxTo({ x: 0, y: 0, z: 0 }, 36, v);
    ring.push('emp', 0, 10, 2, -20, to.x, to.y, to.z, 0, 0);
  }
  const rows = sanitizeFx(ring.drain(8));
  assert.deepEqual(rows.map((r) => empFromRow(r).variant), ['pulse', 'solar', 'wave']);
  const e = empFromRow(rows[0]);
  assert.deepEqual([e.x, e.y, e.z, e.radius], [10, 2, -20, 36]);
});

test('an unknown variant is a pulse, a wild radius is clamped, bad numbers are refused', () => {
  assert.equal(empFromRow([1, 9, 0, 0, 2, 0, 36, 7, 0, packExtra(0, 0)]).variant, 'pulse');
  assert.equal(empFromRow([1, 9, 0, 0, 2, 0, 9999, 0, 0, 0]).radius, 400);
  assert.equal(empFromRow([1, 9, 0, 0, 2, 0, -5, 0, 0, 0]).radius, 1);
  assert.equal(empFromRow([1, 9, 0, 0, 2, 0, Infinity, 0, 0, 0]), null);
  assert.equal(empFromRow(undefined), null);
});
