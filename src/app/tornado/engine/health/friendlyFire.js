// @ts-check

import { HEALTH } from './config.js';

/**
 * ===========================================================================
 * SECTION HP.3 -- Friendly fire and self-hit (pure helpers, Subtask 19)
 * ===========================================================================
 * Decision D4: friendly fire is on, so Roger's own splash can hurt him. The
 * maths lives here, free of the scene, so it can be tested; the callers
 * (hero/plasma.js today) only pass a weapon column, a distance and a radius
 * and hand the result to `health.damagePlayer`.
 */

/** A weapon column of `HEALTH.damageToPlayer`. */
export const SELF_HIT_WEAPONS = Object.freeze([
  'plasma', 'mega', 'bullet', 'bolt', 'fire', 'blade', 'blackHole', 'rocket', 'explosion', 'emp'
]);

/**
 * Whether one player may hurt another with a weapon.
 * A player's own splash always counts (D4). Hurting a different player needs
 * a second player to exist (co-op) and friendly fire to be on, so a
 * single-player run never reaches the partner branch.
 * @param {string} shooterId Id of the player who fired (`'0'` is Roger).
 * @param {string} targetId Id of the player in the way.
 * @param {{coop: boolean, friendlyFire: boolean}} mode The run's mode.
 * @returns {boolean} True when the hit may be applied.
 */
export const mayHurtPlayer = (shooterId, targetId, mode) =>
  shooterId === targetId || (mode.coop && mode.friendlyFire);

/**
 * Whether an impact is too close to its own muzzle to be a real hit: a trace
 * that starts inside geometry reports a distance near zero, and that must
 * not blow the shooter up (R-030 self-hit avoidance, same idea as the
 * railgun's 9 m minimum).
 * @param {number} travel Distance the shot travelled before landing, metres.
 * @param {number} [guard] Minimum travel; defaults to `HEALTH.friendlyFire.muzzleGuard`.
 * @returns {boolean} True when the impact is inside the muzzle guard.
 */
export const insideMuzzleGuard = (travel, guard = HEALTH.friendlyFire.muzzleGuard) =>
  !(travel >= guard);

/**
 * Health a player loses to a weapon's blast at a distance: the full
 * `damageToPlayer` value at the centre, falling away linearly to nothing at
 * the blast radius. Never negative, never above the configured value.
 * @param {string} weapon A `HEALTH.damageToPlayer` key.
 * @param {number} distance Metres from the blast centre to the player.
 * @param {number} radius Blast radius in metres.
 * @returns {number} Health points removed (0 outside the radius or for an unknown weapon).
 */
export const splashAmount = (weapon, distance, radius) => {
  const base = /** @type {Record<string, number>} */ (HEALTH.damageToPlayer)[weapon];
  if (!(base > 0) || !(radius > 0) || !(distance >= 0) || distance >= radius) return 0;
  return Math.round(base * (1 - distance / radius) * 100) / 100;
};
