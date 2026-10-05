// @ts-check
import { HERO } from './config.js';

/**
 * ===========================================================================
 * SECTION HM.W — How a Roger walks (shared by every Roger)
 * ===========================================================================
 * The movement rules of Roger on foot, as pure functions, so the host's own
 * Roger (hero/movement.js) and a co-op guest's Roger (net/system.js
 * moveGuest) walk by the very same rules:
 *  - on foot (weapon down): A and D turn him, W runs forward with
 *    acceleration, S backs off slowly; the follow camera stays behind him and
 *    the mouse does nothing;
 *  - aiming (first person): he faces where the mouse looks, W and S walk
 *    forward and back, A and D strafe.
 * Heading convention: 0 faces +z, forward is (sin h, cos h), and the left of
 * forward is (cos h, -sin h).
 */

/**
 * @typedef {{up: boolean, down: boolean, left: boolean, right: boolean}} WalkKeys
 */

/**
 * One frame of running on foot: the turn, then the speed eased towards what
 * the keys ask for. Mutates `st`.
 * @param {{heading: number, speed: number}} st Heading (radians) and forward speed (m/s).
 * @param {WalkKeys} keys The movement keys held.
 * @param {number} dt Seconds.
 * @returns {void}
 */
export function stepRun(st, keys, dt) {
  const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  st.heading += turn * HERO.turnRate * dt;
  const want = keys.up ? HERO.runSpeed : keys.down ? -HERO.backSpeed : 0;
  const step = HERO.accel * dt;
  st.speed = st.speed < want ? Math.min(want, st.speed + step) : Math.max(want, st.speed - step * 1.5);
}

/**
 * The unit direction of a first-person walk: forward / back along the look,
 * strafing across it. Writes `out` ((0, 0) when no key is held).
 * @param {number} yaw Look yaw, radians.
 * @param {number} ahead +1 forward, -1 back (or the analog amount).
 * @param {number} across +1 left, -1 right (or the analog amount).
 * @param {{x: number, z: number}} out Written and returned.
 * @returns {{x: number, z: number}} `out`, unnormalised.
 */
export function aimDirection(yaw, ahead, across, out) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Left of forward is (fz, -fx).
  out.x = fx * ahead + fz * across;
  out.z = fz * ahead - fx * across;
  return out;
}

/**
 * An angle folded into (-PI, PI], so a heading or look yaw that has turned
 * many times stays a small number (the co-op input accepts only a bounded yaw).
 * @param {number} a Radians.
 * @returns {number} The same direction, in (-PI, PI].
 */
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
