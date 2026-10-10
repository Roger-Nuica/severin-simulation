// @ts-check
/**
 * ===========================================================================
 * SECTION FN — The Firenado on the guest: the `firenado` kind (pure)
 * ===========================================================================
 * One additive optional snapshot kind (an older guest ignores it, an older
 * host never sends it), present only while the host's funnel burns (the key is
 * omitted otherwise):
 *   firenado  [id 0, strength]
 * `strength` 0..1 is the fire's envelope on the host (fade in, fade out, the
 * funnel's presence). The guest draws the flame column, tongues, embers,
 * glow, firelight and roar on its own copy of the funnel and never ignites,
 * burns, damages, multiplies or scores anything (R-053). No scene, no DOM, no
 * state.
 */

/** Per second rate the guest eases its strength towards the host's. */
export const EASE_RATE = 8;
/** Below this the guest's fire counts as out. */
export const OUT_BELOW = 0.005;

const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * @param {number|null|undefined} strength `firenado.replicaState()`: the envelope, or null when not burning
 * @returns {number[]|null} the one `firenado` row (2 columns), or null when the funnel is not burning
 */
export function firenadoRow(strength) {
  if (!(typeof strength === 'number') || !(strength > 0)) return null;
  return [0, r2(clamp01(strength))];
}

/**
 * The strength the guest draws this frame: eased towards the host's value.
 * @param {number} shown the strength drawn last frame
 * @param {number} sent the strength in the latest row (0 = none)
 * @param {number} dt
 * @returns {number} 0 once it has faded out
 */
export function easeStrength(shown, sent, dt) {
  const next = shown + (sent - shown) * Math.min(1, Math.max(0, dt) * EASE_RATE);
  return next < OUT_BELOW && !(sent > 0) ? 0 : clamp01(next);
}

/** @param {number} prev the strength shown last frame @param {number} next the strength now @returns {boolean} the fire has just caught */
export function fireStarted(prev, next) {
  return !(prev > 0) && next > 0;
}
