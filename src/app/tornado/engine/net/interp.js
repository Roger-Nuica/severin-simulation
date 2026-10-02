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

/** Columns holding angles (wrapped when blended), by kind. */
const ANGLE_COL = { players: 3, terminators: 3, aliens: 4, ships: 4, vehicles: 3 };
/** Columns that blend linearly, by kind (everything after the id). */
const WIDTH = { players: 9, tornadoes: 4, terminators: 5, aliens: 5, ships: 5, vehicles: 5 };
/** Columns that are discrete and take the nearer snapshot's value, by kind. */
const DISCRETE = { players: [4, 5, 7, 8], terminators: [4] };

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
  /** host time (snapshot.t) -> local time offset, set on first snapshot */
  let offset = null;
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
    // Align the clocks on the first snapshot, then keep the offset that
    // makes the *newest* arrival the most recent (min over the window).
    const candidate = localNow - snap.t;
    offset = offset === null ? candidate : Math.min(offset + 0.05, Math.max(offset - 0.05, candidate));
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
    for (const kind of SNAPSHOT_KINDS) {
      const out = new Map();
      const before = new Map(a[kind].map((/** @type {number[]} */ r) => [r[0], r]));
      for (const rb of b[kind]) {
        const ra = before.get(rb[0]);
        if (!ra || a === b) { out.set(rb[0], rb.slice()); continue; }
        const row = rb.slice();
        const w = WIDTH[/** @type {keyof typeof WIDTH} */ (kind)];
        const ang = /** @type {any} */ (ANGLE_COL)[kind];
        const disc = /** @type {any} */ (DISCRETE)[kind] || [];
        for (let c = 1; c < w; c++) {
          if (disc.includes(c)) row[c] = k < 0.5 ? ra[c] : rb[c];
          else if (c === ang) row[c] = lerpAngle(ra[c], rb[c], k);
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
    clear() { snaps = []; lastTick = -1; offset = null; room = opts.room; }
  };
}
