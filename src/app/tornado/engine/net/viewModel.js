// @ts-check
import { WEAPONS } from './protocol.js';

/**
 * ===========================================================================
 * SECTION NV — The guest's weapon in hand (pure)
 * ===========================================================================
 * Which close-up model the guest sees, when, and where it sits in the camera's
 * frame. The meshes are the host's own (hero/weaponModels.js, the Katana's
 * hero/katana/model.js); this file decides only what is shown. No scene, no
 * DOM, so it is tested without the browser.
 *
 * Rules (decided 2026-10-05):
 *  - the model of the weapon in hand shows while the guest's aim is held and
 *    the guest's Roger is up (a downed Roger drops it, as the host's does);
 *  - the wheel is the protocol's `WEAPONS` (R-049): the index in, the key out,
 *    nothing reordered, an index off the wheel shows nothing;
 *  - it sits where the host's `placeView` puts it, with the same walk sway.
 */

/** @typedef {typeof WEAPONS[number]} ViewKey */

/**
 * The model key for a wheel index, or null for one off the wheel.
 * @param {number} index
 * @returns {ViewKey|null}
 */
export const viewKeyAt = (index) => (Number.isInteger(index) && WEAPONS[index]) || null;

/**
 * The key whose model should be on screen this frame, or null for none.
 * @param {boolean} aim the weapon is raised (first person)
 * @param {boolean} up the guest's Roger is up (not down or dead)
 * @param {number} weapon the wheel index
 * @returns {ViewKey|null}
 */
export const shownKey = (aim, up, weapon) => (aim && up ? viewKeyAt(weapon) : null);

/**
 * The walk's sway, -1..1: still when not walking.
 * @param {boolean} moving
 * @param {number} seconds a running clock
 * @returns {number}
 */
export const swayOf = (moving, seconds) => (moving ? Math.sin(seconds * 9) : 0);

/**
 * Where the model sits in the camera's own frame (x right, y up, -z ahead),
 * written into `out`: low on the right, bobbing a little with the walk.
 * @param {{x: number, y: number, z: number}} out written in place
 * @param {number} sway -1..1
 * @returns {{x: number, y: number, z: number}} out
 */
export const viewOffset = (out, sway) => {
  out.x = 0.3 + sway * 0.012;
  out.y = -0.3 + Math.abs(sway) * 0.012;
  out.z = -0.32;
  return out;
};
