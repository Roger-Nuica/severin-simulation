import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, PHASE_NAMES, floodRow, burstWanted, strainWanted, soundScale, SOUND_NEAR, SOUND_FAR } from '../src/app/tornado/engine/net/floodFx.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer, INTERP_DELAY } from '../src/app/tornado/engine/net/interp.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const clamp = (v) => Math.max(-400, Math.min(400, v));
const st = (o = {}) => ({ phase: 'surge', frontX: -20.456, timer: 5, strainLength: 3.6, fade: 1, frozen: false, ...o });

test('phase codes match the names the flood system uses', () => {
  assert.deepEqual(PHASE_NAMES.map((_, i) => i), [0, 1, 2, 3, 4]);
  assert.equal(PHASE_NAMES[PHASE.surge], 'surge');
});

test('idle sends no row; a row has six columns, rounded and clamped', () => {
  assert.equal(floodRow(st({ phase: 'idle' }), clamp), null);
  const row = floodRow(st({ frontX: 999.123 }), clamp);
  assert.deepEqual(row, [0, 3, 400, 0, 1, 0]);
  assert.equal(row.length, EXTRA_ROW_WIDTH.flood);
});

test('strain is the cracked fraction in the strain phase only; frozen is carried', () => {
  assert.equal(floodRow(st({ phase: 'strain', timer: 1.8 }), clamp)[3], 0.5);
  assert.equal(floodRow(st({ phase: 'strain', timer: 99 }), clamp)[3], 1);
  assert.equal(floodRow(st({ phase: 'drain', timer: 1.8 }), clamp)[3], 0);
  assert.equal(floodRow(st({ frozen: true }), clamp)[5], 1);
});

test('the burst is seen once, on the way from before the gate went to after; a late joiner sees none', () => {
  assert.equal(burstWanted(PHASE.strain, PHASE.breaking), true);
  assert.equal(burstWanted(PHASE.strain, PHASE.surge), true);
  assert.equal(burstWanted(PHASE.breaking, PHASE.surge), false);
  assert.equal(burstWanted(null, PHASE.surge), false);
  assert.equal(strainWanted(null, PHASE.strain), true);
  assert.equal(strainWanted(PHASE.strain, PHASE.strain), false);
});

test('sounds are the host level at the dam and fade to nothing with distance', () => {
  assert.equal(soundScale(0), 1);
  assert.equal(soundScale(SOUND_NEAR), 1);
  assert.equal(soundScale(SOUND_FAR), 0);
  assert.equal(soundScale(1e6), 0);
  const mid = soundScale((SOUND_NEAR + SOUND_FAR) / 2);
  assert.ok(mid > 0.4 && mid < 0.6);
});

test('a snapshot with a flood row is valid and optional; bad rows are refused', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ flood: [] })).ok, true);
  const ok = [0, 3, -20, 0, 1, 0];
  assert.equal(validateSnapshot(base({ flood: [ok] })).ok, true);
  assert.equal(validateSnapshot(base({ flood: [ok, ok] })).ok, false, 'cap is one');
  assert.equal(LIMITS.maxFlood, 1);
  const bad = (i, v) => { const r = ok.slice(); r[i] = v; return validateSnapshot(base({ flood: [r] })).ok; };
  assert.equal(bad(0, 1), false);
  assert.equal(bad(1, 0), false);
  assert.equal(bad(1, 5), false);
  assert.equal(bad(2, 5000), false);
  assert.equal(bad(3, 2), false);
  assert.equal(bad(4, -1), false);
  assert.equal(bad(5, 2), false);
  assert.equal(validateSnapshot(base({ flood: [ok.slice(0, 5)] })).ok, false);
});

test('the front eases between snapshots, the phase takes the nearer; an older host samples empty', () => {
  const buf = createSnapshotBuffer({ room: 'ABCDEF' });
  buf.push(base({ tick: 1, t: 1, flood: [[0, 3, 0, 0, 1, 0]] }), 100);
  buf.push(base({ tick: 2, t: 2, flood: [[0, 4, 100, 0, 0.5, 0]] }), 101);
  const mid = buf.sample(99 + 1.5 + INTERP_DELAY);
  const r = mid.kinds.flood.get(0);
  assert.ok(r[2] > 5 && r[2] < 95, `front ${r[2]}`);
  assert.ok(r[1] === 3 || r[1] === 4);
  const old = createSnapshotBuffer({ room: 'ABCDEF' });
  old.push(base({ tick: 1, t: 1 }), 100);
  assert.equal(old.sample(100.5).kinds.flood.size, 0);
});

test('the bytes: one row, a few tens a snapshot, and zero when idle', () => {
  const n = JSON.stringify({ flood: [floodRow(st({ frontX: -123.45, fade: 0.87 }), clamp)] }).length;
  assert.ok(n < 60, `flood ${n}`);
  console.log(`flood bytes: ${n} B a snapshot (${Math.round(n * 15 / 100) / 10} KB/s at 15 Hz)`);
});
