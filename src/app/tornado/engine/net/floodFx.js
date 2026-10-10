// @ts-check
/**
 * ===========================================================================
 * SECTION FD — The flood and dam break on the guest: the `flood` kind (pure)
 * ===========================================================================
 * One additive optional snapshot kind (an older guest ignores it, an older
 * host never sends it), present only while the dam is failing or the water is
 * out (the key is omitted when idle):
 *   flood  [id 0, phase, frontX, strain, fade, frozen]
 * `phase` is a `PHASE` value; `frontX` is how far the wave has crossed;
 * `strain` 0..1 is how far the gate has cracked (strain phase only); `fade`
 * 1 while the water is out, falling to 0 as it drains; `frozen` 1 while the
 * Blizzard holds it still. The guest draws the same water surface, wave,
 * spray and breach from this and never pushes, drowns, floats, damages or
 * scores anything. No scene, no DOM, no module state.
 */

/** Flood phases (the `phase` column). */
export const PHASE = Object.freeze({ idle: 0, strain: 1, breaking: 2, surge: 3, drain: 4 });

/** Phase names by code, as the flood system names them. */
export const PHASE_NAMES = Object.freeze(['idle', 'strain', 'breaking', 'surge', 'drain']);

/** Metres from the dam inside which its sounds play at full level, and beyond which they are gone. */
export const SOUND_NEAR = 25;
export const SOUND_FAR = 260;

const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * @param {{phase: string, frontX: number, timer: number, strainLength: number, fade: number, frozen: boolean}} s The flood's state (`flood.replicaState()`).
 * @param {(v: number) => number} clamp Keeps the position inside the world.
 * @returns {number[]|null} The one `flood` row (6 columns), or null when idle (nothing to send).
 */
export function floodRow(s, clamp) {
  const phase = PHASE_NAMES.indexOf(s.phase);
  if (phase <= PHASE.idle) return null;
  const strain = phase === PHASE.strain && s.strainLength > 0 ? clamp01(s.timer / s.strainLength) : 0;
  return [0, phase, r2(clamp(s.frontX)), r2(strain), r2(clamp01(s.fade)), s.frozen ? 1 : 0];
}

/**
 * Whether the gate went between two phases the guest saw: from before the
 * burst to after it. A guest that joins mid-flood has no earlier phase and
 * sees no burst (the gate is simply gone).
 * @param {number|null} prev The phase seen last (null before the first).
 * @param {number} next
 * @returns {boolean}
 */
export function burstWanted(prev, next) {
  return prev !== null && prev <= PHASE.strain && next >= PHASE.breaking;
}

/**
 * Whether the dam has started to fail between two phases (a banner).
 * @param {number|null} prev @param {number} next @returns {boolean}
 */
export function strainWanted(prev, next) {
  return (prev === null || prev === PHASE.idle) && next === PHASE.strain;
}

/**
 * How loud a sound at the dam is to a listener: 1 within `SOUND_NEAR`, 0 from `SOUND_FAR`, linear between.
 * @param {number} distance Metres.
 * @returns {number} 0..1
 */
export function soundScale(distance) {
  if (!(distance > SOUND_NEAR)) return 1;
  return clamp01(1 - (distance - SOUND_NEAR) / (SOUND_FAR - SOUND_NEAR));
}
