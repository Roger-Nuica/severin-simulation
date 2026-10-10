// @ts-check
/**
 * ===========================================================================
 * SECTION QK — The earthquake family on the guest: the `quake` kind (pure)
 * ===========================================================================
 * The earthquake, the chasm, the sinkholes and the lava fissures share one
 * additive optional snapshot kind (an older guest ignores it, an older host
 * never sends it); the key is omitted when none of them is on the field:
 *   quake  [id, type, a, b, c, d, e, f]
 * `id` is `quakeId(type, slot)`. What the columns mean depends on the type:
 *   quake     (id 0, only while it shakes) a strength 0..1, b magnitude x 10
 *   chasm     a seed (the shape is built from it, so both screens show the same
 *             crack), b seconds since it began (clamped to `CHASM_TIMER_MAX`)
 *   sinkhole  a x, b z, c radius, d grown 0..1, e rim height
 *   eruption  (id 24, while fissures show) a seed (the cracks and vents are
 *             built from it), b severity 0..1, c heat 0..1
 * Every column is read as the latest value (no blending). The guest only draws:
 * no shake, no damage, no swallow, no score. No scene, no DOM, no module state.
 */

/** Row types (the `type` column). */
export const QUAKE = Object.freeze({ quake: 0, chasm: 1, sinkhole: 2, eruption: 3 });

/** Slots a type has inside an id. */
export const QUAKE_SLOTS = 8;

/** Chasms the host keeps (CHASM.maxChasms) and sinkholes (SINKHOLE.maxKept): the slots that are ever used. */
export const MAX_CHASMS = 2;
export const MAX_SINKHOLES = 3;

/** Past this many seconds the chasm has finished opening and the lava is full, so the timer stops mattering. */
export const CHASM_TIMER_MAX = 6;

/** A guest clock off by more than this many seconds is set to the host's. */
export const SYNC_SLACK = 0.3;

/** @param {number} type A `QUAKE` value. @param {number} slot @returns {number} */
export const quakeId = (type, slot) => type * QUAKE_SLOTS + slot;

const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * @param {{strength: number, magnitude: number}} s The quake while it shakes (`earthquake.replicaState()`).
 * @returns {number[]} The one quake row.
 */
export function quakeRow(s) {
  return [quakeId(QUAKE.quake, 0), QUAKE.quake, r2(clamp01(s.strength)), Math.round(s.magnitude * 10), 0, 0, 0, 0];
}

/**
 * @param {number} slot Position among the chasms (0 oldest).
 * @param {{seed: number, timer: number}} c
 * @returns {number[]}
 */
export function chasmRow(slot, c) {
  return [quakeId(QUAKE.chasm, slot), QUAKE.chasm, c.seed, r2(Math.min(CHASM_TIMER_MAX, Math.max(0, c.timer))), 0, 0, 0, 0];
}

/**
 * @param {number} slot
 * @param {{x: number, z: number, radius: number, grown: number, rimHeight: number}} h
 * @param {(v: number) => number} clamp Keeps a horizontal position inside the world.
 * @returns {number[]}
 */
export function sinkholeRow(slot, h, clamp) {
  return [quakeId(QUAKE.sinkhole, slot), QUAKE.sinkhole, r2(clamp(h.x)), r2(clamp(h.z)), r2(h.radius), r2(clamp01(h.grown)), r2(h.rimHeight), 0];
}

/**
 * @param {{seed: number, severity: number, heat: number}} e
 * @returns {number[]}
 */
export function eruptionRow(e) {
  return [quakeId(QUAKE.eruption, 0), QUAKE.eruption, e.seed, r2(clamp01(e.severity)), r2(clamp01(e.heat)), 0, 0, 0];
}

/**
 * How full of lava a chasm is for its age: it starts to well up once the
 * middle has opened (half of `openSeconds`) and fills over `riseSeconds`.
 * @param {number} timer @param {number} openSeconds @param {number} riseSeconds @returns {number} 0..1
 */
export function lavaFillAt(timer, openSeconds, riseSeconds) {
  return clamp01((timer - openSeconds * 0.5) / riseSeconds);
}

/**
 * Whether a guest clock should be set to the host's: far off, and not both
 * past the point where the timer stops meaning anything.
 * @param {number} mine @param {number} host @returns {boolean}
 */
export function needsSync(mine, host) {
  if (host >= CHASM_TIMER_MAX && mine >= CHASM_TIMER_MAX) return false;
  return Math.abs(mine - host) > SYNC_SLACK;
}

/**
 * Whether a mirrored sinkhole is the one a row describes: the same place
 * (a hole never moves, and two never overlap).
 * @param {{x: number, z: number}} hole @param {number} x @param {number} z @returns {boolean}
 */
export function sameSite(hole, x, z) {
  return Math.abs(hole.x - x) < 0.1 && Math.abs(hole.z - z) < 0.1;
}
