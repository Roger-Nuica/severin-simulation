// @ts-check

/**
 * ===========================================================================
 * SECTION AK.8 — The crew keep their distance from Roger
 * ===========================================================================
 * On request (2026-10-05): the crew never come up to Roger. They close in
 * while he is far, and once inside STAND_OFF.ring they circle him -- always
 * moving, never standing still -- and shoot from there; nearer than
 * STAND_OFF.near they back away. Pure maths, free of three.js, so it runs
 * under `node --test` (tests/alienStandOff.test.mjs).
 */

export const STAND_OFF = Object.freeze({
  /** They see him this far off (m). */
  sight: 80,
  /** They circle him at about this distance (m). */
  ring: 40,
  /** Nearer than this they back off (m). */
  near: 32,
  /** Seconds before one changes the way it is circling, at random in this range. */
  flip: Object.freeze([3, 7])
});

/**
 * Which way an alien should walk, as a unit vector on the ground, from
 * where Roger is relative to it. Always a full unit vector: it never stops.
 * @param {number} dx Roger minus the alien, x
 * @param {number} dz Roger minus the alien, z
 * @param {number} side +1 or -1, the way it circles
 * @returns {{x: number, z: number}}
 */
export function standOffStep(dx, dz, side) {
  const d = Math.hypot(dx, dz) || 1;
  const ix = dx / d;
  const iz = dz / d;
  // Round him: left of "towards him" is (iz, -ix).
  const tx = iz * side;
  const tz = -ix * side;
  // In (+1) when far, out (-1) when near, a blend across the ring.
  let radial;
  if (d > STAND_OFF.ring + 8) radial = 1;
  else if (d < STAND_OFF.near) radial = -1;
  else radial = (d - STAND_OFF.ring) / 8;
  const along = 1 - Math.min(1, Math.abs(radial));
  let x = ix * radial + tx * Math.max(along, 0.35);
  let z = iz * radial + tz * Math.max(along, 0.35);
  const n = Math.hypot(x, z) || 1;
  x /= n;
  z /= n;
  return { x, z };
}
