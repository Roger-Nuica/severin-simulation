// @ts-check
/**
 * ===========================================================================
 * SECTION NW — What a Roger does that the other screen should see (pure)
 * ===========================================================================
 * The last family of the guest's world effects (R-061): the teleport warp, the
 * jetpack's flames, the Katana's swing and the hit marker. All presentation:
 * none of it damages, scores or moves anything (R-053).
 *
 *   warp  x, y, z = where the Roger left (y 0); a, b, c = where he landed
 *         (an `fx` kind, announced by the host's own jump, `player/teleport.js`)
 *   cut   (an existing kind) x, y, z = the shooter's feet or eye, a, b, c = where the cut
 *         lands; `extra` 0 = a quick slash, 1 = a Blade Mode line (no direction in the row)
 *   jet   not a row: bit 4 of the `aim` row's firing bits, set while that Roger's pack burns
 *         (the other bits stay: 1 Fire Gun firing, 2 minigun spinning)
 *   score the existing `score` event {id, points}: the hit marker for the player it names
 *
 * No scene, no ctx, no module state: plain numbers in, plain numbers out.
 */
import { unpackExtra, HIT_CODES } from './fxOut.js';

const HIT_ENEMY = HIT_CODES.indexOf('enemy');

/** The `aim` row's firing bit for a burning jetpack. */
export const AIM_JET_BIT = 4;

/** Seconds the hit marker (the crosshair turning red) stays on after a score. */
export const HIT_MARK_SECONDS = 0.18;

/** The swing arc: how long it burns (s), its reach (m), the sweep it draws (radians) and its height above the feet (m). */
export const SWING_ARC = Object.freeze({ life: 0.2, reach: 3.2, sweep: 2.1, height: 1.1 });

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** @param {ReadonlyArray<number>} row @param {number} a @param {number} b */
const finite = (row, a, b) => { for (let i = a; i <= b; i++) if (!Number.isFinite(row[i])) return false; return true; };

/**
 * @param {number} bits an `aim` row's firing bits
 * @param {boolean} burning the pack burns
 * @returns {number} the bits with the jet bit set or cleared
 */
export const withJetBit = (bits, burning) => (burning ? (bits | AIM_JET_BIT) : (bits & ~AIM_JET_BIT));

/**
 * Does this `aim` row say the player's pack burns? (A row of the viewer's own figure counts too: nothing
 * draws its flames locally on a guest.)
 * @param {ReadonlyArray<number>|undefined} row [playerId, yaw, pitch, firingBits]
 * @returns {boolean}
 */
export const jetWanted = (row) => !!row && ((row[3] | 0) & AIM_JET_BIT) !== 0;

/**
 * How hard a figure climbs, 0..1, from two heights a frame apart (for the flame's length).
 * The host's own flame reads its real climb speed; a guest reads it from the eased `alt`.
 * @param {number} prev height last frame (m) @param {number} now height this frame (m)
 * @param {number} dt seconds @param {number} climbSpeed the jetpack's top climb speed (m/s)
 * @returns {number}
 */
export const climbFrom = (prev, now, dt, climbSpeed) => (dt > 0 && climbSpeed > 0 ? clamp((now - prev) / dt / climbSpeed, 0, 1) : 0);

/**
 * Is a guest's pack burning on the host's copy of it: in the air, on its feet and free to fly.
 * Space lights the pack at once and it burns until the guest lands, so this is the whole rule.
 * @param {boolean} air off the ground @param {boolean} up on its feet (not down) @param {boolean} free not seated
 * @returns {boolean}
 */
export const guestBurning = (air, up, free) => air && up && free;

/**
 * Fills the two ends of a warp announcement (the emitter's reused objects; nothing is allocated).
 * @param {{x: number, y: number, z: number}} from @param {{x: number, y: number, z: number}} to
 * @param {number} fx @param {number} fz where he left @param {number} tx @param {number} tz where he landed
 * @returns {void}
 */
export function warpEnds(from, to, fx, fz, tx, tz) {
  from.x = fx; from.y = 0; from.z = fz;
  to.x = tx; to.y = 0; to.z = tz;
}

/**
 * @param {ReadonlyArray<number>} row an `fx` row [id, kind, shooter, x, y, z, a, b, c, extra]
 * @returns {{fromX: number, fromZ: number, toX: number, toZ: number}|null} null when a number is not finite
 */
export function warpFromRow(row) {
  if (!row || !finite(row, 3, 8)) return null;
  return { fromX: row[3], fromZ: row[5], toX: row[6], toZ: row[8] };
}

/**
 * @param {ReadonlyArray<number>} row an `fx` row of kind `cut`
 * @returns {{x: number, y: number, z: number, heading: number, hasHeading: boolean, blade: boolean, hit: boolean}|null}
 *   null when a number is not finite. `heading` is the way the cut goes (0 faces +z), from the row's two ends;
 *   a Blade Mode line has the same point for both, so it has no heading.
 */
export function cutFromRow(row) {
  if (!row || !finite(row, 3, 9)) return null;
  const dx = row[6] - row[3];
  const dz = row[8] - row[5];
  const hasHeading = Math.hypot(dx, dz) > 0.05;
  const { hit, extra } = unpackExtra(row[9]);
  return { x: row[3], y: row[4], z: row[5], heading: hasHeading ? Math.atan2(dx, dz) : 0, hasHeading, blade: extra === 1, hit: hit === HIT_ENEMY };
}

/**
 * Where the swing arc's blade is, as a bearing offset from the shooter's heading, at progress 0..1:
 * from one side of the arc across to the other, fast at first and slowing at the end.
 * @param {number} u 0..1
 * @returns {number} radians, from `-sweep / 2` to `+sweep / 2`
 */
export function swingBearing(u) {
  const t = clamp(u, 0, 1);
  const eased = 1 - (1 - t) * (1 - t);
  return (eased - 0.5) * SWING_ARC.sweep;
}

/**
 * The arc's brightness at progress 0..1: bright at the start, gone at the end.
 * @param {number} u 0..1
 * @returns {number}
 */
export const swingFade = (u) => { const t = 1 - clamp(u, 0, 1); return t * t; };

/**
 * The hit marker a `score` event asks of this screen.
 * @param {{id?: unknown, points?: unknown}|null|undefined} d the event's data
 * @param {number} ownId the viewer's player id (-1 when unknown)
 * @returns {{own: boolean, points: number}|null} null for an event that is not a valid score;
 *   `own` is true when the points are the viewer's (the marker shows), else the partner's
 */
export function scoreMarker(d, ownId) {
  if (!d) return null;
  const id = Number(d.id);
  const points = Number(d.points);
  if (!Number.isFinite(id) || !Number.isFinite(points) || points <= 0) return null;
  return { own: id === ownId, points };
}
