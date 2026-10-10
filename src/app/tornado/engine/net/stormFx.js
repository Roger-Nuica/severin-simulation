// @ts-check
/**
 * ===========================================================================
 * SECTION SF — The electric storm on the guest: the `storm` kind (pure)
 * ===========================================================================
 * One additive optional snapshot kind (an older guest ignores it, an older
 * host never sends it), present only while the host's Electric Tornado mode is
 * on and a funnel has come down (the key is omitted otherwise):
 *   storm  [id 0, charge, ringX, ringZ, ringRadius]
 * `charge` 0..1 is the column's glow; the ring columns are the travelling EMP
 * (radius 0 = none). The guest draws the sheath arcs, shells, orbs, motes,
 * light and the ring on its own copy of the funnel and never faults, shocks,
 * ignites, electrocutes, damages or scores anything (R-053). The storm's
 * ground bolts already travel as `bolt` rows. No scene, no DOM, no state.
 */

/** The ring's full reach (m); the host's `ELECTRIC.empRadius`. */
export const RING_MAX = 360;
/** The ring's speed (m/s); the host's `ELECTRIC.empSpeed`. */
export const RING_SPEED = 240;
/** A ring further than this (m) from the one the guest advanced is snapped to the host's. */
export const RING_SNAP = 30;

const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/**
 * @param {{charge: number, ring: {x: number, z: number, radius: number}|null}|null} s `electricStorm.replicaState()`
 * @param {(v: number) => number} clamp Keeps a position inside the world.
 * @returns {number[]|null} the one `storm` row (5 columns), or null when idle
 */
export function stormRow(s, clamp) {
  if (!s) return null;
  const ring = s.ring && s.ring.radius > 0 ? s.ring : null;
  return [0, r2(clamp01(s.charge)), ring ? r1(clamp(ring.x)) : 0, ring ? r1(clamp(ring.z)) : 0, ring ? r1(Math.min(RING_MAX, ring.radius)) : 0];
}

/**
 * The ring's radius on the guest this frame: it runs on at the host's speed
 * and is pulled back to the host's value when they differ a lot (a new ring).
 * @param {number} shown the radius drawn last frame (0 = none)
 * @param {number} sent the radius in the latest row (0 = none)
 * @param {number} dt
 * @returns {number} 0 when there is no ring
 */
export function ringRadius(shown, sent, dt) {
  if (!(sent > 0)) return 0;
  const run = shown > 0 ? shown + RING_SPEED * dt : sent;
  return Math.min(RING_MAX, Math.abs(run - sent) > RING_SNAP ? sent : Math.max(run, sent));
}

/** @param {number} radius @returns {number} the ring's opacity (the host's fade) */
export function ringOpacity(radius) {
  const left = 1 - Math.min(1, Math.max(0, radius / RING_MAX));
  return 0.9 * left * left;
}

/** @param {number} prev the radius shown last frame @param {number} next the radius now @returns {boolean} a new ring has just started */
export function ringStarted(prev, next) {
  return !(prev > 0) && next > 0;
}
