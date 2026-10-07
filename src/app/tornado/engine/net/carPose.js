// @ts-check
/**
 * ===========================================================================
 * SECTION CP — Cars on the guest: the `cars` snapshot kind, encoded and posed (pure)
 * ===========================================================================
 * The old `vehicles` row carries only x, z, heading and speed. A car the
 * funnel or telekinesis throws needs its height and tilt too, so the host
 * adds a `cars` kind (additive, optional: an older guest ignores it, an older
 * host never sends it) and the guest draws the real car model from it.
 *   cars  [id, x, y, z, yaw, pitch, roll, colour]
 * Angles are the mesh's Euler angles in 'YXZ' order (yaw first, as a car
 * turns), so the guest sets them back the same way. No scene, no module state.
 */

/** Priority classes: the driven car first, then airborne or tumbling, then moving, then parked. */
export const CAR_CLASS = Object.freeze({ driven: 0, airborne: 1, moving: 2, parked: 3 });

/** A car this far off the ground (m) counts as airborne. */
export const AIRBORNE_Y = 0.25;
/** A car this fast (m/s squared, as `lengthSq`) counts as moving: the old vehicles cut-off. */
export const MOVING_SQ = 0.04;
/** A tilt this far from level (radians) counts as thrown even on the ground (a wreck on its side). */
export const TILTED = 0.3;

/**
 * Euler angles ('YXZ') of a unit quaternion.
 * @param {{x: number, y: number, z: number, w: number}} q
 * @returns {{yaw: number, pitch: number, roll: number}}
 */
export function eulerYXZ(q) {
  const { x, y, z, w } = q;
  // Rotation matrix terms (three.js Euler.setFromRotationMatrix, order YXZ).
  const m13 = 2 * (x * z + w * y);
  const m23 = 2 * (y * z - w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m11 = 1 - 2 * (y * y + z * z);
  const m21 = 2 * (x * y + w * z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m23)));
  if (Math.abs(m23) < 0.9999999) return { yaw: Math.atan2(m13, m33), pitch, roll: Math.atan2(m21, m22) };
  return { yaw: Math.atan2(-(2 * (x * z - w * y)), m11), pitch, roll: 0 };
}

/**
 * Which priority class a car is in.
 * @param {{y: number, speedSq: number, pitch: number, roll: number, driven?: boolean, lifted?: boolean}} c
 * @returns {number} A `CAR_CLASS` value.
 */
export function carClass(c) {
  if (c.driven) return CAR_CLASS.driven;
  if (c.lifted || c.y > AIRBORNE_Y || Math.abs(c.pitch) > TILTED || Math.abs(c.roll) > TILTED) return CAR_CLASS.airborne;
  if (c.speedSq >= MOVING_SQ) return CAR_CLASS.moving;
  return CAR_CLASS.parked;
}

/**
 * The cars to send: the most important first, at most `cap` (a stable sort, so
 * equal classes keep their order and the chosen set does not flicker).
 * @template {{cls: number}} T
 * @param {T[]} cars
 * @param {number} cap
 * @returns {T[]}
 */
export function pickCars(cars, cap) {
  return cars.map((c, i) => ({ c, i })).sort((a, b) => a.c.cls - b.c.cls || a.i - b.i).slice(0, cap).map((e) => e.c);
}

/**
 * One `cars` row.
 * @param {number} id
 * @param {{x: number, y: number, z: number}} pos Already clamped to the world.
 * @param {{yaw: number, pitch: number, roll: number}} e
 * @param {number} colour Index of the body colour.
 * @returns {number[]}
 */
export function carRow(id, pos, e, colour) {
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  return [id, r2(pos.x), r2(pos.y), r2(pos.z), r2(e.yaw), r2(e.pitch), r2(e.roll), colour];
}

/**
 * Poses a car proxy from an interpolated row.
 * @param {{position: {set: Function}, rotation: {set: Function, order?: string}}} obj
 * @param {number[]} row
 * @returns {void}
 */
export function poseCar(obj, row) {
  obj.position.set(row[1], row[2], row[3]);
  obj.rotation.order = 'YXZ';
  obj.rotation.set(row[5], row[4], row[6]);
}

/**
 * Colour index to use for a row (clamped into the palette; an unknown index from a newer host is the first).
 * @param {number} index
 * @param {number} palette How many body colours this build has.
 * @returns {number}
 */
export const colourIndex = (index, palette) => (Number.isInteger(index) && index >= 0 && index < palette ? index : 0);
