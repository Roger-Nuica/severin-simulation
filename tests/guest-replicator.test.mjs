import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { grownOf, replicatorRow, cloneRows, cloneSize, standingCount, easeHeat, glowLevels, originalSize, newReplicaScratch, poseOriginal, writeClones } from '../src/app/tornado/engine/net/replicatorPose.js';
import { PARTS } from '../src/app/tornado/engine/patientZero/model.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer } from '../src/app/tornado/engine/net/interp.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const id = (v) => v;
const ws = (o = {}) => ({ key: {}, x: 10, z: -20, heading: 1, attack: 0.5, form: 1, warpT: null, ...o });
const OK_O = [0, 5, 6, 1, 0.5, 0, 1, 1];
const OK_C = [3, 5, 6, 1, 0.5, 1];

test('grown: built from the feet up, coming apart for a warp, whole otherwise', () => {
  assert.equal(grownOf({ form: 1, warpT: null }, 0.4), 1);
  assert.equal(grownOf({ form: 0, warpT: null }, 0.4), 0.02);
  assert.ok(Math.abs(grownOf({ form: 0.5, warpT: null }, 0.4) - (1 - Math.pow(0.5, 2.2))) < 1e-9);
  assert.equal(grownOf({ form: 1, warpT: -1 }, 0.4), 1);
  assert.ok(Math.abs(grownOf({ form: 1, warpT: 0.2 }, 0.4) - 0.5) < 1e-9);
  assert.equal(grownOf({ form: 1, warpT: 5 }, 0.4), 0.02);
});

test('the original row has eight columns, rounded and clamped', () => {
  const row = replicatorRow({ ...ws({ x: 999.123, attack: 3 }), evolve: 0.456 }, 1.8, 0.4, (v) => Math.min(400, v));
  assert.deepEqual(row, [0, 400, -20, 1, 1, 0.46, 1, 1.8]);
  assert.equal(row.length, EXTRA_ROW_WIDTH.replicator);
});

test('clone rows have six columns, keep their ids and stop at the cap', () => {
  const a = ws(), b = ws({ form: 0 });
  const ids = new Map([[a.key, 7], [b.key, 9]]);
  const rows = cloneRows([a, b], 0.4, (o) => ids.get(o), id, 50);
  assert.deepEqual(rows[0], [7, 10, -20, 1, 0.5, 1]);
  assert.equal(rows[1][5], 0.02);
  assert.equal(rows[0].length, EXTRA_ROW_WIDTH.clones);
  const many = Array.from({ length: 60 }, () => ws());
  assert.equal(cloneRows(many, 0.4, () => 1, id, LIMITS.maxClones).length, 50);
});

test('a clone keeps its own size between 0.94 and 1.06', () => {
  for (let i = 0; i < 200; i++) { const s = cloneSize(i); assert.ok(s >= 0.94 && s <= 1.06); }
  assert.equal(cloneSize(12), cloneSize(12));
});

test('heat climbs with the clones standing and is full at the encirclement count', () => {
  assert.equal(standingCount([[1, 0, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0.4], [3, 0, 0, 0, 0, 1]]), 2);
  assert.equal(easeHeat(0, 15, 15, 100), 1);
  assert.ok(Math.abs(easeHeat(0, 15, 15, 0.1) - 0.15) < 1e-9);
  assert.equal(easeHeat(1, 0, 15, 100), 0);
});

test('glow follows the host: brighter with heat, the original always hot once evolving', () => {
  const cold = glowLevels(1, 0, false, 0, 0.9);
  assert.ok(Math.abs(cold.cloneGlow - 0.85) < 1e-9 && cold.cloneHeat === 0);
  assert.ok(Math.abs(cold.originalGlow - 1.3 * 0.85) < 1e-9);
  const hot = glowLevels(1, 1, true, Math.PI / 2 / 8.6, 0.9);
  assert.ok(hot.cloneGlow > 1.89 && hot.cloneHeat === 1);
  assert.equal(glowLevels(1, 0, true, 0, 0.9).originalHeat, 0.8);
});

test('the original grows by half once evolved, smoothly', () => {
  assert.equal(originalSize(0, 1.2, 1.5), 1.2);
  assert.ok(Math.abs(originalSize(1, 1.2, 1.5) - 1.8) < 1e-9);
  assert.ok(Math.abs(originalSize(0.5, 1.2, 1.5) - 1.5) < 1e-9);
});

const group = () => new THREE.Group();
const fig = () => {
  const parts = { figure: group(), halo2: group() };
  for (const n of ['head', 'armL', 'armR', 'legL', 'legR', 'armL2', 'armR2', 'scytheL', 'scytheR']) parts[n] = group();
  return { root: group(), parts, halo: group(), halo2: parts.halo2 };
};

test('the original stands, strides, grows and sprouts scythes as it evolves', () => {
  const f = fig(), k = newReplicaScratch(), c = { scale: 1.2, grow: 1.5 };
  poseOriginal(f, [0, 3, 4, 0.7, 0, 0, 1, 1], 1, Math.PI / 2, 0, 0.016, c, k);
  assert.deepEqual([f.root.position.x, f.root.position.z], [3, 4]);
  assert.ok(f.parts.legL.rotation.x > 0.3 && f.parts.legR.rotation.x < -0.3);
  assert.equal(f.parts.scytheL.visible, false);
  assert.ok(Math.abs(f.parts.figure.scale.y - 1.2) < 1e-9);
  poseOriginal(f, [0, 3, 4, 0.7, 0.4, 1, 1, 1], 0.5, 0, 0, 0.016, c, k);
  assert.equal(f.parts.scytheL.visible, true);
  assert.ok(Math.abs(f.parts.figure.scale.y - 1.8) < 1e-9);
  poseOriginal(f, [0, 3, 4, 0.7, 0.4, 0.5, 0.5, 1], 0, 0, 0, 0.016, c, k);
  assert.ok(f.parts.figure.position.y > 0.8);
  assert.ok(f.parts.figure.scale.y < f.parts.figure.scale.x * 2);
});

test('the clones fill one instance each, grow from the feet and are pruned when gone', () => {
  const meshes = {};
  for (const n of PARTS) { meshes[n] = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 50); }
  const runs = new Map(), k = newReplicaScratch();
  const rows = new Map([[1, [1, 5, 6, 0, 0, 1]], [2, [2, -5, 6, 1, 0.5, 0.5]]]);
  assert.equal(writeClones(meshes, rows, runs, 0.016, 2.2, 50, k), 2);
  assert.equal(meshes.body.count, 2);
  assert.equal(meshes.legL.count, 2);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  meshes.body.getMatrixAt(1, m);
  m.decompose(p, q, s);
  assert.ok(Math.abs(p.x + 5) < 1e-6 && s.y < s.x);
  assert.equal(runs.size, 2);
  rows.delete(1);
  assert.equal(writeClones(meshes, rows, runs, 0.016, 2.2, 50, k), 1);
  assert.equal(runs.size, 1);
  assert.equal(writeClones(meshes, new Map(), runs, 0.016, 2.2, 50, k), 0);
  assert.equal(meshes.head.count, 0);
});

test('the cap holds', () => {
  const meshes = {};
  for (const n of PARTS) meshes[n] = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 3);
  const rows = new Map(Array.from({ length: 5 }, (_, i) => [i, [i, 0, 0, 0, 0, 1]]));
  assert.equal(writeClones(meshes, rows, new Map(), 0.016, 2.2, 3, newReplicaScratch()), 3);
});

test('a snapshot with a replicator and clones is valid, and both are optional', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ replicator: [OK_O], clones: [OK_C, [4, 1, 1, 0, 0, 0.02]] })).ok, true);
  assert.equal(validateSnapshot(base({ replicator: [], clones: [] })).ok, true);
  const fifty = Array.from({ length: 50 }, (_, i) => [i, 0, 0, 0, 0, 1]);
  assert.equal(validateSnapshot(base({ clones: fifty })).ok, true);
});

test('bad replicator and clones are refused', () => {
  assert.equal(LIMITS.maxReplicator, 1);
  assert.equal(LIMITS.maxClones, 50);
  assert.equal(validateSnapshot(base({ replicator: [OK_O, OK_O] })).ok, false);
  assert.equal(validateSnapshot(base({ replicator: [[1, 5, 6, 1, 0.5, 0, 1, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ replicator: [[0, 5, 6, 1, 0.5, 0, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ replicator: [[0, 5000, 6, 1, 0.5, 0, 1, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ replicator: [[0, 5, 6, 1, 2, 0, 1, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ replicator: [[0, 5, 6, 1, 0.5, 2, 1, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ replicator: [[0, 5, 6, 1, 0.5, 0, 1, 99]] })).ok, false);
  assert.equal(validateSnapshot(base({ replicator: [[0, 5, 6, 1, 0.5, 0, 'x', 1]] })).ok, false);
  const fiftyOne = Array.from({ length: 51 }, (_, i) => [i, 0, 0, 0, 0, 1]);
  assert.equal(validateSnapshot(base({ clones: fiftyOne })).ok, false);
  assert.equal(validateSnapshot(base({ clones: [[1.5, 5, 6, 1, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ clones: [[-1, 5, 6, 1, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ clones: [[1, 5, 6, 1, 0.5]] })).ok, false);
  assert.equal(validateSnapshot(base({ clones: [[1, 5, -5000, 1, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ clones: [[1, 5, 6, 1, 0.5, 1.5]] })).ok, false);
  assert.equal(validateSnapshot(base({ clones: 'no' })).ok, false);
});

test('both interpolate: position and angle blend, clones appear and go by id; an older host gives empty kinds', () => {
  const buf = createSnapshotBuffer();
  const snap = (t, extra) => base({ tick: Math.round(t * 15) + 1, t, ...extra });
  buf.push(snap(1, { replicator: [[0, 0, 0, 0, 0, 0, 1, 1]], clones: [[1, 0, 0, 0, 0, 1]] }), 1000);
  buf.push(snap(1.2, { replicator: [[0, 10, 20, 1, 1, 0, 1, 1]], clones: [[1, 10, 0, 1, 0, 1], [2, 3, 3, 0, 0, 0.02]] }), 1200);
  const mid = buf.sample(1200);
  assert.ok(mid);
  const o = mid.kinds.replicator.get(0);
  assert.ok(o && o[1] >= 0 && o[1] <= 10 && o[3] >= 0 && o[3] <= 1);
  assert.equal(mid.kinds.clones.size, 2);
  const old = createSnapshotBuffer();
  old.push(base({ t: 1 }), 1000);
  old.push(base({ t: 1.1, tick: 2 }), 1100);
  const s = old.sample(1300);
  assert.equal(s.kinds.replicator.size, 0);
  assert.equal(s.kinds.clones.size, 0);
});

test('bytes: a full swarm snapshot stays far inside the frame limit', () => {
  const rows = Array.from({ length: 50 }, (_, i) => [1000 + i, -123.45, 123.45, 3.14, 0.5, 0.99]);
  const bytes = JSON.stringify({ replicator: [[0, -123.45, 123.45, 3.14, 0.5, 0.5, 1, 1.8]], clones: rows }).length;
  assert.ok(bytes < 3000, `${bytes} bytes`);
  assert.ok(bytes < LIMITS.maxBytes / 10);
});
