// @ts-check
/**
 * ===========================================================================
 * SECTION NI — Snapshot buffer and interpolation
 * ===========================================================================
 * The peer keeps a short buffer of host snapshots and renders a fixed delay
 * behind the newest, interpolating between the two that bracket that time.
 * Out-of-order, duplicate, wrong-version or other-room snapshots are dropped;
 * missing entities hold their last state for one gap and then vanish;
 * extrapolation is clamped so a stalled host never flings anything away.
 */
import { PROTOCOL_VERSION, SNAPSHOT_KINDS, validateSnapshot } from './protocol.js';

/** Render this far behind the newest snapshot: ~2 snapshots at 15 Hz. */
export const INTERP_DELAY = 0.14;
/** Never extrapolate further than this past the newest snapshot (s). */
export const MAX_EXTRAPOLATE = 0.25;
/** Snapshots kept. */
export const BUFFER_SIZE = 8;
/** Arrival samples the clock-offset estimator takes its minimum over (~8 s at 15 Hz). */
export const OFFSET_WINDOW = 120;
/** Most the offset may move per accepted snapshot (s): a slow slew, never a jump. */
export const OFFSET_SLEW = 0.01;

/**
 * @typedef {object} OffsetEstimator
 * @property {(candidate: number) => number} update feed one `localNow - snap.t`; returns the offset to use
 * @property {() => number|null} value current offset, null before the first sample
 * @property {() => void} clear
 */

/**
 * Clock-offset estimator: the host-time to local-time offset is the minimum of
 * `localNow - snap.t` over a sliding window (the least-delayed arrival is the
 * best estimate of the true offset; queueing jitter only ever adds delay), and
 * the value in use slews toward it by at most `slew` per sample so neither a
 * jitter spike nor a window edge moves render time. The first sample is taken
 * as is. Per instance; the ring is preallocated, so no per-sample allocation.
 * @param {number} [windowSize] samples in the window
 * @param {number} [slew] maximum change per sample (s)
 * @returns {OffsetEstimator}
 */
export function createOffsetEstimator(windowSize = OFFSET_WINDOW, slew = OFFSET_SLEW) {
  const ring = new Float64Array(Math.max(1, windowSize | 0));
  let count = 0;
  let head = 0;
  /** @type {number|null} */
  let offset = null;
  return {
    update(candidate) {
      ring[head] = candidate;
      head = (head + 1) % ring.length;
      if (count < ring.length) count++;
      let min = Infinity;
      for (let i = 0; i < count; i++) if (ring[i] < min) min = ring[i];
      offset = offset === null ? candidate : Math.min(offset + slew, Math.max(offset - slew, min));
      return offset;
    },
    value: () => offset,
    clear() { count = 0; head = 0; offset = null; }
  };
}

/** Columns holding angles (wrapped when blended), by kind. */
const ANGLE_COL = { players: [3], terminators: [3], aliens: [4], ships: [4], vehicles: [3], cars: [4, 5, 6], giants: [3], replicator: [3], clones: [3], figures: [5], flyers: [5, 6, 7] };
/** Columns that blend linearly, by kind (everything after the id). */
const WIDTH = { players: 9, tornadoes: 4, terminators: 5, aliens: 5, ships: 5, vehicles: 5, cars: 8, giants: 7, replicator: 8, clones: 6, figures: 9, flyers: 10, fires: 8 };
/** Columns that are discrete and take the nearer snapshot's value, by kind. */
const DISCRETE = { players: [4, 5, 7, 8], terminators: [4], cars: [7], giants: [4], figures: [1, 6], flyers: [1, 8], fires: [1, 5, 6, 7] };
/** Optional kinds (additive, absent from an older host): interpolated like the rest, an empty map when absent. */
const OPTIONAL_KINDS = ['cars', 'giants', 'replicator', 'clones', 'figures', 'flyers', 'fires'];

/** @param {number} a @param {number} b @param {number} k */
const lerp = (a, b, k) => a + (b - a) * k;
/** @param {number} a @param {number} b @param {number} k */
const lerpAngle = (a, b, k) => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
};

/**
 * @param {{room?: string}} [opts] when set, snapshots of other rooms are dropped
 */
export function createSnapshotBuffer(opts = {}) {
  /** @type {any[]} */
  let snaps = [];
  let lastTick = -1;
  /** host time (snapshot.t) -> local time offset: windowed minimum, set on first snapshot */
  const clock = createOffsetEstimator();
  /** @type {string|undefined} */
  let room = opts.room;

  /**
   * @param {any} snap
   * @param {number} localNow seconds, the receiver's clock
   * @returns {{ok: true} | {ok: false, error: string}}
   */
  function push(snap, localNow) {
    const v = validateSnapshot(snap);
    if (!v.ok) return v;
    if (snap.v !== PROTOCOL_VERSION) return { ok: false, error: 'version' };
    if (room !== undefined && snap.room !== room) return { ok: false, error: 'room' };
    if (room === undefined) room = snap.room;
    if (snap.tick <= lastTick) return { ok: false, error: 'stale' };
    lastTick = snap.tick;
    // Align the clocks on the first snapshot, then follow the minimum of
    // (arrival - host time) over the window, slewed (see createOffsetEstimator).
    clock.update(localNow - snap.t);
    snaps.push(snap);
    if (snaps.length > BUFFER_SIZE) snaps.shift();
    return { ok: true };
  }

  /**
   * Entities at the render time for `localNow`.
   * @param {number} localNow
   * @returns {{t: number, score: number, kinds: Record<string, Map<number, number[]>>}|null}
   */
  function sample(localNow) {
    const offset = clock.value();
    if (!snaps.length || offset === null) return null;
    const newest = snaps[snaps.length - 1];
    const renderT = Math.min(localNow - offset - INTERP_DELAY, newest.t + MAX_EXTRAPOLATE);
    let a = snaps[0];
    let b = snaps[0];
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].t <= renderT) a = snaps[i];
      if (snaps[i].t >= renderT) { b = snaps[i]; break; }
      b = snaps[i];
    }
    const span = b.t - a.t;
    const k = span > 1e-6 ? Math.min(1, Math.max(0, (renderT - a.t) / span)) : (renderT >= b.t ? 1 : 0);
    /** @type {Record<string, Map<number, number[]>>} */
    const kinds = {};
    for (const kind of [...SNAPSHOT_KINDS, ...OPTIONAL_KINDS]) {
      const out = new Map();
      const before = new Map((a[kind] || []).map((/** @type {number[]} */ r) => [r[0], r]));
      for (const rb of b[kind] || []) {
        const ra = before.get(rb[0]);
        if (!ra || a === b) { out.set(rb[0], rb.slice()); continue; }
        const row = rb.slice();
        const w = WIDTH[/** @type {keyof typeof WIDTH} */ (kind)];
        const ang = /** @type {any} */ (ANGLE_COL)[kind] || [];
        const disc = /** @type {any} */ (DISCRETE)[kind] || [];
        for (let c = 1; c < w; c++) {
          if (disc.includes(c)) row[c] = k < 0.5 ? ra[c] : rb[c];
          else if (ang.includes(c)) row[c] = lerpAngle(ra[c], rb[c], k);
          else row[c] = lerp(ra[c], rb[c], k);
        }
        out.set(rb[0], row);
      }
      kinds[kind] = out;
    }
    return { t: renderT, score: b.score, kinds };
  }

  return {
    push, sample,
    size: () => snaps.length,
    lastTick: () => lastTick,
    clear() { snaps = []; lastTick = -1; clock.clear(); room = opts.room; }
  };
}
