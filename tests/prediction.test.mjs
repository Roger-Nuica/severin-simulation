import test from 'node:test';
import assert from 'node:assert/strict';
import { stepMove } from '../src/app/tornado/engine/net/movement.js';
import {
  newPrediction, activate, viewPoint, predictFrame, recordSent, replay, reconcile,
  SNAP_DISTANCE, MAX_PENDING
} from '../src/app/tornado/engine/net/prediction.js';

const SPEEDS = { run: 9, aim: 4, back: 3.5 };
const OPEN = { standable: () => true, bound: 288, speeds: SPEEDS };
const WALL = { ...OPEN, standable: (x) => x < 10 };
const FWD = { mx: 0, mz: 1, yaw: Math.PI / 2, aim: false }; // +x
const STOP = { mx: 0, mz: 0, yaw: 0, aim: false };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/** Drive the peer: n frames of dt, sending an input every `every` frames. */
const drive = (st, input, frames, dt, env, every, seqStart = 1) => {
  let seq = seqStart;
  let s = st;
  for (let i = 0; i < frames; i++) {
    if (i % every === 0) s = recordSent(s, seq++, input);
    s = predictFrame(s, input, dt, env);
  }
  return { st: s, seq };
};

test('inactive state ignores frames and sends', () => {
  const st = newPrediction();
  assert.equal(predictFrame(st, FWD, 0.016, OPEN), st);
  assert.equal(recordSent(st, 1, FWD), st);
});

test('a key press moves the predicted avatar on the very next frame', () => {
  const st = predictFrame(activate({ x: 0, z: 0 }), FWD, 1 / 60, OPEN);
  near(st.x, 9 / 60);
  near(viewPoint(st).x, 9 / 60);
});

test('prediction uses the shared stepMove (aim and back speeds included)', () => {
  const input = { mx: 0, mz: -1, yaw: 0, aim: true };
  const st = predictFrame(activate({ x: 5, z: 5 }), input, 0.05, OPEN);
  assert.deepEqual({ x: st.x, z: st.z }, stepMove({ x: 5, z: 5 }, input, 0.05, OPEN.standable, 288, SPEEDS));
});

test('frame time is credited to the newest sent input and clamped', () => {
  let st = recordSent(activate({ x: 0, z: 0 }), 1, FWD);
  st = predictFrame(st, FWD, 0.02, OPEN);
  st = predictFrame(st, FWD, 5, OPEN);
  near(st.pending[0].dt, 0.12);
});

test('pending buffer is trimmed by the ack and capped', () => {
  const { st } = drive(activate({ x: 0, z: 0 }), FWD, 30, 1 / 60, OPEN, 3);
  assert.equal(st.pending.length, 10);
  const r = reconcile(st, { x: 0, z: 0 }, 6, true, OPEN);
  assert.deepEqual(r.state.pending.map((p) => p.seq), [7, 8, 9, 10]);
  let big = activate({ x: 0, z: 0 });
  for (let i = 1; i <= MAX_PENDING + 20; i++) big = recordSent(big, i, FWD);
  assert.equal(big.pending.length, MAX_PENDING);
  assert.equal(big.pending[big.pending.length - 1].seq, MAX_PENDING + 20);
});

test('replay equals the host result when the host applied the same inputs', () => {
  const inputs = [
    { seq: 1, mx: 0, mz: 1, yaw: 0.3, aim: false, dt: 0.033 },
    { seq: 2, mx: 1, mz: 1, yaw: 1.1, aim: false, dt: 0.033 },
    { seq: 3, mx: -1, mz: 0, yaw: 2.2, aim: true, dt: 0.05 }
  ];
  const host = inputs.reduce((p, i) => stepMove(p, i, i.dt, OPEN.standable, 288, SPEEDS), { x: 3, z: -4 });
  const got = replay({ x: 3, z: -4 }, inputs, OPEN);
  assert.deepEqual(got, host);
});

test('reconciling with a perfect host leaves no error and no offset', () => {
  const { st } = drive(activate({ x: 0, z: 0 }), FWD, 12, 1 / 30, OPEN, 1);
  // The host applied inputs 1..6 exactly; the peer predicted all 12 frames.
  const hostPos = replay({ x: 0, z: 0 }, st.pending.slice(0, 6), OPEN);
  const r = reconcile(st, hostPos, 6, true, OPEN);
  assert.equal(r.snapped, false);
  assert.ok(r.error < 1e-9);
  near(r.state.ox, 0, 1e-9);
  near(r.state.x, st.x, 1e-9);
});

test('a small error is blended: the view stays continuous and the offset decays to nothing', () => {
  let st = predictFrame(activate({ x: 0, z: 0 }), STOP, 0.016, OPEN);
  const before = viewPoint(st);
  const r = reconcile(st, { x: -0.5, z: 0.2 }, -1, true, OPEN);
  assert.equal(r.snapped, false);
  near(r.error, Math.hypot(0.5, 0.2));
  const after = viewPoint(r.state);
  near(after.x, before.x); near(after.z, before.z);
  assert.notEqual(r.state.ox, 0);
  let s = r.state;
  for (let i = 0; i < 120; i++) s = predictFrame(s, STOP, 1 / 60, OPEN);
  near(s.ox, 0, 1e-3); near(s.oz, 0, 1e-3);
  near(viewPoint(s).x, -0.5, 1e-3);
});

test('a large error (teleport, Restart, rejected move) snaps with no offset', () => {
  const st = activate({ x: 0, z: 0 });
  const r = reconcile(st, { x: 25, z: 0 }, -1, true, OPEN);
  assert.equal(r.snapped, true);
  assert.deepEqual(viewPoint(r.state), { x: 25, z: 0 });
  assert.equal(r.state.ox, 0);
  const justUnder = reconcile(st, { x: SNAP_DISTANCE - 0.01, z: 0 }, -1, true, OPEN);
  assert.equal(justUnder.snapped, false);
});

test('after a teleport snap the unacknowledged inputs are replayed from the new spot', () => {
  let st = activate({ x: 0, z: 0 });
  st = recordSent(st, 1, FWD);
  st = predictFrame(st, FWD, 0.05, OPEN);
  st = recordSent(st, 2, FWD);
  st = predictFrame(st, FWD, 0.05, OPEN);
  const r = reconcile(st, { x: 25, z: 0 }, 1, true, OPEN);
  assert.equal(r.snapped, true);
  assert.deepEqual(r.state.pending.map((p) => p.seq), [2]);
  near(r.state.x, 25 + 9 * 0.05);
});

test('against a wall the replay stops where the host stops (no phantom lead)', () => {
  const { st } = drive(activate({ x: 9, z: 0 }), FWD, 30, 1 / 60, WALL, 2);
  assert.ok(st.x < 10);
  const r = reconcile(st, { x: st.x, z: 0 }, 0, true, WALL);
  assert.equal(r.snapped, false);
  assert.ok(r.error < 1e-9);
});

test('a wall only the host knows (peer predicts open ground) is pulled back, not left through it', () => {
  const { st } = drive(activate({ x: 9, z: 0 }), FWD, 30, 1 / 60, OPEN, 2);
  assert.ok(st.x > 10);
  const r = reconcile(st, { x: 9.9, z: 0 }, 0, true, OPEN);
  // Replay still runs on; the error is bounded by the unacknowledged travel, so it blends or snaps, never grows.
  assert.ok(r.error <= 9 * 0.5 + 0.2);
});

test('not controllable (down, dead, seated) drops the prediction; recovery restarts from the host', () => {
  const { st } = drive(activate({ x: 0, z: 0 }), FWD, 12, 1 / 30, OPEN, 1);
  const down = reconcile(st, { x: 1, z: 1 }, 5, false, OPEN);
  assert.equal(down.state.active, false);
  assert.equal(down.state.pending.length, 0);
  assert.equal(predictFrame(down.state, FWD, 0.1, OPEN), down.state);
  const up = reconcile(down.state, { x: 7, z: 8 }, 6, true, OPEN);
  assert.equal(up.snapped, true);
  assert.deepEqual(viewPoint(up.state), { x: 7, z: 8 });
  assert.equal(up.state.pending.length, 0);
});

test('functions never mutate their arguments', () => {
  const st = recordSent(activate({ x: 1, z: 1 }), 1, FWD);
  const frozen = JSON.stringify(st);
  predictFrame(st, FWD, 0.03, OPEN);
  recordSent(st, 2, FWD);
  reconcile(st, { x: 2, z: 2 }, 0, true, OPEN);
  assert.equal(JSON.stringify(st), frozen);
});

test('rejected and acknowledged-late inputs converge: random sequences end within the host result', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let host = { x: 0, z: 0 };
  let st = activate(host);
  let seq = 1;
  const sent = [];
  for (let f = 0; f < 600; f++) {
    const input = { mx: rnd() < 0.5 ? 1 : 0, mz: rnd() < 0.7 ? 1 : 0, yaw: rnd() * 6, aim: false };
    if (f % 2 === 0) { st = recordSent(st, seq, input); sent.push({ seq, ...input, dt: 1 / 30 }); seq++; }
    st = predictFrame(st, input, 1 / 60, OPEN);
    if (f % 4 === 3) {
      // The host has applied everything up to 4 inputs ago.
      const upto = Math.max(0, sent.length - 4);
      host = replay({ x: 0, z: 0 }, sent.slice(0, upto), OPEN);
      const ack = upto > 0 ? sent[upto - 1].seq : -1;
      st = reconcile(st, host, ack, true, OPEN).state;
    }
  }
  const authFinal = replay(host, st.pending, OPEN);
  assert.ok(Math.hypot(st.x - authFinal.x, st.z - authFinal.z) < 2);
});
