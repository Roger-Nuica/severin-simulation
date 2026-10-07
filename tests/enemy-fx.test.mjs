import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAY_SUBS, raySub, rayLook, trackerExtra, trackerTo, rayFromRow, roundTo, roundFromRow,
  missileSeconds, missileExtra, missileFromRow, missileEase, ROUND_EVERY, ROUND_BACKLOG, CRAWL_MAX, MISSILE_SECONDS
} from '../src/app/tornado/engine/net/enemyFx.js';
import { FX_KINDS, sanitizeFx, LIMITS } from '../src/app/tornado/engine/net/protocol.js';
import { createFxRing } from '../src/app/tornado/engine/net/fxOut.js';
import { playedKind, PLAYED, CUE_GAP, cueDue } from '../src/app/tornado/engine/net/mirrorRules.js';
import { GUNNER } from '../src/app/tornado/engine/gunner/config.js';
import { MISSILE } from '../src/app/tornado/engine/aliens/missiles.js';

const kindIx = (k) => FX_KINDS.indexOf(k);

test('ray, round and missile are appended after the older kinds', () => {
  assert.deepEqual(FX_KINDS.slice(0, 10), ['bullet', 'rail', 'plasma', 'mega', 'fire', 'holeShot', 'cut', 'blast', 'bolt', 'emp']);
  assert.deepEqual(FX_KINDS.slice(10), ['ray', 'round', 'missile']);
});

test('the mirror plays the three kinds, each with a sound rate cap', () => {
  for (const k of ['ray', 'round', 'missile']) {
    assert.equal(playedKind(kindIx(k)), k);
    assert.ok(PLAYED.includes(k));
    assert.ok(CUE_GAP[k] > 0, k);
  }
  assert.equal(cueDue(5, 5.05, CUE_GAP.ray), false);
  assert.equal(cueDue(5, 5.2, CUE_GAP.ray), true);
  assert.ok(CUE_GAP.round >= 1);
});

test('ray sub-types round-trip to the look the aliens draw', () => {
  assert.deepEqual(rayLook(raySub('crew', 'green')), { style: 'crew', colour: 'green' });
  assert.deepEqual(rayLook(raySub('ship', 'green')), { style: 'ship', colour: 'green' });
  assert.deepEqual(rayLook(raySub('ship', 'red')), { style: 'ship', colour: 'red' });
  assert.equal(RAY_SUBS.length, 5);
});

test('a shot survives the ring, the validator and the reader', () => {
  const ring = createFxRing();
  for (const [style, colour] of [['crew', 'green'], ['ship', 'green'], ['ship', 'red']]) {
    ring.push('ray', 0, 10.14, 2.2, -30.5, 12, 1.3, -28, 0, raySub(style, colour));
  }
  const rows = sanitizeFx(ring.drain(8));
  assert.equal(rows.length, 3);
  const subs = rows.map((r) => rayFromRow(r));
  assert.deepEqual(subs.map((r) => r.sub), [0, 1, 2]);
  assert.ok(subs.every((r) => !r.tracker));
  assert.deepEqual([subs[0].from.x, subs[0].from.y, subs[0].from.z], [10.1, 2.2, -30.5]);
  assert.deepEqual([subs[0].to.x, subs[0].to.y, subs[0].to.z], [12, 1.3, -28]);
});

test('a tracking laser carries its foot, heading and crawl', () => {
  const ring = createFxRing();
  const to = trackerTo({ x: 0, y: 0, z: 0 }, 100, 50, 100, 80); // heading +z
  assert.ok(Math.abs(to.z - 90) < 1e-9);
  ring.push('ray', 0, 20, 40, -10, to.x, to.y, to.z, 0, trackerExtra(true, 14));
  ring.push('ray', 0, 20, 40, -10, to.x, to.y, to.z, 0, trackerExtra(false, 999));
  const rows = sanitizeFx(ring.drain(8));
  const hunter = rayFromRow(rows[0]);
  const ufo = rayFromRow(rows[1]);
  assert.equal(hunter.tracker, true);
  assert.equal(hunter.sub, 4);
  assert.equal(ufo.sub, 3);
  assert.deepEqual([hunter.foot.x, hunter.foot.z], [100, 50]);
  assert.ok(Math.abs(hunter.foot.dx) < 1e-6 && Math.abs(hunter.foot.dz - 1) < 1e-6);
  assert.equal(hunter.foot.crawl, 14);
  assert.equal(ufo.foot.crawl, CRAWL_MAX, 'a crawl is clamped');
  assert.ok(trackerExtra(false, 1e6) <= 600, 'extra stays inside its cap');
});

test('a HAVOC round ends at its full reach, cut at the ground', () => {
  const out = { x: 0, y: 0, z: 0 };
  roundTo(out, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
  assert.deepEqual([out.x, out.y, out.z], [0, 1.6, GUNNER.speed * GUNNER.roundLife]);
  roundTo(out, { x: 0, y: 2, z: 0 }, { x: 0, y: -0.5, z: Math.sqrt(0.75) });
  assert.equal(out.y, 0);
  assert.ok(out.z > 0 && out.z < GUNNER.speed * GUNNER.roundLife);
  const ring = createFxRing();
  ring.push('round', 0, 5, 1.6, 5, 5, 1.6, 159, 0, 0);
  const r = roundFromRow(sanitizeFx(ring.drain(1))[0]);
  assert.ok(Math.abs(r.seconds - 154 / GUNNER.speed) < 0.01);
  assert.equal(roundFromRow([1, 11, 0, NaN, 0, 0, 0, 0, 0, 0]), null);
});

test('HAVOC rounds are thinned and give way to missiles and rays', () => {
  assert.ok(ROUND_EVERY >= 2);
  assert.ok(ROUND_BACKLOG < LIMITS.maxFx, 'rounds stop before the snapshot cap');
});

test('a missile row carries its launch, arrival and flight time', () => {
  const ring = createFxRing();
  ring.push('missile', 0, 100, 30, 0, 120, 1.1, 40, 0, missileExtra(3.76));
  const m = missileFromRow(sanitizeFx(ring.drain(1))[0]);
  assert.deepEqual([m.from.x, m.from.y, m.from.z], [100, 30, 0]);
  assert.deepEqual([m.to.x, m.to.y, m.to.z], [120, 1.1, 40]);
  assert.ok(Math.abs(m.seconds - 3.7) < 0.11);
  assert.equal(missileFromRow([1, 12, 0, 0, 0, 0, NaN, 0, 0, 0]), null);
  assert.equal(missileFromRow([1, 12, 0, 0, 0, 0, 0, 0, 0, 0]).seconds, MISSILE_SECONDS.min);
});

test('the missile flight estimate follows the host speed profile', () => {
  assert.equal(MISSILE.speed0, 14);
  assert.equal(MISSILE.speed1, 30);
  assert.equal(MISSILE.accel, 14);
  assert.ok(missileSeconds(10) < missileSeconds(100));
  // Far away it is about distance over top speed, with the turn's margin.
  assert.ok(Math.abs(missileSeconds(300) - (300 * 1.15 / 30 + 0.7)) < 1.5);
  assert.equal(missileSeconds(1e6), MISSILE_SECONDS.max);
  assert.equal(missileSeconds(NaN), MISSILE_SECONDS.min);
  assert.equal(missileExtra(NaN), 0);
  assert.ok(missileExtra(99) <= 600);
});

test('the guest missile path starts slow, ends at the end, and never leaves 0..1', () => {
  assert.equal(missileEase(0), 0);
  assert.equal(missileEase(1), 1);
  assert.equal(missileEase(2), 1);
  assert.equal(missileEase(-1), 0);
  assert.ok(missileEase(0.5) < 0.5, 'it speeds up');
  let last = 0;
  for (let u = 0; u <= 1; u += 0.05) { const e = missileEase(u); assert.ok(e >= last); last = e; }
});
