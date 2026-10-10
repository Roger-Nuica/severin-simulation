import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { eulerYXZ, carClass, pickCars, carRow, poseCar, colourIndex, CAR_CLASS } from '../src/app/tornado/engine/net/carPose.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer } from '../src/app/tornado/engine/net/interp.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });

test('euler angles match three.js YXZ for a thrown, tumbling car', () => {
  for (const [y, x, z] of [[0.3, 0, 0], [1.2, 0.4, -0.2], [-2.5, -0.7, 0.9], [3, 0.1, 2.5]]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    const e = eulerYXZ(q);
    const back = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.pitch, e.yaw, e.roll, 'YXZ'));
    assert.ok(Math.abs(Math.abs(back.dot(q)) - 1) < 1e-9, `${x} ${y} ${z}`);
  }
});

test('straight up or down (gimbal) still gives a finite pose', () => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0.5, 0, 'YXZ'));
  const e = eulerYXZ(q);
  for (const v of Object.values(e)) assert.ok(Number.isFinite(v));
});

test('priority: driven, then airborne or tilted or lifted, then moving, then parked', () => {
  const still = { y: 0, speedSq: 0, pitch: 0, roll: 0 };
  assert.equal(carClass({ ...still, driven: true, y: 5 }), CAR_CLASS.driven);
  assert.equal(carClass({ ...still, y: 3 }), CAR_CLASS.airborne);
  assert.equal(carClass({ ...still, roll: 1.4 }), CAR_CLASS.airborne);
  assert.equal(carClass({ ...still, lifted: true }), CAR_CLASS.airborne);
  assert.equal(carClass({ ...still, speedSq: 9 }), CAR_CLASS.moving);
  assert.equal(carClass(still), CAR_CLASS.parked);
});

test('over the cap the airborne and moving cars win, and the choice is stable', () => {
  const cars = Array.from({ length: 100 }, (_, i) => ({ id: i, cls: i >= 90 ? CAR_CLASS.airborne : i >= 80 ? CAR_CLASS.moving : CAR_CLASS.parked }));
  const picked = pickCars(cars, 64);
  assert.equal(picked.length, 64);
  for (let i = 80; i < 100; i++) assert.ok(picked.some((c) => c.id === i), `car ${i}`);
  assert.deepEqual(pickCars(cars, 64).map((c) => c.id), picked.map((c) => c.id));
  assert.equal(pickCars(cars.slice(0, 3), 64).length, 3);
});

test('a row has the agreed eight columns, rounded', () => {
  const row = carRow(7, { x: 1.2345, y: 10.006, z: -3 }, { yaw: 0.5, pitch: -0.123456, roll: 1 }, 3);
  assert.deepEqual(row, [7, 1.23, 10.01, -3, 0.5, -0.12, 1, 3]);
  assert.equal(row.length, EXTRA_ROW_WIDTH.cars);
});

test('poseCar sets position and YXZ angles (yaw first)', () => {
  const o = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
  poseCar(o, [1, 4, 5, 6, 0.7, 0.2, -0.1, 0]);
  assert.deepEqual(o.position.toArray(), [4, 5, 6]);
  assert.equal(o.rotation.order, 'YXZ');
  assert.ok(Math.abs(o.rotation.y - 0.7) < 1e-9 && Math.abs(o.rotation.x - 0.2) < 1e-9 && Math.abs(o.rotation.z + 0.1) < 1e-9);
});

test('an unknown colour index falls back to the first', () => {
  assert.equal(colourIndex(2, 6), 2);
  assert.equal(colourIndex(9, 6), 0);
  assert.equal(colourIndex(-1, 6), 0);
  assert.equal(colourIndex(1.5, 6), 0);
});

test('snapshot: cars are optional, validated, capped and never widen vehicles', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ cars: [[1, 10, 0, 20, 0.5, 0, 0, 2]] })).ok, true);
  assert.equal(validateSnapshot(base({ cars: [] })).ok, true);
  assert.equal(validateSnapshot(base({ cars: [[1, 10, 40, 20, 0.5, 0.3, 3, 2]] })).ok, true);
  for (const bad of [[[1, 10, 0, 20, 0, 0, 0]], [[1, 10, 0, 20, 0, 0, 0, 2, 9]], [[1, 9999, 0, 20, 0, 0, 0, 2]], [[1, 10, 0, 9999, 0, 0, 0, 2]], [[1, 10, 5000, 20, 0, 0, 0, 2]], [[-1, 10, 0, 20, 0, 0, 0, 2]], [[1, 10, 0, 20, 0, 0, 0, 1.5]], [[1, 10, 0, 20, NaN, 0, 0, 2]], 'x']) {
    assert.equal(validateSnapshot(base({ cars: bad })).ok, false, JSON.stringify(bad));
  }
  const over = Array.from({ length: LIMITS.maxPerKind + 1 }, (_, i) => [i, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(validateSnapshot(base({ cars: over })).ok, false);
  // The old row keeps its five columns.
  assert.equal(validateSnapshot(base({ vehicles: [[1, 1, 1, 0, 3]] })).ok, true);
  assert.equal(validateSnapshot(base({ vehicles: [[1, 1, 1, 0, 3, 0]] })).ok, false);
  assert.equal(V, 4);
});

test('the buffer blends a car\'s height and all three angles, and takes the nearer colour', () => {
  const buf = createSnapshotBuffer({ room: 'ABCDEF' });
  buf.push(base({ tick: 1, t: 1, cars: [[5, 0, 0, 0, 0, 0, 0, 1]] }), 1);
  buf.push(base({ tick: 2, t: 2, cars: [[5, 10, 8, 20, 1, 0.4, -0.6, 2]] }), 2);
  // The clock offset is 0 (first snapshot t=1 arrived at 1): local 1.64 renders host time 1.5.
  const s = buf.sample(1.64);
  const row = s.kinds.cars.get(5);
  assert.ok(Math.abs(row[1] - 5) < 1e-6 && Math.abs(row[2] - 4) < 1e-6 && Math.abs(row[3] - 10) < 1e-6);
  assert.ok(Math.abs(row[4] - 0.5) < 1e-6 && Math.abs(row[5] - 0.2) < 1e-6 && Math.abs(row[6] + 0.3) < 1e-6);
  assert.ok(row[7] === 1 || row[7] === 2);
});

test('an older host (no cars) gives an empty cars map', () => {
  const buf = createSnapshotBuffer({ room: 'ABCDEF' });
  buf.push(base({ tick: 1, t: 1 }), 1);
  buf.push(base({ tick: 2, t: 2 }), 2);
  assert.equal(buf.sample(2).kinds.cars.size, 0);
});
