import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRBURST_FLAG, meteorExtra, meteorFromRow } from '../src/app/tornado/engine/net/meteorFx.js';
import { FX_KINDS, LIMITS, PROTOCOL_VERSION as V, validateSnapshot, sanitizeFx } from '../src/app/tornado/engine/net/protocol.js';
import { createFxRing, packExtra } from '../src/app/tornado/engine/net/fxOut.js';
import { PLAYED, CUE_GAP, playedKind } from '../src/app/tornado/engine/net/mirrorRules.js';
import { createRng } from '../src/app/tornado/engine/rng.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const ix = FX_KINDS.indexOf('meteor');

test('meteor is appended after the older fx kinds and the mirror plays it with a sound cap', () => {
  assert.equal(ix, FX_KINDS.length - 1);
  assert.equal(FX_KINDS[13], 'warp');
  assert.equal(playedKind(ix), 'meteor');
  assert.ok(PLAYED.includes('meteor'));
  assert.ok(CUE_GAP.meteor > 0);
});

test('the extra carries the radius in tenths and the airburst flag', () => {
  assert.equal(meteorExtra(12.34, false), 123);
  assert.equal(meteorExtra(9.6, true), 96 + AIRBURST_FLAG);
  assert.ok(meteorExtra(1e6, true) < 600);
  assert.ok(meteorExtra(NaN, false) >= 1);
});

test('a row goes through the ring and back: entry, landing, radius, airburst, seed from the id', () => {
  const ring = createFxRing();
  assert.equal(ring.push('meteor', 0, 230.44, 260, -120.06, -5.5, 0, 14.25, 0, meteorExtra(11.8, true)), true);
  const rows = ring.drain(24);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 10);
  const m = meteorFromRow(rows[0]);
  assert.deepEqual(m.from, { x: 230.4, y: 260, z: -120.1 });
  assert.deepEqual(m.to, { x: -5.5, y: 0, z: 14.3 });
  assert.equal(m.radius, 11.8);
  assert.equal(m.airburst, true);
  assert.equal(m.seed, rows[0][0] + 1);
});

test('bad rows give nothing', () => {
  const row = (o) => { const r = [1, ix, 0, 100, 260, 50, 0, 0, 0, packExtra(0, 120)]; for (const [i, v] of Object.entries(o)) r[i] = v; return r; };
  assert.ok(meteorFromRow(row({})));
  assert.equal(meteorFromRow(row({ 3: NaN })), null);
  assert.equal(meteorFromRow(row({ 9: packExtra(0, 0) })), null, 'no size');
  assert.equal(meteorFromRow(row({ 4: 0 })), null, 'no height');
  assert.equal(meteorFromRow(row({ 4: 10, 7: 20 })), null, 'rises');
  assert.equal(meteorFromRow(null), null);
});

test('a snapshot carrying meteor rows is valid and the guest keeps the kind', () => {
  const r = [1, ix, 0, 230.4, 260, -120.1, -5.5, 0, 14.3, packExtra(0, 118)];
  assert.equal(validateSnapshot(base({ fx: [r] })).ok, true);
  assert.equal(sanitizeFx([r]).length, 1);
  const rows = Array.from({ length: LIMITS.maxFx }, (_, i) => [i + 1, ix, 0, 1, 260, 1, 0, 0, 0, packExtra(0, 100)]);
  assert.equal(validateSnapshot(base({ fx: rows })).ok, true);
});

test('the seeded generator draws the same rock every time', () => {
  const take = (seed) => { const r = createRng(seed); return Array.from({ length: 12 }, r); };
  assert.deepEqual(take(7), take(7));
  assert.notDeepEqual(take(7), take(8));
});
