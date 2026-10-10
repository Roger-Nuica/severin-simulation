import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE, FUEL_PHASE, FIRE_ID_SPAN, MASK_BITS, fireId, fireRow, buildingRow, maskOf, hasBit, segmentState, orderFires } from '../src/app/tornado/engine/net/fireFx.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer, INTERP_DELAY } from '../src/app/tornado/engine/net/interp.js';
import { GAS } from '../src/app/tornado/engine/gasMains/config.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const id = (v) => v;
const clamp = (v) => Math.max(-400, Math.min(400, v));

test('ids never meet across types and fit the biggest type (18 ground patches, 6 mains, many buildings)', () => {
  const seen = new Set();
  for (const type of Object.values(FIRE)) for (let i = 0; i < 100; i++) seen.add(fireId(type, i));
  assert.equal(seen.size, 4 * 100);
  assert.ok(FIRE_ID_SPAN > 100);
  assert.equal(fireId(FIRE.gas, 5), 3005);
});

test('a row has the agreed eight columns, rounded, with the position clamped and the level held to 0..1', () => {
  const row = fireRow(FIRE.fuel, 1, { x: 999.123, z: -20.456, level: 7, a: FUEL_PHASE.burning }, clamp);
  assert.deepEqual(row, [2001, 2, 400, -20.46, 1, 2, 0, 0]);
  assert.equal(row.length, EXTRA_ROW_WIDTH.fires);
  assert.equal(fireRow(FIRE.ground, 0, { x: 0, z: 0, level: -3 }, id)[4], 0);
});

test('a building row carries its footprint and height, and a collapsed one has height 0', () => {
  const up = buildingRow(7, { x: 10.5, z: -4, level: 0.5, collapsed: false, width: 12.34, depth: 8, height: 15 }, id);
  assert.deepEqual(up, [7, 0, 10.5, -4, 0.5, 12.34, 8, 15]);
  const down = buildingRow(7, { x: 10.5, z: -4, level: 0.5, collapsed: true, width: 12, depth: 8, height: 15 }, id);
  assert.equal(down[7], 0);
});

test('the gas mains fit the masks: every segment of a main has a bit, and a bit round-trips', () => {
  assert.ok(Math.round((GAS.halfLength * 2) / GAS.segment) <= MASK_BITS);
  const flags = Array.from({ length: 30 }, (_, i) => i % 3 === 0);
  const m = maskOf(flags);
  for (let i = 0; i < 30; i++) assert.equal(hasBit(m, i), flags[i], `bit ${i}`);
  assert.equal(hasBit(m, 30), false);
  assert.equal(hasBit(m, -1), false);
  assert.ok(m <= 2 ** 31 - 1);
  assert.equal(maskOf(Array(40).fill(true)), 2 ** 30 - 1);
});

test('a segment reads burning over venting over spent, else sealed', () => {
  const burn = maskOf([true, false, false, false]);
  const vent = maskOf([true, true, false, false]);
  const spent = maskOf([true, true, true, false]);
  assert.deepEqual([0, 1, 2, 3].map((i) => segmentState(burn, vent, spent, i)), ['burning', 'venting', 'spent', 'sealed']);
});

test('the rows kept under the cap: mains, stations and patches first, then the fiercest buildings', () => {
  const gas = [[3000, 3, 0, 0, 0, 1, 0, 0]];
  const fuel = [[2000, 2, 1, 1, 1, 2, 0, 0]];
  const ground = Array.from({ length: 18 }, (_, i) => [1000 + i, 1, 0, 0, 0.5, 0, 0, 0]);
  const buildings = Array.from({ length: 60 }, (_, i) => [i, 0, 0, 0, i / 100, 10, 10, 10]);
  const out = orderFires({ gas, fuel, ground, buildings }, LIMITS.maxFires);
  assert.equal(out.length, LIMITS.maxFires);
  assert.equal(out[0][1], FIRE.gas);
  assert.equal(out[1][1], FIRE.fuel);
  assert.equal(out.filter((r) => r[1] === FIRE.ground).length, 18);
  const kept = out.filter((r) => r[1] === FIRE.building);
  assert.equal(kept.length, 64 - 20);
  assert.equal(kept[0][4], 0.59);
  assert.equal(orderFires({ gas: [], fuel: [], ground: [], buildings: [] }, 64).length, 0);
});

test('a snapshot with fires is valid, and is optional', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ fires: [] })).ok, true);
  const rows = [[3002, 3, 0, 0, 0, 2 ** 30 - 1, 5, 7], [2000, 2, 12, -30, 0.4, 1, 0, 0], [1003, 1, 4, 4, 0.8, 0, 0, 0], [12, 0, 10, 10, 1, 14, 9, 22]];
  assert.equal(validateSnapshot(base({ fires: rows })).ok, true);
});

test('the cap is 64 rows', () => {
  const row = (i) => [i, 0, 0, 0, 0.5, 10, 10, 10];
  assert.equal(validateSnapshot(base({ fires: Array.from({ length: 64 }, (_, i) => row(i)) })).ok, true);
  assert.equal(validateSnapshot(base({ fires: Array.from({ length: 65 }, (_, i) => row(i)) })).ok, false);
});

test('bad fires are refused: width, id, type, bounds, level, size, mask, non-numbers', () => {
  const ok = [0, 0, 5, 6, 0.5, 10, 10, 10];
  const bad = (i, v, row = ok) => { const r = row.slice(); r[i] = v; return validateSnapshot(base({ fires: [r] })).ok; };
  assert.equal(validateSnapshot(base({ fires: [ok.slice(0, 7)] })).ok, false);
  assert.equal(bad(0, -1), false);
  assert.equal(bad(0, 1.5), false);
  assert.equal(bad(1, 4), false);
  assert.equal(bad(1, -1), false);
  assert.equal(bad(2, 5000), false);
  assert.equal(bad(3, -5000), false);
  assert.equal(bad(4, 1.5), false);
  assert.equal(bad(4, -0.1), false);
  assert.equal(bad(5, 500), false);
  assert.equal(bad(7, NaN), false);
  assert.equal(bad(6, 'x'), false);
  const gas = [3001, 3, 0, 0, 0, 1, 2, 3];
  assert.equal(bad(5, 1.5, gas), false);
  assert.equal(bad(5, -1, gas), false);
  assert.equal(bad(6, 2 ** 31, gas), false);
  assert.equal(bad(5, 2 ** 30, gas), true);
  assert.equal(validateSnapshot(base({ fires: 'x' })).ok, false);
});

test('a fire fades in between snapshots (level eases), its type and masks take the nearer snapshot', () => {
  const buf = createSnapshotBuffer({ room: 'ABCDEF' });
  buf.push(base({ tick: 1, t: 1, fires: [[12, 0, 10, 10, 0, 14, 9, 22], [3000, 3, 0, 0, 0, 1, 0, 0]] }), 100);
  buf.push(base({ tick: 2, t: 2, fires: [[12, 0, 10, 10, 1, 14, 9, 22], [3000, 3, 0, 0, 0, 3, 0, 0]] }), 101);
  const mid = buf.sample(99 + 1.5 + INTERP_DELAY);
  assert.ok(mid, 'sample');
  const b = mid.kinds.fires.get(12);
  assert.ok(b[4] > 0.05 && b[4] < 0.95, `level ${b[4]}`);
  assert.equal(b[5], 14);
  const gas = mid.kinds.fires.get(3000);
  assert.ok(gas[5] === 1 || gas[5] === 3);
});

test('an older host sends no fires: the kind samples as empty', () => {
  const buf = createSnapshotBuffer({ room: 'ABCDEF' });
  buf.push(base({ tick: 1, t: 1 }), 100);
  const s = buf.sample(100.5);
  assert.equal(s.kinds.fires.size, 0);
});

test('the bytes: a typical blaze and the worst case stay far under the 64 KiB frame', () => {
  const typical = [
    ...Array.from({ length: 2 }, (_, i) => fireRow(FIRE.gas, i, { x: 0, z: 0, level: 0, a: 2 ** 30 - 1, b: 12345, c: 98765432 }, id)),
    ...Array.from({ length: 6 }, (_, i) => buildingRow(i, { x: -120.55, z: 80.25, level: 0.83, collapsed: false, width: 14.3, depth: 9.8, height: 21.5 }, id)),
    fireRow(FIRE.fuel, 0, { x: 33.1, z: -60.7, level: 1, a: 2 }, id),
    ...Array.from({ length: 10 }, (_, i) => fireRow(FIRE.ground, i, { x: 100.12, z: -33.45, level: 0.66 }, id))
  ];
  const worst = Array.from({ length: LIMITS.maxFires }, (_, i) => buildingRow(i, { x: -120.55, z: 80.25, level: 0.83, collapsed: false, width: 14.3, depth: 9.8, height: 21.5 }, id));
  const t = JSON.stringify(typical).length;
  const w = JSON.stringify(worst).length;
  assert.ok(t < 900, `typical ${t}`);
  assert.ok(w < 3000, `worst ${w}`);
  console.log(`fires bytes: typical ${t} B a snapshot (${Math.round(t * 15 / 100) / 10} KB/s), worst case ${w} B (${Math.round(w * 15 / 100) / 10} KB/s)`);
});
