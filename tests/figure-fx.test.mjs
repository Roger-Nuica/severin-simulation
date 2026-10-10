import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_KINDS, sanitizeFx } from '../src/app/tornado/engine/net/protocol.js';
import { createFxRing, aimRow, packExtra } from '../src/app/tornado/engine/net/fxOut.js';
import { playedKind, CUE_GAP, PLAYED, flameWanted } from '../src/app/tornado/engine/net/mirrorRules.js';
import {
  AIM_JET_BIT, withJetBit, jetWanted, climbFrom, guestBurning, warpEnds, warpFromRow, cutFromRow,
  swingBearing, swingFade, SWING_ARC, scoreMarker
} from '../src/app/tornado/engine/net/figureFx.js';

const ix = (k) => FX_KINDS.indexOf(k);

test('warp is appended after the older kinds and the mirror plays warp and cut with a sound cap', () => {
  assert.equal(FX_KINDS[13], 'warp');
  assert.deepEqual(FX_KINDS.slice(0, 13).slice(10), ['ray', 'round', 'missile']);
  for (const k of ['warp', 'cut']) {
    assert.equal(playedKind(ix(k)), k);
    assert.ok(PLAYED.includes(k));
    assert.ok(CUE_GAP[k] > 0);
  }
});

test('a warp round-trips through the ring and back out of the row', () => {
  const ring = createFxRing();
  const from = { x: 0, y: 0, z: 0 };
  const to = { x: 0, y: 0, z: 0 };
  warpEnds(from, to, 10.04, -3.26, 25, 7.5);
  assert.ok(ring.push('warp', 0, from.x, from.y, from.z, to.x, to.y, to.z, 0, 0));
  const rows = sanitizeFx(ring.drain(24));
  assert.equal(rows.length, 1);
  const w = warpFromRow(rows[0]);
  assert.deepEqual(w, { fromX: 10, fromZ: -3.3, toX: 25, toZ: 7.5 });
  assert.equal(warpFromRow([1, ix('warp'), 0, NaN, 0, 0, 0, 0, 0, 0]), null);
  assert.equal(warpFromRow(undefined), null);
});

test('a Katana cut reads back its heading, the blade flag and whether it landed', () => {
  const ring = createFxRing();
  // Roger at (0,0), the cut lands 3 m along +x: heading is a quarter turn.
  ring.push('cut', 0, 0, 0, 0, 3, 1.1, 0, 7, 0);
  // A Blade Mode line: both ends the same.
  ring.push('cut', 0, 5, 0, 5, 5, 0, 5, 0, 1);
  const [slash, blade] = ring.drain(24).map((r) => cutFromRow(r));
  assert.ok(Math.abs(slash.heading - Math.PI / 2) < 1e-9);
  assert.equal(slash.hasHeading, true);
  assert.equal(slash.blade, false);
  assert.equal(slash.hit, true);
  assert.equal(blade.hasHeading, false);
  assert.equal(blade.blade, true);
  assert.equal(blade.hit, false);
  assert.equal(cutFromRow([1, ix('cut'), 0, 0, 0, 0, 0, 0, Infinity, 0]), null);
  assert.equal(cutFromRow(null), null);
  // `packExtra` and the reader agree on where the blade flag sits.
  assert.equal(cutFromRow([1, ix('cut'), 0, 0, 0, 0, 1, 0, 0, packExtra(7, 1)]).blade, true);
});

test('the jet bit sits beside the Fire Gun and minigun bits and clears cleanly', () => {
  assert.equal(AIM_JET_BIT, 4);
  assert.equal(withJetBit(0, true), 4);
  assert.equal(withJetBit(1, true), 5);
  assert.equal(withJetBit(7, false), 3);
  assert.equal(withJetBit(2, false), 2);
  assert.ok(jetWanted(aimRow(0, 0, 0, withJetBit(0, true))));
  assert.ok(!jetWanted(aimRow(0, 0, 0, 3)));
  assert.ok(!jetWanted(undefined));
  // The Fire Gun's flame test is not fooled by the new bit.
  assert.equal(flameWanted(aimRow(0, 0, 0, 4), 1), false);
  assert.equal(flameWanted(aimRow(0, 0, 0, 5), 1), true);
  // The row stays inside the protocol's byte.
  assert.equal(aimRow(0, 0, 0, withJetBit(3, true))[3], 7);
});

test('climb is the eased rise over the top climb speed, never negative or past one', () => {
  assert.equal(climbFrom(0, 0.11, 0.01, 11), 1);
  assert.ok(Math.abs(climbFrom(0, 0.055, 0.01, 11) - 0.5) < 1e-9);
  assert.equal(climbFrom(5, 4, 0.016, 11), 0);
  assert.equal(climbFrom(0, 1, 0, 11), 0);
});

test('a guest burns only while up, free and in the air', () => {
  assert.equal(guestBurning(true, true, true), true);
  assert.equal(guestBurning(false, true, true), false);
  assert.equal(guestBurning(true, false, true), false);
  assert.equal(guestBurning(true, true, false), false);
});

test('the swing sweeps across its arc and fades out', () => {
  assert.ok(Math.abs(swingBearing(0) + SWING_ARC.sweep / 2) < 1e-9);
  assert.ok(Math.abs(swingBearing(1) - SWING_ARC.sweep / 2) < 1e-9);
  assert.ok(swingBearing(0.5) > swingBearing(0.2));
  assert.equal(swingFade(0), 1);
  assert.equal(swingFade(1), 0);
  assert.ok(swingFade(0.5) < 1 && swingFade(0.5) > 0);
  assert.equal(swingBearing(-1), swingBearing(0));
});

test('the hit marker is for the viewer\'s own points; a partner\'s are known but not the viewer\'s', () => {
  assert.deepEqual(scoreMarker({ id: 1, points: 50 }, 1), { own: true, points: 50 });
  assert.deepEqual(scoreMarker({ id: 2, points: 8 }, 1), { own: false, points: 8 });
  assert.equal(scoreMarker({ id: 1, points: 0 }, 1), null);
  assert.equal(scoreMarker({ id: 'x', points: 5 }, 1), null);
  assert.equal(scoreMarker(null, 1), null);
});
