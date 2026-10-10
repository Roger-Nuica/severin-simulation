// @ts-check
/**
 * ===========================================================================
 * SECTION AP — Alien and saucer figures on the guest, posed from replicated state (pure)
 * ===========================================================================
 * The guest draws the host's aliens and its saucers (the landing ship and the
 * hunters) with the real models (aliens/models.js, spaceship/config.js),
 * cloned from one template each. There is no AI: the alien's walk comes from
 * how far its interpolated row moved (rogerView.js `stepRunCycle`) and the
 * saucer turns slowly on its own. No scene, no DOM, no module state.
 */

/** Leg-cycle radians per metre the host's crew walk covers (aliens/crew.js: cycle += speed * dt * 3). */
export const ALIEN_STRIDE = 3;
/** The host's walk swing, radians (aliens/crew.js poseWalk). */
export const ALIEN_SWING = 0.5;
/** A hovering saucer's turn, radians per second (aliens/waves.js, ship.js hover). */
export const SAUCER_SPIN = 0.8;

/** @typedef {{rotation: {x: number}}} Limb */

/**
 * The host's crew walk for a point of the cycle (legs and the free arm swing
 * in opposition; the gun arm is left as built, since a raised aim needs
 * state the row does not carry).
 * @param {{legL: Limb, legR: Limb, armL: Limb}} limbs The figure's limbs.
 * @param {number} phase Walk-cycle radians.
 * @param {number} amount 0 (standing) to 1 (the host's own walk).
 * @returns {void}
 */
export const poseAlienWalk = (limbs, phase, amount) => {
  const s = Math.sin(phase) * ALIEN_SWING * amount;
  limbs.legL.rotation.x = s;
  limbs.legR.rotation.x = -s;
  limbs.armL.rotation.x = -s * 0.6;
};

/**
 * The saucer's yaw a moment on, kept within one turn.
 * @param {number} yaw Radians now.
 * @param {number} dt Seconds.
 * @returns {number}
 */
export const spinSaucer = (yaw, dt) => (yaw + SAUCER_SPIN * Math.max(0, dt)) % (Math.PI * 2);
