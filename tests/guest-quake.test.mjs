import test from 'node:test';
import assert from 'node:assert/strict';
import { QUAKE, quakeId, quakeRow, chasmRow, sinkholeRow, eruptionRow, lavaFillAt, needsSync, sameSite, CHASM_TIMER_MAX } from '../src/app/tornado/engine/net/quakeFx.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer, INTERP_DELAY } from '../src/app/tornado/engine/net/interp.js';
import { createRng } from '../src/app/tornado/engine/rng.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const clamp = (v) => Math.max(-400, Math.min(400, v));

test('rows have eight columns, rounded, with ids that never collide', () => {
  const rows = [
    quakeRow({ strength: 0.456, magnitude: 7.84 }),
    chasmRow(0, { seed: 12345, timer: 99 }),
    chasmRow(1, { seed: 777, timer: 1.234 }),
    sinkholeRow(2, { x: 999, z: -3.456, radius: 21.234, grown: 2, rimHeight: 1.5 }, clamp),
    eruptionRow({ seed: 42, severity: 0.5, heat: 1.2 }),
  ];
  for (const r of rows) assert.equal(r.length, EXTRA_ROW_WIDTH.quake);
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length);
  assert.deepEqual(rows[0], [0, 0, 0.46, 78, 0, 0, 0, 0]);
  assert.equal(rows[1][3], CHASM_TIMER_MAX);
  assert.deepEqual(rows[3].slice(2, 7), [400, -3.46, 21.23, 1, 1.5]);
  assert.equal(rows[4][4], 1);
  assert.equal(quakeId(QUAKE.eruption, 0), 24);
});

test('the lava fills from half the opening time over the rise time', () => {
  assert.equal(lavaFillAt(0, 2.6, 4), 0);
  assert.equal(lavaFillAt(1.3, 2.6, 4), 0);
  assert.equal(lavaFillAt(3.3, 2.6, 4), 0.5);
  assert.equal(lavaFillAt(99, 2.6, 4), 1);
});

test('a guest clock is set to the host only when far off, and not past the clamp', () => {
  assert.equal(needsSync(2, 2.1), false);
  assert.equal(needsSync(2, 3), true);
  assert.equal(needsSync(9, CHASM_TIMER_MAX), false);
  assert.equal(needsSync(1, CHASM_TIMER_MAX), true);
});

test('a sinkhole is known by its place', () => {
  assert.equal(sameSite({ x: 10, z: -4 }, 10.01, -4), true);
  assert.equal(sameSite({ x: 10, z: -4 }, 12, -4), false);
});

test('the same seed draws the same sequence on both screens', () => {
  const a = createRng(31337);
  const b = createRng(31337);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.notEqual(createRng(1)(), createRng(2)());
});

test('a snapshot with quake rows is valid and optional; bad rows are refused', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ quake: [] })).ok, true);
  const good = [
    quakeRow({ strength: 1, magnitude: 8 }),
    chasmRow(0, { seed: 5, timer: 2 }),
    sinkholeRow(0, { x: 10, z: 10, radius: 20, grown: 0.5, rimHeight: 1.5 }, clamp),
    eruptionRow({ seed: 9, severity: 0.7, heat: 0.4 }),
  ];
  assert.equal(validateSnapshot(base({ quake: good })).ok, true);
  assert.equal(validateSnapshot(base({ quake: [[0, 0, 2, 78, 0, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ quake: [[8, 1, 0, 2, 0, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ quake: [[16, 2, 999, 0, 20, 0, 1, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ quake: [[0, 4, 0, 0, 0, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ quake: [[0, 0, 1, 78, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ quake: Array.from({ length: LIMITS.maxQuake + 1 }, () => good[0]) })).ok, false);
});

test('quake rows reach the guest unblended, and an older host sends none', () => {
  const buf = createSnapshotBuffer({ room: 'ABCDEF' });
  buf.push(base({ tick: 1, t: 1, quake: [chasmRow(0, { seed: 4242, timer: 2 })] }), 100);
  buf.push(base({ tick: 2, t: 2, quake: [chasmRow(0, { seed: 9999, timer: 3 })] }), 101);
  const seed = buf.sample(99 + 1.5 + INTERP_DELAY).kinds.quake.get(quakeId(QUAKE.chasm, 0))[2];
  assert.ok(seed === 4242 || seed === 9999, `seed ${seed}`);
  const old = createSnapshotBuffer({ room: 'ABCDEF' });
  old.push(base({ tick: 1, t: 1 }), 100);
  assert.equal(old.sample(100.5).kinds.quake.size, 0);
});

test('the bytes: a full quake with two chasms, three holes and an eruption, and zero when idle', () => {
  const rows = [
    quakeRow({ strength: 0.87, magnitude: 7.9 }),
    chasmRow(0, { seed: 1073741823, timer: 2.55 }), chasmRow(1, { seed: 987654321, timer: 6 }),
    ...[0, 1, 2].map((i) => sinkholeRow(i, { x: -123.45, z: 98.76, radius: 27.55, grown: 0.55, rimHeight: 1.65 }, clamp)),
    eruptionRow({ seed: 1073741823, severity: 0.75, heat: 0.87 }),
  ];
  const n = JSON.stringify({ quake: rows }).length;
  assert.ok(n < 400, `quake ${n}`);
  console.log(`quake bytes: ${n} B a snapshot (${Math.round(n * 15 / 100) / 10} KB/s at 15 Hz)`);
});
