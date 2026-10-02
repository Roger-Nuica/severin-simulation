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

/** The body a ray must pass through to hit a player: radius and top, metres (the guest's hit cylinder). */
export const BODY = Object.freeze({ radius: 0.5, top: 1.9 });

/**
 * Where a ray first crosses a player's body (a standing cylinder), as the
 * distance along the ray, or -1 for a miss. Past the muzzle guard only, and
 * not beyond `maxT`. The direction must be a unit vector.
 * @param {number} ox Ray origin x.
 * @param {number} oy Ray origin height.
 * @param {number} oz Ray origin z.
 * @param {number} dx Unit direction x.
 * @param {number} dy Unit direction y.
 * @param {number} dz Unit direction z.
 * @param {number} maxT Furthest distance that counts.
 * @param {number} tx The player's x.
 * @param {number} tz The player's z.
 * @returns {number} Distance along the ray, or -1.
 */
export const rayBodyDistance = (ox, oy, oz, dx, dy, dz, maxT, tx, tz) => {
  const hx = Math.hypot(dx, dz) || 1e-6;
  const t = ((tx - ox) * dx + (tz - oz) * dz) / (hx * hx);
  if (!(t >= HEALTH.friendlyFire.muzzleGuard) || t > maxT) return -1;
  const py = oy + dy * t;
  if (py < 0 || py > BODY.top) return -1;
  return Math.hypot(ox + dx * t - tx, oz + dz * t - tz) > BODY.radius ? -1 : t;
};

/**
 * Whether a point on the ground is inside a forward sector (a melee arc or the
 * Fire Gun's cone): within `reach` and within the angle whose cosine is
 * `cosArc` of the facing direction. Anything closer than `near` counts, so
 * someone on top of the attacker is never missed.
 * @param {number} ox Attacker x.
 * @param {number} oz Attacker z.
 * @param {number} fx Facing x (unit, ground plane).
 * @param {number} fz Facing z.
 * @param {number} tx Target x.
 * @param {number} tz Target z.
 * @param {number} reach Metres.
 * @param {number} cosArc Cosine of the half-angle.
 * @param {number} [near] Distance inside which the angle is ignored.
 * @returns {boolean} True when the target is in the sector.
 */
export const inSector = (ox, oz, fx, fz, tx, tz, reach, cosArc, near = 0.05) => {
  const dx = tx - ox, dz = tz - oz;
  const d = Math.hypot(dx, dz);
  if (d > reach) return false;
  if (d < near) return true;
  return (dx * fx + dz * fz) / d >= cosArc;
};
