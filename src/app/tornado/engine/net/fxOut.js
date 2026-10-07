// @ts-check
/**
 * ===========================================================================
 * SECTION NO — Host-side fx rows (pure)
 * ===========================================================================
 * What the host puts in a snapshot's version 4 fields (R-061). The weapons
 * announce a shot on the local bus (`weaponFx`); `net/system.js` pushes it
 * into the fixed ring below, and `buildSnapshot` drains the ring into `fx`.
 * The state rows (`aim`, `hole`, `tw`, `env`) are built from plain numbers
 * here, clamped inside the validators of `net/protocol.js`, so a stray NaN or
 * an out-of-range value can never get a whole snapshot refused.
 *
 * The ring is a preallocated Float64Array: `push` allocates nothing (R-048),
 * so the minigun's 18 rounds a second cost a few stores each. Only `drain`
 * builds arrays, once per snapshot and only when a row is waiting. No scene,
 * no DOM, no module state: one ring per net system.
 */
import { FX_KINDS, EXTRA_ROW_WIDTH, LIMITS } from './protocol.js';

/** Rows the ring holds; the oldest is overwritten (and counted) when it is full. */
export const RING_CAPACITY = 64;

/**
 * What a shot hit, as the `hit` part of an `fx` row's `extra` (the low 4 bits).
 * Append only, like `FX_KINDS`.
 */
export const HIT_CODES = ['none', 'sky', 'ground', 'person', 'building', 'car', 'tree', 'enemy', 'other'];

/** Most the `extra` value a row carries above the hit code (the validator allows 1e4 in all). */
export const EXTRA_MAX = 600;

const W = EXTRA_ROW_WIDTH.fx;
const BOUND = LIMITS.worldBound;

/**
 * A finite number inside [lo, hi]; anything not finite becomes 0 (or the nearest bound
 * when 0 is outside), so NaN and Infinity never reach the wire.
 * @param {number} v @param {number} lo @param {number} hi
 * @returns {number}
 */
export const clampNum = (v, lo, hi) => (Number.isFinite(v) ? (v < lo ? lo : v > hi ? hi : v) : lo > 0 ? lo : hi < 0 ? hi : 0);

/** @param {number} v @returns {number} one decimal (a tenth of a metre is plenty for a tracer) */
const r1 = (v) => Math.round(v * 10) / 10;
/** @param {number} v @returns {number} two decimals */
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * The code of a `traceAim` kind string; unknown kinds are `other`.
 * @param {string} kind
 * @returns {number}
 */
export function hitCode(kind) {
  const i = HIT_CODES.indexOf(kind);
  if (i >= 0) return i;
  return kind ? HIT_CODES.indexOf('other') : 0;
}

/**
 * The `extra` column: the hit code in the low 4 bits, a small whole number
 * (0..EXTRA_MAX, for example the rifle's charge in hundredths) above it.
 * @param {number} hit a `HIT_CODES` index
 * @param {number} extra
 * @returns {number}
 */
export const packExtra = (hit, extra) => (hit & 15) + 16 * Math.round(clampNum(extra, 0, EXTRA_MAX));

/**
 * @param {number} packed an `extra` column
 * @returns {{hit: number, extra: number}}
 */
export const unpackExtra = (packed) => ({ hit: packed & 15, extra: Math.floor(packed / 16) });

/**
 * @typedef {{
 *   push: (kind: string, shooter: number, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, hit: number, extra: number) => boolean,
 *   drain: (max: number) => number[][],
 *   pending: () => number,
 *   emitted: () => number,
 *   sent: () => number,
 *   dropped: () => number,
 *   clear: () => void
 * }} FxRing
 */

/**
 * A fixed-size ring of `fx` rows. Ids are monotonic for the life of the ring
 * (`clear` empties it and zeroes the counters but never rewinds the ids, so a Restart cannot repeat an id
 * the guest has already seen).
 * @param {number} [capacity]
 * @returns {FxRing}
 */
export function createFxRing(capacity = RING_CAPACITY) {
  const cells = new Float64Array(capacity * W);
  let head = 0;
  let count = 0;
  let nextId = 1;
  let nEmitted = 0;
  let nSent = 0;
  let nDropped = 0;
  return {
    /**
     * Stores one row. Returns false (and stores nothing) for a kind this build
     * does not know. A full ring overwrites its oldest row and counts it dropped.
     */
    push(kind, shooter, fx, fy, fz, tx, ty, tz, hit, extra) {
      const k = FX_KINDS.indexOf(kind);
      if (k < 0) return false;
      if (count === capacity) { head = (head + 1) % capacity; count--; nDropped++; }
      const o = ((head + count) % capacity) * W;
      cells[o] = nextId++;
      cells[o + 1] = k;
      cells[o + 2] = Number.isInteger(shooter) && shooter >= -1 ? shooter : -1;
      cells[o + 3] = r1(clampNum(fx, -BOUND, BOUND));
      cells[o + 4] = r1(clampNum(fy, -BOUND, BOUND));
      cells[o + 5] = r1(clampNum(fz, -BOUND, BOUND));
      cells[o + 6] = r1(clampNum(tx, -1e4, 1e4));
      cells[o + 7] = r1(clampNum(ty, -1e4, 1e4));
      cells[o + 8] = r1(clampNum(tz, -1e4, 1e4));
      cells[o + 9] = packExtra(hit, extra);
      count++;
      nEmitted++;
      return true;
    },
    /** Takes up to `max` of the oldest rows out of the ring; the rest wait for the next snapshot. */
    drain(max) {
      const n = Math.min(count, Math.max(0, max));
      /** @type {number[][]} */
      const rows = [];
      for (let i = 0; i < n; i++) {
        const o = head * W;
        const row = new Array(W);
        for (let c = 0; c < W; c++) row[c] = cells[o + c];
        rows.push(row);
        head = (head + 1) % capacity;
      }
      count -= n;
      nSent += n;
      return rows;
    },
    pending: () => count,
    emitted: () => nEmitted,
    sent: () => nSent,
    dropped: () => nDropped,
    clear() { head = 0; count = 0; nEmitted = nSent = nDropped = 0; }
  };
}

/**
 * An `aim` row: [playerId, yaw, pitch, firingBits]. Bits: 1 Fire Gun firing,
 * 2 minigun barrels spinning.
 * @param {number} id @param {number} yaw radians @param {number} pitch radians @param {number} bits
 * @returns {number[]}
 */
export function aimRow(id, yaw, pitch, bits) {
  const y = Number.isFinite(yaw) ? Math.atan2(Math.sin(yaw), Math.cos(yaw)) : 0;
  return [Math.max(0, Math.round(clampNum(id, 0, 1e6))), r2(y), r2(clampNum(pitch, -1.6, 1.6)), Math.round(clampNum(bits, 0, 255))];
}

/**
 * A `hole` row: [x, z, age, closing 0|1]; age is seconds since it opened.
 * @param {number} x @param {number} z @param {number} age @param {boolean} closing
 * @returns {number[]}
 */
export const holeRow = (x, z, age, closing) => [r2(clampNum(x, -BOUND, BOUND)), r2(clampNum(z, -BOUND, BOUND)), r2(clampNum(age, 0, 1e6)), closing ? 1 : 0];

/**
 * A `tw` row: [id, birth, sizeMul, fade, leanX, leanZ]; `id` is the index of
 * the tornado's row in `tornadoes`.
 * @param {number} id @param {number} birth 0..1 @param {number} sizeMul @param {number} fade 0..1 @param {number} leanX @param {number} leanZ
 * @returns {number[]}
 */
export const twRow = (id, birth, sizeMul, fade, leanX, leanZ) => [
  Math.max(0, Math.round(clampNum(id, 0, 1e6))), r2(clampNum(birth, 0, 1)), r2(clampNum(sizeMul, 0, 100)), r2(clampNum(fade, 0, 1)),
  r2(clampNum(leanX, -BOUND, BOUND)), r2(clampNum(leanZ, -BOUND, BOUND))
];

/**
 * The `env` row: [running 0|1, stormRamp, intensity, wind, radius, daylight, timeScale].
 * @param {boolean} running @param {number} stormRamp @param {number} intensity @param {number} wind @param {number} radius @param {number} daylight @param {number} timeScale
 * @returns {number[]}
 */
export const envRow = (running, stormRamp, intensity, wind, radius, daylight, timeScale) => [
  running ? 1 : 0, r2(clampNum(stormRamp, 0, 1)), r2(clampNum(intensity, 0, 10)), r2(clampNum(wind, 0, 1000)),
  r2(clampNum(radius, 0, 1000)), r2(clampNum(daylight, 0, 1)), r2(clampNum(timeScale, 0, 10))
];
