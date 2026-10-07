import test from 'node:test';
import assert from 'node:assert/strict';
import { FLYER, MOTHER_STATE, FLYER_ID_SPAN, flyerId, motherState, throttleState, throttleOf, headDown, headHeight, flyerRow, poseFlyer, jetLook, chopperLook, spotlessLook } from '../src/app/tornado/engine/net/flyerPose.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer } from '../src/app/tornado/engine/net/interp.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const id = (v) => v;
const e0 = { yaw: 0, pitch: 0, roll: 0 };

test('ids never meet across types, and fit the cows (8) with room to spare', () => {
  const seen = new Set();
  for (const type of Object.values(FLYER)) for (let i = 0; i < 8; i++) seen.add(flyerId(type, i));
  assert.equal(seen.size, 5 * 8);
  assert.ok(FLYER_ID_SPAN >= 8);
  assert.equal(flyerId(FLYER.cow, 3) - flyerId(FLYER.cow, 0), 3);
});

test('a row has the agreed ten columns, rounded, with the horizontal position clamped', () => {
  const row = flyerRow(FLYER.jet, 2, { x: 999.123, y: 90.456, z: -20, state: 2, a: 0.678 }, { yaw: 1.234, pitch: -0.5, roll: 0.3 }, (v) => Math.max(-400, Math.min(400, v)));
  assert.deepEqual(row, [flyerId(FLYER.jet, 2), FLYER.jet, 400, 90.46, -20, 1.23, -0.5, 0.3, 2, 0.68]);
  assert.equal(row.length, EXTRA_ROW_WIDTH.flyers);
});

test('column a is held to 0..1 and the mothership phase maps to one state', () => {
  assert.equal(flyerRow(FLYER.cow, 0, { x: 0, y: 0, z: 0, state: 0, a: 7 }, e0, id)[9], 1);
  assert.equal(flyerRow(FLYER.cow, 0, { x: 0, y: 0, z: 0, state: 0, a: -3 }, e0, id)[9], 0);
  assert.equal(motherState('arriving'), MOTHER_STATE.arriving);
  assert.equal(motherState('charging'), MOTHER_STATE.charging);
  assert.equal(motherState('cutting'), MOTHER_STATE.cutting);
  assert.equal(motherState('leaving'), MOTHER_STATE.leaving);
  assert.equal(motherState('falling'), MOTHER_STATE.falling);
});

test('throttle goes in thirds and back; a cow head goes down and up as the host grazes', () => {
  assert.equal(throttleState(0.3), 1);
  assert.equal(throttleState(1), 3);
  assert.equal(throttleState(9), 3);
  assert.ok(Math.abs(throttleOf(3) - 1) < 1e-9 && throttleOf(0) === 0);
  assert.equal(headDown(1.35), 0);
  assert.equal(headDown(0.95), 1);
  assert.equal(headDown(5), 0);
  assert.ok(Math.abs(headHeight(headDown(1.1)) - 1.1) < 1e-9);
  assert.ok(Math.abs(headHeight(0) - 1.35) < 1e-9);
});

test('a flyer proxy is placed by position and YXZ angles (pitch, yaw, roll as the rows carry them)', () => {
  const calls = [];
  const obj = { position: { set: (...a) => calls.push(['p', ...a]) }, rotation: { order: 'XYZ', set: (...a) => calls.push(['r', ...a]) } };
  poseFlyer(obj, [1, 0, 5, 90, -6, 1.5, -0.2, 0.4, 0, 1]);
  assert.deepEqual(calls, [['p', 5, 90, -6], ['r', -0.2, 1.5, 0.4]]);
  assert.equal(obj.rotation.order, 'YXZ');
});

test('the jet cloak sweeps tail to nose with how far it is seen, and the flames follow throttle', () => {
  const gone = jetLook(0, 3, 0, 0, 1, 10.6);
  assert.equal(gone.reveal, -10.6);
  assert.equal(gone.shown, false);
  assert.equal(gone.strobe, false);
  const seen = jetLook(1, 3, 0.01, 0, 1, 10.6);
  assert.ok(Math.abs(seen.reveal - 10.6) < 1e-9);
  assert.equal(seen.shown, true);
  assert.ok(Math.abs(seen.flameLength - 1.7) < 1e-9 && Math.abs(seen.flameWidth - 1.1) < 1e-9);
  assert.equal(seen.strobe, true);
  assert.equal(jetLook(1, 3, 0.5, 0, 1, 10.6).strobe, false);
  const idle = jetLook(1, 0, 0, 1, 1, 10.6);
  assert.ok(Math.abs(idle.flameLength - 0.45) < 1e-9 && Math.abs(idle.flameWidth - 0.7) < 1e-9);
  assert.equal(jetLook(0.5, 1, 0, 0, 1, 10.6).shown, false);
});

test('the helicopter spins its rotors, blinks, and tips its searchlight when chasing', () => {
  const storm = { radius: 82, height: 46 };
  const town = chopperLook(0, 2, storm);
  assert.equal(town.rotor, 56);
  assert.equal(town.tail, 80);
  assert.equal(town.beamTilt, -0.35);
  assert.equal(town.beamOpacity, 0.06);
  const chase = chopperLook(1, 1, storm);
  assert.ok(Math.abs(chase.beamTilt + Math.atan2(82, 46)) < 1e-9);
  assert.equal(chase.beamOpacity, 0.13);
  assert.equal(chopperLook(0, 0.05, storm).beacon, true);
  assert.equal(chopperLook(0, 0.5, storm).beacon, false);
});

test('Spotless strides and his wave pulses along his walk', () => {
  const start = spotlessLook(0, 40);
  assert.equal(start.left, 0);
  assert.ok(Math.abs(start.wave - 0.35) < 1e-9);
  const mid = spotlessLook(Math.PI / 80, 40);
  assert.ok(Math.abs(mid.left - 0.4) < 1e-9 && Math.abs(mid.right + 0.4) < 1e-9);
  assert.equal(spotlessLook(9, 40).left, spotlessLook(1, 40).left);
});

test('a snapshot with flyers is valid, and is optional', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  const jet = [flyerId(FLYER.jet, 0), 0, 5, 90, 6, 1, 0.1, -0.3, 3, 0.5];
  const ship = [flyerId(FLYER.mothership, 0), 2, 0, 520, 0, 0, 0.18, 0.35, 4, 0];
  assert.equal(validateSnapshot(base({ flyers: [jet, ship] })).ok, true);
  assert.equal(validateSnapshot(base({ flyers: [] })).ok, true);
});

test('the cap is the sum of the systems own counts: 3 jets, helicopter, mothership, 8 cows, Spotless', () => {
  assert.equal(LIMITS.maxFlyers, 3 + 1 + 1 + 8 + 1);
  const ok = [0, 0, 5, 90, 6, 1, 0, 0, 0, 0];
  assert.equal(validateSnapshot(base({ flyers: Array.from({ length: 14 }, (_, i) => [i, 0, 5, 90, 6, 1, 0, 0, 0, 0]) })).ok, true);
  assert.equal(validateSnapshot(base({ flyers: Array.from({ length: 15 }, (_, i) => [i, 0, 5, 90, 6, 1, 0, 0, 0, 0]) })).ok, false);
  assert.equal(validateSnapshot(base({ flyers: [ok] })).ok, true);
});

test('bad flyers are refused: width, id, type, bounds, state, a, non-numbers', () => {
  const ok = [0, 0, 5, 90, 6, 1, 0, 0, 0, 0];
  const bad = (i, v) => { const r = ok.slice(); r[i] = v; return validateSnapshot(base({ flyers: [r] })).ok; };
  assert.equal(validateSnapshot(base({ flyers: [ok.slice(0, 9)] })).ok, false);
  assert.equal(bad(0, -1), false);
  assert.equal(bad(0, 1.5), false);
  assert.equal(bad(1, 5), false);
  assert.equal(bad(1, 0.5), false);
  assert.equal(bad(2, 5000), false);
  assert.equal(bad(4, -5000), false);
  assert.equal(bad(3, 5000), false);
  assert.equal(bad(3, -500), false);
  assert.equal(bad(5, 99), false);
  assert.equal(bad(6, 99), false);
  assert.equal(bad(7, 99), false);
  assert.equal(bad(8, 5), false);
  assert.equal(bad(8, 1.5), false);
  assert.equal(bad(9, 2), false);
  assert.equal(bad(9, 'x'), false);
  assert.equal(validateSnapshot(base({ flyers: 'no' })).ok, false);
});

test('flyers interpolate: position and angles blend, type and state take the nearer snapshot', () => {
  const buf = createSnapshotBuffer();
  const snap = (t, flyers) => ({ ...base({ tick: Math.round(t * 15) + 1, t, flyers }) });
  buf.push(snap(1, [[96, 2, 0, 500, 0, 0, 0, 0, 0, 0]]), 1000);
  buf.push(snap(1.2, [[96, 2, 10, 400, 20, 1, 0.2, 0.4, 1, 0]]), 1200);
  const mid = buf.sample(1100 + 100);
  assert.ok(mid);
  const row = mid.kinds.flyers.get(96);
  assert.ok(row);
  assert.ok(row[2] >= 0 && row[2] <= 10 && row[3] <= 500 && row[3] >= 400 && row[5] >= 0 && row[5] <= 1);
  assert.ok(row[1] === 2 && (row[8] === 0 || row[8] === 1));
});

test('an older host sends no flyers: the kind is simply empty', () => {
  const buf = createSnapshotBuffer();
  buf.push(base({ t: 1 }), 1000);
  buf.push(base({ t: 1.1, tick: 2 }), 1100);
  const s = buf.sample(1300);
  assert.ok(s);
  assert.equal(s.kinds.flyers.size, 0);
});

test('bytes: a typical snapshot of flyers (herd, helicopter, three jets) stays small', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(flyerRow(FLYER.cow, i, { x: 58.123, y: 0.4, z: 104.567, state: 0, a: 0.5 }, { yaw: 1.23, pitch: 0.01, roll: 0 }, id));
  rows.push(flyerRow(FLYER.chopper, 0, { x: -61.23, y: 50.12, z: 33.45, state: 0, a: 0 }, { yaw: 2.34, pitch: 0.08, roll: -0.12 }, id));
  for (let i = 0; i < 3; i++) rows.push(flyerRow(FLYER.jet, i, { x: 120.12, y: 90.5, z: -88.1, state: 1, a: 1 }, { yaw: 2.34, pitch: -0.12, roll: 0.45 }, id));
  const bytes = JSON.stringify(rows).length;
  assert.ok(bytes < 800, `${bytes} bytes`);
});
