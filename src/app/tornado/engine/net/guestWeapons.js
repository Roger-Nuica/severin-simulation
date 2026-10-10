// @ts-check
/**
 * ===========================================================================
 * SECTION NW — Guest weapon table and fire gating (pure)
 * ===========================================================================
 * What the host needs to decide, for one guest and one frame, whether a
 * trigger pull becomes a shot. No scene, no DOM, no enemy registry: the table
 * holds the numbers the host's `guestFire` already used, and the helpers hold
 * the rules, so both can be tested without the browser.
 *
 * Rules (decided 2026-10-05):
 *  - the weapon must be raised (`input.aim`) before it fires, as on the host;
 *    the Katana is the exception (R-051: it works without raising it);
 *  - the cooldown is counted in host seconds, never in input messages, so a
 *    burst of coalesced messages neither loses nor doubles a shot;
 *  - a click shorter than the host's frame, or one overwritten by a newer
 *    message in the same frame, is kept as a pending trigger until the host
 *    has looked at it once.
 * The wheel order (R-049) comes from `WEAPONS` in protocol.js; nothing here
 * reorders it or touches `accepts`, the damage table or any health value.
 */
import { WEAPONS } from './protocol.js';

/**
 * @typedef {Object} GuestWeapon
 * @property {'ray'|'flame'|'blade'|'hole'} mode how the host resolves it
 * @property {number} cooldown seconds between shots (0: held, no cooldown)
 * @property {number} range metres the shot reaches (blade: reach)
 * @property {boolean} needsAim the weapon must be raised before it fires
 * @property {'plasma'|'bullet'|'bolt'|'blade'|null} type damage type sent to the enemy registry (null: own path)
 */

/** Hitscan weapons answer with the damage type each has in the enemy registry. */
export const GUEST_WEAPONS = /** @type {const} */ ({
  rifle: { mode: 'ray', cooldown: 0.45, range: 140, needsAim: true, type: 'plasma' },
  minigun: { mode: 'ray', cooldown: 0.09, range: 100, needsAim: true, type: 'bullet' },
  railgun: { mode: 'ray', cooldown: 0.2, range: 220, needsAim: true, type: 'bolt' },
  fire: { mode: 'flame', cooldown: 0, range: 0, needsAim: true, type: null },
  blackhole: { mode: 'hole', cooldown: 0.6, range: 200, needsAim: true, type: null },
  katana: { mode: 'blade', cooldown: 0.5, range: 3.6, needsAim: false, type: 'blade' }
});

/** The Katana's arc, half-angle in radians (the reach is the table's `range`). */
export const KATANA_HALF_ANGLE = 0.9;

/**
 * The table entry for a wheel index, or null for an index off the wheel.
 * @param {number} index
 * @returns {GuestWeapon|null}
 */
export const weaponAt = (index) => {
  const name = WEAPONS[index];
  return name ? GUEST_WEAPONS[/** @type {keyof typeof GUEST_WEAPONS} */ (name)] : null;
};

/**
 * @typedef {Object} Trigger
 * @property {number} weapon wheel index when the trigger was pulled
 * @property {boolean} aim the weapon was raised when it was pulled
 */

/**
 * The trigger the host should act on this frame: the latest input if it holds
 * fire, otherwise a fire seen in an earlier message that has not been looked
 * at yet. Null when nothing is pulled.
 * @param {{fire: boolean, aim: boolean, weapon: number}|null} latest
 * @param {Trigger|null} pending
 * @returns {Trigger|null}
 */
export const pickTrigger = (latest, pending) => {
  if (latest && latest.fire) return { weapon: latest.weapon, aim: latest.aim };
  return pending;
};

/**
 * Remember a fire message for the next frame (`pending` is cleared once the
 * host has looked at it). A message that does not hold fire changes nothing.
 * @param {Trigger|null} pending
 * @param {{fire: boolean, aim: boolean, weapon: number}} input the newly accepted input
 * @returns {Trigger|null}
 */
export const notePending = (pending, input) => (input.fire ? { weapon: input.weapon, aim: input.aim } : pending);

/**
 * @typedef {'none'|'unraised'|'cooldown'|'flame'|'shoot'} Verdict
 */

/**
 * What a trigger does this frame.
 *  - `unraised`: the weapon is not raised (and is not the Katana): nothing happens;
 *  - `flame`: the Fire Gun is held, has no cooldown, burns this frame;
 *  - `cooldown`: still cooling from the last shot;
 *  - `shoot`: fire now, then set the cooldown to `cooldownAfter`.
 * @param {Trigger|null} trigger
 * @param {number} cooldown seconds left
 * @returns {{verdict: Verdict, weapon: GuestWeapon|null}}
 */
export const resolveTrigger = (trigger, cooldown) => {
  if (!trigger) return { verdict: 'none', weapon: null };
  const weapon = weaponAt(trigger.weapon);
  if (!weapon) return { verdict: 'none', weapon: null };
  if (weapon.needsAim && !trigger.aim) return { verdict: 'unraised', weapon };
  if (weapon.mode === 'flame') return { verdict: 'flame', weapon };
  if (cooldown > 0) return { verdict: 'cooldown', weapon };
  return { verdict: 'shoot', weapon };
};

/**
 * The cooldown left after `dt` host seconds (never below zero). It depends on
 * time alone, not on how many input messages arrived in that time.
 * @param {number} cooldown
 * @param {number} dt
 * @returns {number}
 */
export const coolDown = (cooldown, dt) => Math.max(0, cooldown - dt);
