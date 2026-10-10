// @ts-check
/**
 * ===========================================================================
 * SECTION NY — The host's lightning bolts and EMP pulses, as `fx` rows (pure)
 * ===========================================================================
 * Two `fx` kinds (R-061), both a place and a few numbers; the guest picks its own
 * look, so no bolt path or colour travels:
 *
 *   bolt  x, y, z = where the bolt landed; a = power x 100 (0..100: a row's
 *         numbers keep one decimal, a power does not)
 *   emp   x, y, z = the centre; a = the ring's full radius (m);
 *         b = the variant: 0 pulse (Roger's R), 1 solar pulse (green), 2 funnel wave
 *         (a charged funnel's discharge ring, player/ empCharge.js)
 *
 * The host announces them on the `weaponFx` bus with `to` = {x: a, y: b, z: 0}
 * (hero/weaponFx.js); the guest reads them back here and draws the presentation
 * alone: `lightning.strikeAt(end, power, false, true)` (no shake, decision 10) and
 * `emp.showPulse` / `empCharge.showWave`. Never a stun, a fault or a damage (R-053).
 * No scene, no ctx, no module state.
 */

/** A bolt's power is carried in hundredths. */
export const POWER_SCALE = 100;
/** The EMP variants, by `b` (append only, like `FX_KINDS`). */
export const EMP_VARIANTS = Object.freeze(['pulse', 'solar', 'wave']);
/** Radius bounds of a pulse on the guest (m): the host's is 36 to 240 (the storm's 360 is its own disaster's). */
export const EMP_RADIUS_RANGE = Object.freeze({ min: 1, max: 400 });

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Fills `out` (the emitter's reused object) with a bolt's `to`.
 * @param {{x: number, y: number, z: number}} out
 * @param {number} power 0..1
 * @returns {typeof out}
 */
export function boltFxTo(out, power) {
  out.x = Number.isFinite(power) ? clamp(power, 0, 1) * POWER_SCALE : 0;
  out.y = 0;
  out.z = 0;
  return out;
}

/**
 * Fills `out` with an EMP's `to`.
 * @param {{x: number, y: number, z: number}} out
 * @param {number} radius
 * @param {'pulse'|'solar'|'wave'} variant
 * @returns {typeof out}
 */
export function empFxTo(out, radius, variant) {
  out.x = radius;
  out.y = EMP_VARIANTS.indexOf(variant);
  out.z = 0;
  return out;
}

/**
 * @param {ReadonlyArray<number>} row an `fx` row [id, kind, shooter, x, y, z, a, b, c, extra]
 * @returns {{x: number, y: number, z: number, power: number}|null} null when a number is not finite
 */
export function boltFromRow(row) {
  if (!row || !(Number.isFinite(row[3]) && Number.isFinite(row[4]) && Number.isFinite(row[5]) && Number.isFinite(row[6]))) return null;
  return { x: row[3], y: Math.max(0, row[4]), z: row[5], power: clamp(row[6] / POWER_SCALE, 0, 1) };
}

/**
 * @param {ReadonlyArray<number>} row an `fx` row
 * @returns {{x: number, y: number, z: number, radius: number, variant: 'pulse'|'solar'|'wave'}|null} null when a number is not finite;
 *   an unknown variant is a plain pulse
 */
export function empFromRow(row) {
  if (!row || !(Number.isFinite(row[3]) && Number.isFinite(row[4]) && Number.isFinite(row[5]) && Number.isFinite(row[6]) && Number.isFinite(row[7]))) return null;
  const v = EMP_VARIANTS[Math.round(row[7])];
  return {
    x: row[3], y: row[4], z: row[5],
    radius: clamp(row[6], EMP_RADIUS_RANGE.min, EMP_RADIUS_RANGE.max),
    variant: /** @type {'pulse'|'solar'|'wave'} */ (v || 'pulse')
  };
}
