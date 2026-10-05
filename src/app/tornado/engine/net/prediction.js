// @ts-check
/**
 * ===========================================================================
 * SECTION NP — Client-side prediction and server reconciliation (pure)
 * ===========================================================================
 * The guest applies its own movement at once with the host's `stepMove`, keeps
 * the inputs the host has not yet acknowledged, and on every snapshot replays
 * those from the host's authoritative position. The difference between the old
 * and new predicted position is not applied as a jump: it becomes a visual
 * offset that decays, unless it is large (a teleport, a seat, a Restart, a
 * rejected move), in which case the view snaps. The host stays authoritative:
 * nothing here is ever sent, and no function mutates its arguments.
 *
 * No scene, no DOM, no module state: every function takes a state and returns
 * a new one, so it can be tested without a browser.
 */
import { stepMove } from './movement.js';

/** Error larger than this (metres) is not blended: the view snaps (teleport is 25 m). */
export const SNAP_DISTANCE = 3;
/** Visual offset decay rate (1/s): about a tenth of a second to forget most of an error. */
export const OFFSET_RATE = 10;
/** Unacknowledged inputs kept (about three seconds at 30 Hz). */
export const MAX_PENDING = 90;
/** Longest single frame step (s), as the host also clamps its own frame. */
export const MAX_STEP = 0.1;
/** Offsets smaller than this (m) are dropped. */
const EPSILON = 1e-4;

/**
 * @typedef {{mx: number, mz: number, yaw: number, aim: boolean|number}} StepInput
 * @typedef {StepInput & {seq: number, dt: number}} Pending
 * An input as sent (`seq`), with the time (s) it has been the current one.
 * @typedef {{
 *   active: boolean,
 *   x: number, z: number,
 *   ox: number, oz: number,
 *   pending: ReadonlyArray<Pending>
 * }} Prediction
 * `x`,`z`: the predicted position; `ox`,`oz`: the decaying visual offset.
 * @typedef {{
 *   standable: (x: number, z: number) => boolean,
 *   bound: number,
 *   speeds: import('./movement.js').MoveSpeeds
 * }} MoveEnv
 * @typedef {{x: number, z: number}} Point
 */

/** @returns {Prediction} an inactive state (nothing predicted, nothing pending) */
export const newPrediction = () => ({ active: false, x: 0, z: 0, ox: 0, oz: 0, pending: [] });

/**
 * Start predicting from an authoritative position (snaps; clears the history).
 * @param {Point} auth
 * @returns {Prediction}
 */
export const activate = (auth) => ({ active: true, x: auth.x, z: auth.z, ox: 0, oz: 0, pending: [] });

/**
 * The position to draw: prediction plus the fading correction.
 * @param {Prediction} st
 * @returns {Point}
 */
export const viewPoint = (st) => ({ x: st.x + st.ox, z: st.z + st.oz });

/**
 * Advance the prediction by one rendered frame with the live input, so a key
 * press moves the avatar on the very next frame, and credit the frame to the
 * newest sent input (the one the host will be applying meanwhile).
 * @param {Prediction} st
 * @param {StepInput} input the live (not yet sent) intent
 * @param {number} dt frame seconds
 * @param {MoveEnv} env
 * @returns {Prediction}
 */
export const predictFrame = (st, input, dt, env) => {
  if (!st.active) return st;
  const step = Math.max(0, Math.min(MAX_STEP, dt));
  const next = stepMove(st, input, step, env.standable, env.bound, env.speeds);
  const k = Math.exp(-OFFSET_RATE * step);
  const ox = Math.abs(st.ox) < EPSILON ? 0 : st.ox * k;
  const oz = Math.abs(st.oz) < EPSILON ? 0 : st.oz * k;
  const n = st.pending.length;
  const pending = n === 0 ? st.pending : [...st.pending.slice(0, n - 1), { ...st.pending[n - 1], dt: st.pending[n - 1].dt + step }];
  return { active: true, x: next.x, z: next.z, ox, oz, pending };
};

/**
 * Remember an input at the moment it is sent. The oldest is dropped past the cap.
 * @param {Prediction} st
 * @param {number} seq
 * @param {StepInput} input
 * @returns {Prediction}
 */
export const recordSent = (st, seq, input) => {
  if (!st.active) return st;
  const entry = { seq, mx: input.mx, mz: input.mz, yaw: input.yaw, aim: input.aim, dt: 0 };
  const kept = st.pending.length >= MAX_PENDING ? st.pending.slice(st.pending.length - MAX_PENDING + 1) : st.pending;
  return { ...st, pending: [...kept, entry] };
};

/**
 * Replay inputs on top of a position with the shared step.
 * @param {Point} from
 * @param {ReadonlyArray<Pending>} inputs
 * @param {MoveEnv} env
 * @returns {Point}
 */
export const replay = (from, inputs, env) =>
  inputs.reduce((pos, input) => stepMove(pos, input, Math.min(MAX_STEP, input.dt), env.standable, env.bound, env.speeds), { x: from.x, z: from.z });

/**
 * Distance between two points.
 * @param {Point} a @param {Point} b
 * @returns {number}
 */
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * A snapshot arrived. `controllable` is false while the host does not let this
 * player walk (down, dead, seated in the car): the prediction is dropped and the
 * authoritative row drives the view. When it turns true again the prediction
 * restarts from the host's position. Otherwise: drop acknowledged inputs,
 * replay the rest from `auth`, and either blend (small error) or snap (large).
 * @param {Prediction} st
 * @param {Point} auth the host's position for this player in the newest snapshot
 * @param {number} ack the last input `seq` the host accepted (-1 for none yet)
 * @param {boolean} controllable
 * @param {MoveEnv} env
 * @returns {{state: Prediction, snapped: boolean, error: number}}
 */
export const reconcile = (st, auth, ack, controllable, env) => {
  if (!controllable) return { state: newPrediction(), snapped: st.active, error: 0 };
  if (!st.active) return { state: activate(auth), snapped: true, error: 0 };
  const pending = st.pending.filter((p) => p.seq > ack);
  const target = replay(auth, pending, env);
  const error = distance(target, st);
  if (error > SNAP_DISTANCE) return { state: { ...activate(target), pending }, snapped: true, error };
  // Keep the picture continuous: the old view minus the new prediction is the offset.
  const ox = st.x + st.ox - target.x;
  const oz = st.z + st.oz - target.z;
  return { state: { active: true, x: target.x, z: target.z, ox, oz, pending }, snapped: false, error };
};
