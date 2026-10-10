import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GIANT, GIANT_STATE, giantState, giantRow, fallPose, poseTrex, poseYeti } from '../src/app/tornado/engine/net/giantPose.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer } from '../src/app/tornado/engine/net/interp.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const id = (v) => v;
const st = (o = {}) => ({ x: 10, z: -20, heading: 1, phase: 'walking', acting: false, a: 0, b: 0, fall: 0, ...o });

test('phase and action map to one state column', () => {
  assert.equal(giantState('walking', false), GIANT_STATE.walking);
  assert.equal(giantState('breathing', true), GIANT_STATE.acting);
  assert.equal(giantState('walking', true), GIANT_STATE.acting);
  assert.equal(giantState('stunned', true), GIANT_STATE.stunned);
  assert.equal(giantState('falling', false), GIANT_STATE.falling);
  assert.equal(giantState('dead', false), GIANT_STATE.dead);
});

test('a row has the agreed seven columns, rounded and clamped', () => {
  const row = giantRow(GIANT.yeti, st({ x: 999.123, a: 0.5678, b: 0.1234, acting: true }), (v) => Math.min(400, v));
  assert.deepEqual(row, [1, 400, -20, 1, 1, 0.57, 0.12]);
  assert.equal(row.length, EXTRA_ROW_WIDTH.giants);
});

test('going down sends the fall progress in column a, and a dead one is fully down', () => {
  assert.deepEqual(giantRow(0, st({ phase: 'falling', fall: 0.4, a: 0.9, b: 0.5 }), id), [0, 10, -20, 1, GIANT_STATE.falling, 0.4, 0]);
  assert.equal(giantRow(0, st({ phase: 'dead', fall: 1 }), id)[5], 1);
});

test('the fall pose follows the host: T-Rex on its side and sinking, Yeti over backwards, standing is none', () => {
  assert.deepEqual(fallPose(GIANT.trex, GIANT_STATE.walking, 0.7), { rx: 0, rz: 0, y: 0 });
  const rex = fallPose(GIANT.trex, GIANT_STATE.dead, 0);
  assert.ok(Math.abs(rex.rz - (Math.PI / 2 - 0.15)) < 1e-9 && Math.abs(rex.y + 1.5) < 1e-9);
  const half = fallPose(GIANT.yeti, GIANT_STATE.falling, 0.5);
  assert.ok(Math.abs(half.rx + 0.25 * 1.4) < 1e-9 && half.rz === 0);
  assert.ok(Math.abs(fallPose(GIANT.yeti, GIANT_STATE.dead, 0).rx + 1.4) < 1e-9);
});

const joint = () => ({ rotation: { x: 0, y: 0 }, position: { y: 0 } });
const mat = () => ({ color: new THREE.Color() });
const eye = new THREE.Color(1, 0.2, 0.1);

test('the T-Rex walks, bows its head to breathe, opens its jaw and dims when stunned', () => {
  const j = { legL: joint(), legR: joint(), tail: joint(), neck: joint(), head: joint(), jaw: joint(), body: joint() };
  const mats = { eyeMat: mat(), ventMat: mat() };
  const col = { eye, vent: eye };
  poseTrex(j, mats, col, Math.PI / 2, 1, GIANT_STATE.walking, 0, 0);
  assert.ok(Math.abs(j.legL.rotation.x - 0.45) < 1e-9 && Math.abs(j.legR.rotation.x + 0.45) < 1e-9);
  assert.ok(Math.abs(j.jaw.rotation.x - 0.05) < 1e-9);
  assert.ok(j.body.position.y > 8);
  poseTrex(j, mats, col, Math.PI / 2, 1, GIANT_STATE.acting, 0.8, 0);
  assert.equal(j.legL.rotation.x, 0);
  assert.ok(Math.abs(j.neck.rotation.x - (-0.5 + 0.8 * 0.45)) < 1e-9 && Math.abs(j.jaw.rotation.x - 0.55) < 1e-9);
  assert.ok(Math.abs(mats.eyeMat.color.r - 1) < 1e-6);
  poseTrex(j, mats, col, 0, 0, GIANT_STATE.stunned, 0, 0);
  assert.ok(Math.abs(mats.eyeMat.color.r - 0.08) < 1e-6);
  poseTrex(j, mats, col, 0, 0, GIANT_STATE.falling, 0.9, 0);
  assert.ok(Math.abs(j.neck.rotation.x + 0.5) < 1e-9);
});

test('the Yeti swings its legs, raises the gun arm to the beam and dims the visor when stunned', () => {
  const j = { legL: joint(), legR: joint(), armL: joint(), armR: joint() };
  const mats = { glowMat: mat(), coolantMat: mat() };
  const col = { visor: new THREE.Color(0, 1, 1) };
  poseYeti(j, mats, col, Math.PI / 2, 1, GIANT_STATE.walking, 0, 0, 0);
  assert.ok(Math.abs(j.legL.rotation.x - 0.5) < 1e-9 && Math.abs(j.armL.rotation.x + 0.4) < 1e-9);
  assert.ok(Math.abs(j.armR.rotation.x - (-0.35 + 0.15)) < 1e-9);
  poseYeti(j, mats, col, 0, 0, GIANT_STATE.acting, 1, 0.2, 0);
  assert.ok(Math.abs(j.armR.rotation.x - (-Math.PI / 2 + 0.2)) < 1e-9);
  poseYeti(j, mats, col, 0, 0, GIANT_STATE.stunned, 0, 0, 0);
  assert.ok(Math.abs(mats.glowMat.color.g - 0.1) < 1e-6);
  poseYeti(j, mats, col, 0, 0, GIANT_STATE.dead, 1, 0.2, 0);
  assert.ok(Math.abs(j.armR.rotation.x + 0.35) < 1e-9);
});

test('a snapshot with giants is valid, and is optional', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ giants: [[0, 5, 6, 1, 0, 0, 0], [1, -5, 6, 1, 1, 0.5, 0.2]] })).ok, true);
  assert.equal(validateSnapshot(base({ giants: [] })).ok, true);
});

test('bad giants are refused: width, cap, id, state, bounds, non-numbers', () => {
  const ok = [0, 5, 6, 1, 0, 0, 0];
  assert.equal(validateSnapshot(base({ giants: [[0, 5, 6, 1, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: [ok, ok, ok] })).ok, false);
  assert.equal(LIMITS.maxGiants, 2);
  assert.equal(validateSnapshot(base({ giants: [[2, 5, 6, 1, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: [[0, 5, 6, 1, 5, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: [[0, 5, 6, 1, 1.5, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: [[0, 5000, 6, 1, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: [[0, 5, -5000, 1, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: [[0, 5, 6, 1, 0, 9, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: [[0, 5, 6, 1, 0, 'x', 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ giants: 'no' })).ok, false);
});

test('giants interpolate: position and heading blend, the state takes the nearer snapshot', () => {
  const buf = createSnapshotBuffer();
  const snap = (t, giants) => ({ ...base({ tick: Math.round(t * 15) + 1, t, giants }) });
  buf.push(snap(1, [[0, 0, 0, 0, 0, 0, 0]]), 1000);
  buf.push(snap(1.2, [[0, 10, 20, 1, 1, 1, 0]]), 1200);
  const mid = buf.sample(1100 + 100);
  assert.ok(mid);
  const row = mid.kinds.giants.get(0);
  assert.ok(row);
  assert.ok(row[1] >= 0 && row[1] <= 10 && row[3] >= 0 && row[3] <= 1);
  assert.ok(row[4] === 0 || row[4] === 1);
});

test('an older host sends no giants: the kind is simply empty', () => {
  const buf = createSnapshotBuffer();
  buf.push(base({ t: 1 }), 1000);
  buf.push(base({ t: 1.1, tick: 2 }), 1100);
  const s = buf.sample(1300);
  assert.ok(s);
  assert.equal(s.kinds.giants.size, 0);
});
